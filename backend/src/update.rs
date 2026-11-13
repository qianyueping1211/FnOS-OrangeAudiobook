//! Private-repository updates. Business APIs and user media are untouched.
use anyhow::{Context, Result, bail, ensure};
use flate2::read::GzDecoder;
use reqwest::{Client, redirect::Policy};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const REPO: &str = "qianyueping1211/ting-reader";
const APP: &str = "ting-reader";
const ROOT: &str = "/var/lib/ting-reader-updater";
const DATA: &str = "/var/apps/ting-reader/var";
const HELPER: &str = "/usr/local/libexec/ting-reader-updater";
const MAX_PACKAGE: u64 = 256 * 1024 * 1024;
const MAX_EXPANDED: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct InstallStatus {
    pub state: String,
    pub message: String,
    pub progress: u32,
    pub version: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub started: u64,
    #[serde(default)]
    pub outcome_unknown: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Release {
    pub version: String,
    pub tag: String,
    pub notes: String,
    pub published: String,
    pub asset_id: u64,
    pub size: u64,
    pub checksums_id: u64,
}

#[derive(Deserialize, Serialize)]
pub struct InstallRequest {
    pub version: String,
    pub tag: String,
    pub created: u64,
}

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn data_dir() -> PathBuf {
    std::env::var_os("TRIM_PKGVAR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(DATA))
}

fn private_read(path: &Path) -> Result<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    ensure!(file.metadata()?.is_file(), "更新文件类型无效");
    let mut result = Vec::new();
    file.take(65537).read_to_end(&mut result)?;
    ensure!(result.len() <= 65536, "更新文件过大");
    Ok(result)
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path.parent().context("更新目录无效")?;
    fs::create_dir_all(parent)?;
    let temp = parent.join(format!(".update-{}", uuid::Uuid::new_v4().simple()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp)?;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.sync_all()?;
    fs::rename(&temp, path)?;
    Ok(())
}

pub fn save_token(token: &str) -> Result<()> {
    ensure!((15..=300).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'), "GitHub 令牌格式无效");
    write_json(&data_dir().join("update-token.json"), &json!({ "token": token }))
}

pub fn delete_token() -> Result<()> {
    let path = data_dir().join("update-token.json");
    if path.exists() { fs::remove_file(path)?; }
    let cached = data_dir().join("update-check.json");
    if cached.exists() { fs::remove_file(cached)?; }
    Ok(())
}

fn token_from(dir: &Path) -> Result<String> {
    let value: Value = serde_json::from_slice(&private_read(&dir.join("update-token.json"))?)
        .map_err(|_| anyhow::anyhow!("请先保存 GitHub 私有仓库只读令牌"))?;
    let token = value["token"].as_str().context("请先保存 GitHub 私有仓库只读令牌")?;
    ensure!((15..=300).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'), "GitHub 令牌格式无效");
    Ok(token.to_owned())
}

fn installed_version() -> String {
    fs::read_to_string("/var/apps/ting-reader/manifest").ok()
        .and_then(|text| text.lines().find_map(|line| {
            let (key, value) = line.split_once('=')?;
            (key.trim() == "version").then(|| value.trim().to_owned())
        }))
        .filter(|version| Version::parse(version).is_ok())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_owned())
}

fn newer(target: &str, current: &str) -> bool {
    matches!((Version::parse(target), Version::parse(current)), (Ok(a), Ok(b)) if a > b)
}

pub fn parse_release(value: &Value) -> Result<Release> {
    ensure!(value["draft"] == false && value["prerelease"] == false, "只能安装正式发布版本");
    let tag = value["tag_name"].as_str().context("版本标签缺失")?;
    ensure!(tag.len() < 80 && tag.bytes().all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b)), "版本标签无效");
    let version = tag.trim_start_matches('v').split("-build.").next().unwrap_or_default();
    let parsed = Version::parse(version)?;
    ensure!(parsed.pre.is_empty() && parsed.build.is_empty(), "不支持预览版本");
    let version = parsed.to_string();
    let name = format!("ting-reader-native-x86_64-{version}.fpk");
    let assets = value["assets"].as_array().context("发布附件缺失")?;
    let package = assets.iter().find(|item| item["name"] == name).context("发布版本缺少 x86_64 安装包")?;
    let checksums = assets.iter().find(|item| item["name"] == "SHA256SUMS.txt").context("发布版本缺少 SHA-256 校验文件")?;
    let size = package["size"].as_u64().context("安装包大小无效")?;
    ensure!(size > 0 && size <= MAX_PACKAGE, "安装包大小无效");
    Ok(Release {
        version, tag: tag.to_owned(),
        notes: value["body"].as_str().unwrap_or_default().chars().take(12000).collect(),
        published: value["published_at"].as_str().unwrap_or_default().to_owned(),
        asset_id: package["id"].as_u64().context("附件编号无效")?, size,
        checksums_id: checksums["id"].as_u64().context("校验文件编号无效")?,
    })
}

fn github_client(token: &str) -> Result<Client> {
    let mut headers = reqwest::header::HeaderMap::new();
    let mut authorization = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))?;
    authorization.set_sensitive(true);
    headers.insert(reqwest::header::AUTHORIZATION, authorization);
    headers.insert(reqwest::header::CACHE_CONTROL, reqwest::header::HeaderValue::from_static("no-cache"));
    Ok(Client::builder().default_headers(headers).user_agent("TingReader-PrivateUpdater")
        .connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(180))
        .redirect(Policy::custom(|attempt| {
            let host = attempt.url().host_str().unwrap_or_default();
            if attempt.previous().len() < 5 && attempt.url().scheme() == "https"
                && (host == "api.github.com" || host == "github.com" || host.ends_with(".githubusercontent.com")) {
                attempt.follow()
            } else { attempt.stop() }
        })).build()?)
}

