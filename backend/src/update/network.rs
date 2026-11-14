//! Isolated updater transport: bearer credentials never reach download mirrors.
use super::{InstallStatus, REPO, save_status};
use anyhow::{Result, bail, ensure};
use reqwest::{Client, Response, Url, header, redirect::Policy};
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

pub(super) const MIRRORS: [&str; 7] = [
    "https://gh-proxy.org/",
    "https://gh.llkk.cc/",
    "https://github.moeyy.xyz/",
    "https://ghproxy.cn/",
    "https://gh.api.99988866.xyz/",
    "https://ghp.ci/",
    "https://ghproxy.net/",
];
const PROXIES: [&str; 2] = ["http://127.0.0.1:7890", "http://127.0.0.1:7893"];
pub(super) const HEADER_WAIT: Duration = Duration::from_secs(15);
pub(super) const DOWNLOAD_LIMIT: Duration = Duration::from_secs(1800);

pub(super) struct Network {
    token: header::HeaderValue,
    clients: Vec<Client>,
    selected: AtomicUsize,
}
#[derive(Clone)]
pub(super) struct Source {
    pub label: String,
    pub url: Url,
    proxy: Option<&'static str>,
    authenticated: bool,
}
pub(super) enum Asset {
    Signed(Url),
    Direct,
}
fn github_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.host_str().is_some_and(|h| {
            h == "api.github.com" || h == "github.com" || h.ends_with(".githubusercontent.com")
        })
}
fn download_url(url: &Url) -> bool {
    github_url(url)
        || (url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443)
            && MIRRORS.iter().any(|m| {
                Url::parse(m)
                    .ok()
                    .and_then(|u| u.host_str().map(str::to_owned))
                    .as_deref()
                    == url.host_str()
            }))
}
fn client(proxy: Option<&str>, follow: bool) -> Result<Client> {
    let mut b = Client::builder()
        .no_proxy()
        .user_agent("OrangeAudiobook-PrivateUpdater")
        .connect_timeout(Duration::from_secs(5))
        .timeout(DOWNLOAD_LIMIT)
        .redirect(if follow {
            Policy::custom(|a| {
                if a.previous().len() < 5 && download_url(a.url()) {
                    a.follow()
                } else {
                    a.stop()
                }
            })
        } else {
            Policy::none()
        });
    if let Some(p) = proxy {
        b = b.proxy(reqwest::Proxy::all(p)?);
    }
    Ok(b.build()?)
}
pub(super) fn announce(info: &mut InstallStatus, label: &str, message: &str) -> Result<()> {
    info.network = label.to_owned();
    info.message = message.to_owned();
    save_status(info)
}
impl Network {
    pub fn new(token: &str) -> Result<Self> {
        let mut value = header::HeaderValue::from_str(&format!("Bearer {token}"))?;
        value.set_sensitive(true);
        let clients = PROXIES
            .iter()
            .map(|p| client(Some(p), false))
            .chain(std::iter::once(client(None, false)))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            token: value,
            clients,
            selected: AtomicUsize::new(usize::MAX),
        })
    }
    fn order(&self) -> Vec<usize> {
        let selected = self.selected.load(Ordering::Relaxed);
        let mut order = vec![0, 1, 2];
        if selected < 2 {
            order.retain(|i| *i != selected);
            order.insert(0, selected);
        }
        order
    }
    async fn api(
        &self,
        suffix: &str,
        accept: &str,
        mut info: Option<&mut InstallStatus>,
    ) -> Result<Response> {
        let url = format!("https://api.github.com/repos/{REPO}/{suffix}");
        for i in self.order() {
            if let Some(status) = info.as_deref_mut() {
                let label = if i < 2 {
                    format!("本机加速：{}", PROXIES[i].trim_start_matches("http://"))
                } else {
                    "本机加速不可用，正在准备第三方加速".to_owned()
                };
                announce(status, &label, "正在读取并校验私有版本")?;
            }
            let request = self.clients[i]
                .get(&url)
                .header(header::AUTHORIZATION, self.token.clone())
                .header(header::ACCEPT, accept)
                .header(header::CACHE_CONTROL, "no-cache")
                .timeout(Duration::from_secs(45))
                .send();
            if let Ok(Ok(response)) = tokio::time::timeout(HEADER_WAIT, request).await {
                if response.status().as_u16() == 401 {
                    bail!("GitHub 令牌已失效，请重新保存只读令牌");
                }
                if response.status().is_success() || response.status().is_redirection() {
                    self.selected.store(i, Ordering::Relaxed);
                    return Ok(response);
                }
            }
        }
        bail!("本机代理和 GitHub 授权接口均不可达，无法获取私有更新的临时下载地址")
    }
    pub async fn json(&self, suffix: &str, info: Option<&mut InstallStatus>) -> Result<Value> {
        let response = self
            .api(suffix, "application/vnd.github+json", info)
            .await?;
        ensure!(
            response.status().is_success(),
            "读取私有版本失败，请检查令牌权限"
        );
        let bytes = small_body(response, 2 * 1024 * 1024).await?;
        serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("GitHub 返回的版本信息无效"))
    }
    pub async fn asset(&self, id: u64) -> Result<Asset> {
        let response = self
            .api(
                &format!("releases/assets/{id}"),
                "application/octet-stream",
                None,
            )
            .await?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|h| h.to_str().ok())
                .and_then(|h| Url::parse(h).ok())
                .ok_or_else(|| anyhow::anyhow!("GitHub 临时下载地址无效"))?;
            ensure!(github_url(&location), "GitHub 临时下载地址不在允许范围内");
            Ok(Asset::Signed(location))
        } else {
            // GitHub may stream a private asset instead of returning a redirect.
            Ok(Asset::Direct)
        }
    }
    pub async fn checksum(&self, id: u64) -> Result<Vec<u8>> {
        let response = self
            .api(
                &format!("releases/assets/{id}"),
                "application/octet-stream",
                None,
            )
            .await?;
        if response.status().is_redirection() {
            let signed = response
                .headers()
                .get(header::LOCATION)
                .and_then(|h| h.to_str().ok())
                .and_then(|h| Url::parse(h).ok())
                .ok_or_else(|| anyhow::anyhow!("校验文件下载地址无效"))?;
            ensure!(github_url(&signed), "校验文件下载地址无效");
            for i in self.order() {
                let proxy = PROXIES.get(i).copied();
                let c = client(proxy, true)?;
                let result = tokio::time::timeout(
                    HEADER_WAIT,
                    c.get(signed.clone())
                        .timeout(Duration::from_secs(45))
                        .send(),
                )
                .await;
                if let Ok(Ok(r)) = result
                    && r.status().is_success()
                    && let Ok(bytes) = small_body(r, 65536).await
                {
                    return Ok(bytes);
                }
            }
            bail!("无法从 GitHub 获取可信校验文件");
        }
        ensure!(response.status().is_success(), "获取校验文件失败");
        small_body(response, 65536).await
    }
    pub fn sources(&self, id: u64, asset: Asset) -> Result<Vec<Source>> {
        let (url, authenticated) = match asset {
            Asset::Signed(url) => (url, false),
            Asset::Direct => (
                Url::parse(&format!(
                    "https://api.github.com/repos/{REPO}/releases/assets/{id}"
                ))?,
                true,
            ),
        };
        let mut sources = Vec::new();
        let mut local = [0, 1];
        let selected = self.selected.load(Ordering::Relaxed);
        if selected == 1 {
            local.reverse();
        }
        for i in local {
            sources.push(Source {
                label: format!("本机加速：{}", PROXIES[i].trim_start_matches("http://")),
                url: url.clone(),
                proxy: Some(PROXIES[i]),
                authenticated,
            });
        }
        if !authenticated {
            for mirror in MIRRORS {
                let host = Url::parse(mirror)?
                    .host_str()
                    .unwrap_or_default()
                    .to_owned();
                sources.push(Source {
                    label: format!("第三方加速：{host}"),
                    url: Url::parse(&format!("{mirror}{url}"))?,
                    proxy: None,
                    authenticated: false,
                });
            }
        }
        sources.push(Source {
            label: "GitHub 直连备用线路".to_owned(),
            url,
            proxy: None,
            authenticated,
        });
        Ok(sources)
    }
    fn request(&self, c: &Client, source: &Source, offset: u64) -> reqwest::RequestBuilder {
        let mut request = c
            .get(source.url.clone())
            .header(header::ACCEPT_ENCODING, "identity");
        if source.authenticated {
            request = request
                .header(header::AUTHORIZATION, self.token.clone())
                .header(header::ACCEPT, "application/octet-stream");
        }
        if offset > 0 {
            request = request.header(header::RANGE, format!("bytes={offset}-"));
        }
        request
    }
    pub async fn open(&self, source: &Source, offset: u64) -> Result<Response> {
        ensure!(download_url(&source.url), "下载地址不在允许范围内");
        ensure!(
            !source.authenticated || source.url.host_str() == Some("api.github.com"),
            "不能向第三方发送令牌"
        );
        let c = client(source.proxy, !source.authenticated)?;
        let mut response =
            tokio::time::timeout(HEADER_WAIT, self.request(&c, source, offset).send())
                .await
                .map_err(|_| anyhow::anyhow!("下载线路连接超时"))?
                .map_err(|_| anyhow::anyhow!("下载线路连接失败"))?;
        if source.authenticated && response.status().is_redirection() {
            let url = response
                .headers()
                .get(header::LOCATION)
                .and_then(|h| h.to_str().ok())
                .and_then(|h| Url::parse(h).ok())
                .ok_or_else(|| anyhow::anyhow!("临时下载地址无效"))?;
            ensure!(github_url(&url), "临时下载地址无效");
            let anon = Source {
                label: source.label.clone(),
                url,
                proxy: source.proxy,
                authenticated: false,
            };
            let c = client(source.proxy, true)?;
            response = tokio::time::timeout(HEADER_WAIT, self.request(&c, &anon, offset).send())
                .await
                .map_err(|_| anyhow::anyhow!("下载线路连接超时"))?
                .map_err(|_| anyhow::anyhow!("下载线路连接失败"))?;
        }
        Ok(response)
    }
}
async fn small_body(mut response: Response, maximum: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::time::timeout(HEADER_WAIT, response.chunk())
            .await
            .map_err(|_| anyhow::anyhow!("GitHub 信息传输超时"))?
            .map_err(|_| anyhow::anyhow!("GitHub 信息传输中断"))?;
        let Some(chunk) = chunk else {
            return Ok(bytes);
        };
        ensure!(
            bytes.len() + chunk.len() <= maximum,
            "GitHub 信息大小超出限制"
        );
        bytes.extend_from_slice(&chunk);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_routes_precede_ordered_mirrors_and_tokens_never_enter_mirror_requests() {
        let n = Network::new("synthetic_read_only_token").unwrap();
        let signed = Url::parse(
            "https://release-assets.githubusercontent.com/asset.fpk?sig=temporary&se=expires",
        )
        .unwrap();
        let sources = n.sources(1, Asset::Signed(signed.clone())).unwrap();
        assert!(sources[0].label.contains("7890"));
        assert!(sources[1].label.contains("7893"));
        assert_eq!(sources.len(), 10);
        let c = client(None, false).unwrap();
        for (i, mirror) in MIRRORS.iter().enumerate() {
            let source = &sources[i + 2];
            assert_eq!(source.url.as_str(), format!("{mirror}{signed}"));
            let r = n.request(&c, source, 1024).build().unwrap();
            assert!(r.headers().get(header::AUTHORIZATION).is_none());
            assert_eq!(r.headers()[header::RANGE], "bytes=1024-");
        }
    }
    #[test]
    fn unsafe_redirects_and_authenticated_third_party_sources_are_rejected() {
        for u in [
            "http://github.com/a",
            "https://127.0.0.1/a",
            "https://github.com.attacker.test/a",
            "https://user:pass@github.com/a",
            "https://github.com:444/a",
        ] {
            assert!(!download_url(&Url::parse(u).unwrap()), "{u}");
        }
        assert!(download_url(
            &Url::parse(
                "https://gh-proxy.org/https://release-assets.githubusercontent.com/file?sig=x"
            )
            .unwrap()
        ));
        let n = Network::new("synthetic_read_only_token").unwrap();
        assert!(
            n.sources(1, Asset::Direct)
                .unwrap()
                .iter()
                .all(|s| !s.label.contains("第三方"))
        );
    }
}
