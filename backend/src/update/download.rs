//! Bounded, resumable package transfer. Installation only sees a verified archive.
use super::network::{DOWNLOAD_LIMIT, Network, announce};
use super::{InstallStatus, ROOT, Release, save_status, validate_fpk};
use anyhow::{Result, bail, ensure};
use reqwest::{Response, header};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::Instant;

fn range_start(value: &str, total: u64) -> Option<u64> {
    let (range, size) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let (start, end, size) = (
        start.parse::<u64>().ok()?,
        end.parse::<u64>().ok()?,
        size.parse::<u64>().ok()?,
    );
    (size == total && start <= end && end < total).then_some(start)
}
pub(super) async fn consume<F: FnMut(u64) -> Result<()> + Send>(
    mut response: Response,
    file: &mut File,
    received: &mut u64,
    total: u64,
    deadline: Instant,
    idle: Duration,
    mut notify: F,
) -> Result<()> {
    let kind = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    ensure!(
        !kind.contains("text/html") && !kind.contains("application/json"),
        "加速线路返回的不是安装包"
    );
    match response.status().as_u16() {
        200 => {
            // Some accelerators ignore Range; restart instead of appending a whole file.
            file.set_len(0)?;
            file.seek(SeekFrom::Start(0))?;
            *received = 0;
        }
        206 => {
            let start = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|h| h.to_str().ok())
                .and_then(|h| range_start(h, total));
            ensure!(start == Some(*received), "加速线路返回了错误的续传位置");
            file.seek(SeekFrom::Start(*received))?;
        }
        _ => bail!("加速线路暂时无法提供安装包"),
    }
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        ensure!(!remaining.is_zero(), "下载总时限已到，请重试");
        let chunk = tokio::time::timeout(idle.min(remaining), response.chunk())
            .await
            .map_err(|_| anyhow::anyhow!("下载持续无数据，正在切换备用线路"))?
            .map_err(|_| anyhow::anyhow!("下载连接中断，正在切换备用线路"))?;
        let Some(chunk) = chunk else {
            break;
        };
        ensure!(
            chunk.len() as u64 <= total.saturating_sub(*received),
            "安装包大小超出发布信息"
        );
        file.write_all(&chunk)?;
        *received += chunk.len() as u64;
        notify(*received)?;
    }
    ensure!(*received == total, "安装包尚未传输完整");
    file.sync_all()?;
    Ok(())
}
fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut bytes = [0u8; 65536];
    loop {
        let size = file.read(&mut bytes)?;
        if size == 0 {
            break;
        }
        digest.update(&bytes[..size]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
pub(super) async fn download(
    net: &Network,
    release: &Release,
    info: &mut InstallStatus,
) -> Result<PathBuf> {
    // Only GitHub (through local proxies or direct TLS) supplies the trusted hash.
    let bytes = net.checksum(release.checksums_id).await?;
    let text = std::str::from_utf8(&bytes).map_err(|_| anyhow::anyhow!("校验文件无效"))?;
    let name = format!("FnOS-OrangeAudiobook-x86_64-{}.fpk", release.version);
    let expected = text
        .lines()
        .find_map(|line| {
            let (digest, file) = line.split_once(char::is_whitespace)?;
            (file.trim().trim_start_matches('*') == name
                && digest.len() == 64
                && digest.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| digest.to_ascii_lowercase())
        })
        .ok_or_else(|| anyhow::anyhow!("找不到对应安装包的 SHA-256"))?;
    let asset = net.asset(release.asset_id).await?;
    let sources = net.sources(release.asset_id, asset)?;
    let target = Path::new(ROOT).join(&name);
    let part = target.with_extension("fpk.part");
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(&part)?;
    let mut received = 0u64;
    let deadline = Instant::now() + DOWNLOAD_LIMIT;
    for source in sources {
        ensure!(Instant::now() < deadline, "下载总时限已到，请重试");
        announce(
            info,
            &source.label,
            if received == 0 {
                "正在下载安装包"
            } else {
                "正在续传安装包"
            },
        )?;
        let response = match net.open(&source, received).await {
            Ok(r) => r,
            Err(_) => continue,
        };
        let transfer = consume(
            response,
            &mut file,
            &mut received,
            release.size,
            deadline,
            Duration::from_secs(45),
            |count| {
                let progress = (count * 45 / release.size) as u32;
                if progress != info.progress {
                    info.progress = progress;
                    save_status(info)?;
                }
                Ok(())
            },
        )
        .await;
        if transfer.is_err() && received != release.size {
            continue;
        }
        if hash_file(&part)? != expected {
            file.set_len(0)?;
            file.seek(SeekFrom::Start(0))?;
            received = 0;
            continue;
        }
        validate_fpk(&part, &release.version)?;
        drop(file);
        fs::rename(&part, &target)?;
        return Ok(target);
    }
    bail!("所有下载线路均未完成传输，请检查本机代理后重试；安装尚未开始")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[test]
    fn content_ranges_must_match_the_trusted_release_size() {
        assert_eq!(range_start("bytes 2-3/4", 4), Some(2));
        for bad in [
            "bytes 2-3/5",
            "bytes 3-2/4",
            "bytes 0-4/4",
            "bytes */4",
            "nonsense",
        ] {
            assert_eq!(range_start(bad, 4), None);
        }
    }
    async fn response(raw: &'static [u8], stall: bool) -> Response {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let _ = s.read(&mut request).await;
            s.write_all(raw).await.unwrap();
            if stall {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        });
        ClientForTest::get(format!("http://{address}")).await
    }
    struct ClientForTest;
    impl ClientForTest {
        async fn get(url: String) -> Response {
            reqwest::Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .get(url)
                .send()
                .await
                .unwrap()
        }
    }
    #[tokio::test]
    async fn stalled_body_keeps_verified_offset_and_next_source_resumes() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(temp.path())
            .unwrap();
        let mut received = 0;
        let r = response(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nab", true).await;
        assert!(
            consume(
                r,
                &mut file,
                &mut received,
                4,
                Instant::now() + Duration::from_secs(2),
                Duration::from_millis(30),
                |_| Ok(())
            )
            .await
            .is_err()
        );
        assert_eq!(received, 2);
        let r=response(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 2\r\nContent-Range: bytes 2-3/4\r\n\r\ncd",false).await;
        consume(
            r,
            &mut file,
            &mut received,
            4,
            Instant::now() + Duration::from_secs(2),
            Duration::from_secs(1),
            |_| Ok(()),
        )
        .await
        .unwrap();
        assert_eq!(fs::read(temp.path()).unwrap(), b"abcd");
    }
    #[tokio::test]
    async fn ignored_range_restarts_instead_of_corrupting_the_package() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        fs::write(temp.path(), b"ab").unwrap();
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(temp.path())
            .unwrap();
        let mut received = 2;
        let r = response(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nabcd", false).await;
        consume(
            r,
            &mut file,
            &mut received,
            4,
            Instant::now() + Duration::from_secs(2),
            Duration::from_secs(1),
            |_| Ok(()),
        )
        .await
        .unwrap();
        assert_eq!(fs::read(temp.path()).unwrap(), b"abcd");
        assert_eq!(received, 4);
    }
    #[tokio::test]
    async fn successful_http_html_is_not_accepted_as_an_installer() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let mut file = temp.reopen().unwrap();
        let mut received = 0;
        let r = response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nContent-Type: text/html\r\n\r\nhtml",
            false,
        )
        .await;
        assert!(
            consume(
                r,
                &mut file,
                &mut received,
                4,
                Instant::now() + Duration::from_secs(2),
                Duration::from_secs(1),
                |_| Ok(())
            )
            .await
            .is_err()
        );
        assert_eq!(received, 0);
    }
}