async fn github_json(client: &Client, suffix: &str) -> Result<Value> {
    let response = client.get(format!("https://api.github.com/repos/{REPO}/{suffix}"))
        .header("Accept", "application/vnd.github+json").send().await
        .map_err(|_| anyhow::anyhow!("连接 GitHub 失败，请检查 NAS 网络"))?;
    ensure!(response.status().is_success(), "无法读取私有版本，请检查令牌的仓库范围和 Contents 读取权限");
    let bytes = response.bytes().await?;
    ensure!(bytes.len() <= 2 * 1024 * 1024, "GitHub 版本信息过大");
    Ok(serde_json::from_slice(&bytes)?)
}

pub async fn check() -> Result<Value> {
    let client = github_client(&token_from(&data_dir())?)?;
    let release = parse_release(&github_json(&client, "releases/latest").await?)?;
    write_json(&data_dir().join("update-check.json"), &json!({ "release": release, "checked_at": now() }))?;
    status().await
}

fn helper_status() -> InstallStatus {
    let output = Command::new("/usr/bin/sudo").args(["-n", HELPER, "status"]).output();
    output.ok().filter(|result| result.status.success())
        .and_then(|result| serde_json::from_slice(&result.stdout).ok())
        .unwrap_or_else(|| InstallStatus { state: "idle".to_owned(), ..Default::default() })
}

pub async fn status() -> Result<Value> {
    let cached: Value = private_read(&data_dir().join("update-check.json")).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or(Value::Null);
    let current = installed_version();
    let latest = cached["release"]["version"].as_str().unwrap_or_default();
    let installer = tokio::task::spawn_blocking(helper_status).await?;
    Ok(json!({
        "current_version": current, "latest_version": latest,
        "tag": cached["release"]["tag"], "notes": cached["release"]["notes"],
        "published": cached["release"]["published"], "checked_at": cached["checked_at"],
        "has_token": token_from(&data_dir()).is_ok(),
        "update_available": newer(latest, &current),
        "installer": installer,
    }))
}

pub async fn install(version: String, tag: String) -> Result<Value> {
    let client = github_client(&token_from(&data_dir())?)?;
    let release = parse_release(&github_json(&client, "releases/latest").await?)?;
    ensure!(version == release.version && tag == release.tag && newer(&version, &installed_version()), "版本已变化，请重新检查更新");
    write_json(&data_dir().join("update-request.json"), &InstallRequest { version, tag, created: now() })?;
    let result = tokio::task::spawn_blocking(|| Command::new("/usr/bin/sudo").args(["-n", HELPER, "install"]).output()).await??;
    ensure!(result.status.success(), "无法启动更新，请检查飞牛安装权限或应用中心中的上次升级结果");
    status().await
}

async fn asset_response(client: &Client, id: u64) -> Result<reqwest::Response> {
    let response = client.get(format!("https://api.github.com/repos/{REPO}/releases/assets/{id}"))
        .header("Accept", "application/octet-stream").send().await?;
    ensure!(response.status().is_success(), "下载安装包失败，请检查 GitHub 访问权限");
    Ok(response)
}

fn root_status() -> InstallStatus {
    fs::read(Path::new(ROOT).join("status.json")).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| InstallStatus { state: "idle".to_owned(), ..Default::default() })
}

fn save_status(info: &InstallStatus) -> Result<()> {
    write_json(&Path::new(ROOT).join("status.json"), info)
}

fn valid_member(path: &Path) -> bool {
    !path.is_absolute() && !path.components().any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
}

pub fn validate_fpk(path: &Path, version: &str) -> Result<()> {
    let mut archive = tar::Archive::new(GzDecoder::new(File::open(path)?));
    let mut names = HashSet::new();
    let mut fields = HashMap::new();
    let mut payload = Vec::new();
    let mut total = 0_u64;
    for entry in archive.entries()? {
        let mut entry = entry?;
        let name = entry.path()?.into_owned();
        ensure!(valid_member(&name), "安装包包含不安全路径");
        let kind = entry.header().entry_type();
        ensure!(kind.is_file() || kind.is_dir(), "安装包包含不安全链接");
        total = total.checked_add(entry.size()).context("安装包大小无效")?;
        ensure!(total <= MAX_EXPANDED && names.insert(name.clone()), "安装包结构无效");
        if name == Path::new("manifest") {
            ensure!(entry.size() < 65536, "安装清单过大");
            let mut text = String::new();
            entry.read_to_string(&mut text)?;
            for line in text.lines() {
                if let Some((key, value)) = line.split_once('=') {
                    fields.insert(key.trim().to_owned(), value.trim().to_owned());
                }
            }
        } else if name == Path::new("app.tgz") {
            ensure!(entry.size() <= MAX_PACKAGE, "应用数据过大");
            entry.read_to_end(&mut payload)?;
        }
    }
    ensure!(fields.get("appname").map(String::as_str) == Some(APP)
        && fields.get("version").map(String::as_str) == Some(version), "安装包的应用或版本不匹配");
    ensure!(fields.get("platform").map(String::as_str) == Some("x86") || fields.get("arch").map(String::as_str) == Some("x86"), "安装包不是 x86_64 版本");
    ensure!(!payload.is_empty(), "安装包缺少应用数据");
    let mut child = Command::new("/usr/bin/md5sum").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()?;
    child.stdin.take().context("无法校验应用数据")?.write_all(&payload)?;
    let output = child.wait_with_output()?;
    ensure!(output.status.success(), "应用数据校验失败");
    let checksum = String::from_utf8(output.stdout)?;
    ensure!(fields.get("checksum").is_some_and(|expected| checksum.starts_with(expected) && expected.len() == 32), "应用内部校验失败");
    let mut nested = tar::Archive::new(GzDecoder::new(payload.as_slice()));
    let mut expanded = 0_u64;
    for entry in nested.entries()? {
        let entry = entry?;
        ensure!(valid_member(&entry.path()?) && (entry.header().entry_type().is_file() || entry.header().entry_type().is_dir()), "应用数据包含不安全路径");
        expanded = expanded.checked_add(entry.size()).context("应用数据大小无效")?;
        ensure!(expanded <= MAX_EXPANDED, "应用数据过大");
    }
    Ok(())
}

async fn download(client: &Client, release: &Release, info: &mut InstallStatus) -> Result<PathBuf> {
    let text = asset_response(client, release.checksums_id).await?.text().await?;
    ensure!(text.len() <= 65536, "校验文件过大");
    let name = format!("ting-reader-native-x86_64-{}.fpk", release.version);
    let expected = text.lines().find_map(|line| {
        let (digest, file) = line.split_once(char::is_whitespace)?;
        (file.trim().trim_start_matches('*') == name && digest.len() == 64
            && digest.bytes().all(|b| b.is_ascii_hexdigit())).then(|| digest.to_ascii_lowercase())
    }).context("找不到对应安装包的 SHA-256")?;
    let path = Path::new(ROOT).join(&name);
    let mut response = asset_response(client, release.asset_id).await?;
    let mut file = File::create(&path)?;
    let mut digest = Sha256::new();
    let mut received = 0_u64;
    while let Some(chunk) = response.chunk().await? {
        received += chunk.len() as u64;
        ensure!(received <= release.size, "安装包大小超出发布信息");
        file.write_all(&chunk)?;
        digest.update(&chunk);
        let progress = (received * 45 / release.size) as u32;
        if progress != info.progress { info.progress = progress; save_status(info)?; }
    }
    file.sync_all()?;
    ensure!(received == release.size && format!("{:x}", digest.finalize()) == expected, "安装包 SHA-256 校验失败");
    validate_fpk(&path, &release.version)?;
    Ok(path)
}

fn center_call(route: &str, payload: &Value) -> Result<Value> {
    ensure!(matches!(route, "/rpc/v1/download/task" | "/rpc/v1/download/status" | "/rpc/v1/update/info" | "/rpc/v1/update/task" | "/rpc/v1/common/status"), "不支持的应用中心操作");
    let output = Command::new("/usr/bin/curl").args(["--silent", "--show-error", "--fail", "--max-time", "15",
        "--unix-socket", "/var/run/com.trim.app.center.sock", "-H", "Content-Type: application/json",
        "--data-binary", &payload.to_string(), &format!("http://localhost{route}")]).output()?;
    ensure!(output.status.success() && output.stdout.len() <= 4 * 1024 * 1024, "无法连接飞牛应用中心");
    let response: Value = serde_json::from_slice(&output.stdout)?;
    ensure!(response["code"] == 0, "飞牛应用中心拒绝请求：{}", response["code"]);
    Ok(response["data"].clone())
}

async fn apply_release(request: &InstallRequest, info: &mut InstallStatus) -> Result<()> {
    let client = github_client(&token_from(Path::new(DATA))?)?;
    let release = parse_release(&github_json(&client, &format!("releases/tags/{}", request.tag)).await?)?;
    ensure!(release.version == request.version && newer(&release.version, &installed_version()), "请求版本与发布版本不一致");
    let package = download(&client, &release, info).await?;
    info.progress = 50;
    info.message = "安装包校验通过，正在交给飞牛应用中心".to_owned();
    save_status(info)?;
    let staged = center_call("/rpc/v1/download/task", &json!({ "packageSourceType": "file", "path": package }))?;
    let download_id = staged["downloadTaskId"].clone();
    ensure!(download_id.as_str().is_some_and(|id| !id.is_empty()) || download_id.as_u64().is_some_and(|id| id > 0), "飞牛未返回暂存任务编号");
    let mut staged_info = Value::Null;
    let mut failures = 0;
    for _ in 0..180 {
        let current = match center_call("/rpc/v1/download/status", &json!({ "downloadTaskId": download_id })) {
            Ok(value) => { failures = 0; value },
            Err(_) if failures < 5 => { failures += 1; tokio::time::sleep(Duration::from_secs(1)).await; continue; },
            Err(error) => return Err(error),
        };
        if current["status"] == 2 { staged_info = current; break; }
        ensure!(current["status"] == 1, "飞牛安装包暂存失败");
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    ensure!(staged_info["appName"] == APP && staged_info["version"].as_str().map(|version| version.trim_start_matches('v')) == Some(request.version.as_str())
        && staged_info["installed"] == true, "飞牛未识别为当前应用的正确更新，已中止");
    let package_type = staged_info["packageType"].as_str().context("更新包类型缺失")?;
    let mut payload = json!({ "appName": APP, "updateVersion": request.version, "packageType": package_type, "language": "zh-CN" });
    let details = center_call("/rpc/v1/update/info", &payload)?;
    let volume = details["wizardInfo"]["installedVolumeID"].as_u64().filter(|v| *v > 0).context("无法确认原安装卷")?;
    ensure!(details["wizardInfo"]["hasWizard"] != true, "此版本需要填写升级向导，请在应用中心安装");
    payload["systemParameters"] = json!({ "agreedToProtocol": true, "installVolumeID": volume, "dataVolumeId": volume, "immediateStart": true });
    payload["customParameters"] = json!([]);
    info.state = "installing".to_owned();
    info.message = "飞牛正在安装更新".to_owned();
    info.progress = 55;
    // From this point a connection failure must not cause a duplicate install.
    info.outcome_unknown = true;
    save_status(info)?;
    let submitted = center_call("/rpc/v1/update/task", &payload)?;
    let task_id = submitted["taskId"].clone();
    ensure!(task_id.as_str().is_some_and(|id| !id.is_empty()) || task_id.as_u64().is_some_and(|id| id > 0), "升级提交结果未确认，请勿重复提交");
    let deadline = std::time::Instant::now() + Duration::from_secs(900);
    let mut outage = None;
    loop {
        ensure!(std::time::Instant::now() < deadline, "升级任务结果超时，请在应用中心检查，暂勿重复升级");
        match center_call("/rpc/v1/common/status", &json!({ "taskId": task_id })) {
            Ok(task) => {
                outage = None;
                info.progress = 55 + task["progress"].as_u64().unwrap_or(0).min(100) as u32 * 44 / 100;
                save_status(info)?;
                if task["status"] == 2 || task["status"] == 5 { break; }
                ensure!(task["status"] == 1, "飞牛升级任务返回异常，请在应用中心检查");
            }
            Err(_) if installed_version() == request.version => break,
            Err(_) => {
                let since = outage.get_or_insert_with(std::time::Instant::now);
                ensure!(since.elapsed() <= Duration::from_secs(90), "暂时无法确认升级结果，请在应用中心检查，暂勿重复升级");
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    ensure!(installed_version() == request.version, "飞牛任务已结束，但安装版本未变化，请在应用中心检查");
    info.state = "completed".to_owned();
    info.progress = 100;
    info.message = format!("已确认安装 v{}", request.version);
    info.outcome_unknown = false;
    save_status(info)?;
    let _ = fs::remove_file(package);
    Ok(())
}

/// Only the fixed, root-owned installed helper calls this entry point.
pub async fn root_main(action: &str, request_id: Option<&str>) -> Result<InstallStatus> {
    #[cfg(unix)]
    ensure!(unsafe { libc::geteuid() } == 0, "需要飞牛应用中心安装权限");
    fs::create_dir_all(ROOT)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(ROOT, fs::Permissions::from_mode(0o700))?;
    }
    if action == "status" {
        let mut info = root_status();
        if !info.version.is_empty() && !newer(&info.version, &installed_version()) && Version::parse(&info.version).is_ok() {
            info.state = "completed".to_owned();
            info.progress = 100;
            info.outcome_unknown = false;
            info.message = format!("已确认安装 v{}", installed_version());
            save_status(&info)?;
        }
        if matches!(info.state.as_str(), "downloading" | "installing") && now().saturating_sub(info.started) > 20 {
            let unit_state = Command::new("/usr/bin/systemctl")
                .args(["show", &info.unit, "--property=ActiveState", "--value"]).output()?;
            let active = String::from_utf8_lossy(&unit_state.stdout);
            if !matches!(active.trim(), "active" | "activating" | "reloading") {
                info.state = "error".to_owned();
                info.message = "更新进程已结束，但安装版本尚未确认，请在应用中心检查".to_owned();
                save_status(&info)?;
            }
        }
        return Ok(info);
    }
    ensure!(action == "install" || action == "apply", "不支持的更新操作");
    let lock = OpenOptions::new().create(true).append(true).open(Path::new(ROOT).join("install.lock"))?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        ensure!(unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0, "更新任务正在运行");
    }
    if action == "install" {
    let request: InstallRequest = serde_json::from_slice(&private_read(&Path::new(DATA).join("update-request.json"))?)?;
    ensure!(Version::parse(&request.version).is_ok() && request.tag.len() < 80
        && request.tag.bytes().all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b)), "更新请求无效");
        ensure!(now().saturating_sub(request.created) <= 300 && request.created <= now(), "更新请求已过期");
        ensure!(newer(&request.version, &installed_version()), "目标版本不高于安装版本");
        let prior = root_status();
        ensure!(!prior.outcome_unknown && !matches!(prior.state.as_str(), "downloading" | "installing"), "上一次升级尚未确认，请在应用中心检查");
        let unit = format!("ting-reader-upgrade-{}", uuid::Uuid::new_v4().simple());
        let mut info = InstallStatus { state: "downloading".to_owned(), message: "正在读取并校验私有版本".to_owned(), version: request.version.clone(), unit: unit.clone(), started: now(), ..Default::default() };
        write_json(&Path::new(ROOT).join("request.json"), &request)?;
        save_status(&info)?;
        drop(lock);
        let result = Command::new("/usr/bin/systemd-run").args(["--collect", "--property=Type=exec", &format!("--unit={unit}"), HELPER, "apply", &unit]).output()?;
        if !result.status.success() {
            info.state = "error".to_owned();
            info.message = "无法启动独立更新任务".to_owned();
            save_status(&info)?;
            bail!("无法启动独立更新任务");
        }
        return Ok(info);
    }
    let mut info = root_status();
    ensure!(Some(info.unit.as_str()) == request_id, "更新任务编号不匹配");
    let request: InstallRequest = serde_json::from_slice(&fs::read(Path::new(ROOT).join("request.json"))?)?;
    if let Err(error) = apply_release(&request, &mut info).await {
        info.state = "error".to_owned();
        info.message = error.to_string();
        save_status(&info)?;
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release() -> Value {
        json!({ "draft": false, "prerelease": false, "tag_name": "v2.1.0-build.2",
            "assets": [{ "name": "ting-reader-native-x86_64-2.1.0.fpk", "id": 11, "size": 123 },
                { "name": "SHA256SUMS.txt", "id": 12 }], "body": "Notes" })
    }

    #[test]
    fn only_private_release_with_correct_arch_and_checksums_is_accepted() {
        assert_eq!(parse_release(&release()).unwrap().version, "2.1.0");
        let mut bad = release();
        bad["assets"][0]["name"] = json!("ting-reader-native-arm64-2.1.0.fpk");
        assert!(parse_release(&bad).is_err());
        let mut bad = release();
        bad["prerelease"] = json!(true);
        assert!(parse_release(&bad).is_err());
        let mut bad = release();
        bad["assets"].as_array_mut().unwrap().pop();
        assert!(parse_release(&bad).is_err());
    }

    #[test]
    fn upgrades_do_not_offer_equal_older_or_invalid_versions() {
        assert!(newer("2.1.1", "2.1.0"));
        assert!(!newer("2.1.0", "2.1.0"));
        assert!(!newer("2.0.9", "2.1.0"));
        assert!(!newer("invalid", "2.1.0"));
        assert!(!valid_member(Path::new("../cmd/main")));
        assert!(!valid_member(Path::new("/etc/passwd")));
        assert!(valid_member(Path::new("server/static/index.html")));
    }
    #[test]
    fn package_validation_rejects_mismatched_identity_and_payload_checksum() {
        use flate2::{Compression, write::GzEncoder};
        fn pack(app: &str, version: &str, checksum: &str) -> tempfile::NamedTempFile {
            let mut payload = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
            let bytes = b"test fixture";
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            payload.append_data(&mut header, "server/static/index.html", &bytes[..]).unwrap();
            let payload = payload.into_inner().unwrap().finish().unwrap();
            let manifest = format!("appname = {app}\nversion = {version}\nplatform = x86\nchecksum = {checksum}\n");
            let mut archive = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
            for (name, bytes) in [("manifest", manifest.as_bytes()), ("app.tgz", payload.as_slice())] {
                let mut header = tar::Header::new_gnu();
                header.set_size(bytes.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                archive.append_data(&mut header, name, bytes).unwrap();
            }
            let mut file = tempfile::NamedTempFile::new().unwrap();
            file.write_all(&archive.into_inner().unwrap().finish().unwrap()).unwrap();
            file
        }
        assert!(validate_fpk(pack("another-app", "2.1.0", "bad").path(), "2.1.0").is_err());
        assert!(validate_fpk(pack(APP, "2.0.9", "bad").path(), "2.1.0").is_err());
        assert!(validate_fpk(pack(APP, "2.1.0", "00000000000000000000000000000000").path(), "2.1.0").is_err());
    }

}
