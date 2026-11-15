//! Cover image proxy handler

use crate::api::state::AppState;
use crate::core::app::error::{InputErrorKind, LookupErrorKind, SecurityErrorKind};
use crate::core::app::error::{Result, TingError};
use crate::core::LruCache;
use crate::db::repository::Repository;
use axum::{
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// A shelf shows many covers at once, so thumbnails are produced once and
/// reused instead of shipping (and decoding) the full-size artwork every time.
const COVER_THUMB_CACHE_BYTES: u64 = 32 * 1024 * 1024;
const COVER_CACHE_CONTROL: &str = "public, max-age=3600";
const MIN_THUMB_WIDTH: u32 = 64;
const MAX_THUMB_WIDTH: u32 = 1024;

/// Query parameters for cover image proxy
#[derive(Debug, serde::Deserialize)]
pub struct ProxyCoverQuery {
    pub path: String,
    pub library_id: Option<String>,
    pub book_id: Option<String>,
    /// Requested thumbnail width in pixels; omit to receive the original file.
    pub w: Option<u32>,
}

/// GET /api/proxy/cover - Proxy cover images (local files, external URLs, WebDAV)
pub async fn proxy_cover(
    State(state): State<AppState>,
    Query(params): Query<ProxyCoverQuery>,
    request_headers: HeaderMap,
) -> Result<Response> {
    if params.path == "embedded://first-chapter" {
        return Err(TingError::not_found(
            LookupErrorKind::Resource,
            "proxy_cover::not_found",
            "Embedded cover extraction not yet implemented".to_string(),
        ));
    }

    if params.path.starts_with("http") {
        let mut target_url = params.path.clone();
        let mut referer = "".to_string();

        if let Some(idx) = target_url.find("#referer=") {
            referer = target_url[idx + 9..].to_string();
            target_url = target_url[..idx].to_string();
        }

        tracing::info!(
            "Proxying external image: {}, referer: {}",
            target_url,
            referer
        );

        let client = reqwest::Client::new();
        let mut req = client.get(&target_url)
            .header(reqwest::header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

        if !referer.is_empty() {
            req = req.header(reqwest::header::REFERER, referer);
        }

        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                let content_type = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let bytes = resp
                    .bytes()
                    .await
                    .map_err(|e| TingError::IoError(std::io::Error::other(e)))?;
                return Ok((
                    StatusCode::OK,
                    [
                        (header::CONTENT_TYPE, content_type),
                        (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
                        (
                            header::CACHE_CONTROL,
                            "public, max-age=31536000".to_string(),
                        ),
                        (
                            "Cross-Origin-Resource-Policy".parse().unwrap(),
                            "cross-origin".to_string(),
                        ),
                    ],
                    bytes.to_vec(),
                )
                    .into_response());
            }
            Ok(resp) => {
                return Err(TingError::not_found(
                    LookupErrorKind::Resource,
                    "proxy_cover::not_found",
                    format!("Failed to fetch external cover: HTTP {}", resp.status()),
                ));
            }
            Err(e) => {
                return Err(TingError::not_found(
                    LookupErrorKind::Resource,
                    "proxy_cover::not_found",
                    format!("Failed to fetch external cover: {}", e),
                ));
            }
        }
    }

    let final_path = resolve_cover_path(&state, &params).await?;

    let file_meta = tokio::fs::metadata(&final_path).await?;
    let file_len = file_meta.len();
    let modified_nanos = file_meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|delta| delta.as_nanos())
        .unwrap_or(0);
    let thumb_width = params
        .w
        .filter(|width| *width > 0)
        .map(|width| width.clamp(MIN_THUMB_WIDTH, MAX_THUMB_WIDTH));

    // Both the file bytes and the requested width identify the resource, so
    // replacing a cover or asking for another size never reuses stale bytes.
    let etag = format!(
        "\"{:x}-{:x}-{}\"",
        file_len,
        modified_nanos,
        thumb_width.unwrap_or(0)
    );
    if let Some(candidate) = request_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        && candidate
            .split(',')
            .any(|token| token.trim().trim_start_matches("W/") == etag)
    {
        return Ok((
            StatusCode::NOT_MODIFIED,
            [
                (header::ETAG, etag),
                (
                    header::CACHE_CONTROL,
                    COVER_CACHE_CONTROL.to_string(),
                ),
            ],
        )
            .into_response());
    }

    let mut content_type = mime_guess::from_path(&final_path)
        .first_or_octet_stream()
        .to_string();
    let body_bytes: Bytes = match thumb_width {
        Some(width) => {
            let cache_key = format!("{}|{file_len}|{modified_nanos}|{width}", final_path.display());
            let cached = cover_cache()
                .lock()
                .ok()
                .and_then(|mut cache| cache.get(&cache_key).cloned());
            match cached {
                Some(cached) => {
                    content_type = "image/jpeg".to_string();
                    cached
                }
                None => {
                    let source = Bytes::from(tokio::fs::read(&final_path).await?);
                    let input = source.clone();
                    match tokio::task::spawn_blocking(move || thumbnail_bytes(&input, width)).await {
                        Ok(Some(thumbnail)) => {
                            let thumbnail = Bytes::from(thumbnail);
                            if let Ok(mut cache) = cover_cache().lock() {
                                cache.insert(
                                    cache_key,
                                    thumbnail.clone(),
                                    thumbnail.len() as u64,
                                );
                            }
                            content_type = "image/jpeg".to_string();
                            thumbnail
                        }
                        // Undecodable artwork still has to render: fall back to
                        // the original file instead of failing the request.
                        _ => source,
                    }
                }
            }
        }
        None => Bytes::from(tokio::fs::read(&final_path).await?),
    };

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, COVER_CACHE_CONTROL.to_string()),
            (header::ETAG, etag),
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
            (
                "Cross-Origin-Resource-Policy".parse().unwrap(),
                "cross-origin".to_string(),
            ),
        ],
        Body::from(body_bytes),
    )
        .into_response())
}

fn cover_cache() -> &'static Mutex<LruCache<String, Bytes>> {
    static CACHE: OnceLock<Mutex<LruCache<String, Bytes>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(LruCache::new(COVER_THUMB_CACHE_BYTES)))
}

/// Downscale a cover to `width` pixels and encode it as a compact JPEG.
/// Returns `Ok(None)` when the source already fits or cannot be decoded.
fn thumbnail_bytes(source: &[u8], width: u32) -> Option<Vec<u8>> {
    let reader = image::ImageReader::new(std::io::Cursor::new(source))
        .with_guessed_format()
        .ok()?;
    let decoded = reader.decode().ok()?;
    let (source_width, source_height) = (decoded.width(), decoded.height());
    if source_width == 0 || source_height == 0 || source_width <= width {
        return None;
    }
    let target_height = ((u64::from(source_height) * u64::from(width)) / u64::from(source_width))
        .max(1) as u32;
    let mut rgba = decoded.into_rgba8();
    for pixel in rgba.pixels_mut() {
        let alpha = u32::from(pixel[3]);
        for channel in &mut pixel.0[..3] {
            *channel = ((u32::from(*channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        }
        pixel[3] = 255;
    }
    let rgb = image::DynamicImage::ImageRgba8(rgba).into_rgb8();
    let resized = image::imageops::resize(
        &rgb,
        width,
        target_height,
        image::imageops::FilterType::Triangle,
    );
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 78)
        .encode_image(&resized)
        .ok()?;
    Some(jpeg)
}

async fn resolve_cover_path(state: &AppState, params: &ProxyCoverQuery) -> Result<PathBuf> {
    let normalized_path = params.path.replace('\\', "/");
    let image_path = Path::new(&normalized_path);

    if image_path.exists() {
        return Ok(image_path.to_path_buf());
    }

    if !image_path.is_absolute() {
        let relative = normalize_cover_relative_path(&normalized_path)?;

        if let Some(book_id) = params.book_id.as_deref()
            && let Some(book) = state.book_repo.find_by_id(book_id).await?
        {
            let candidate = Path::new(&book.path).join(&relative);
            if candidate.exists() {
                return Ok(candidate);
            }
        }

        if let Some(library_id) = params.library_id.as_deref()
            && let Some(library) = state.library_repo.find_by_id(library_id).await?
        {
            let root_path = library.root_path.trim();
            if !root_path.is_empty() {
                let candidate = Path::new(root_path).join(&relative);
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            let candidate = cwd.join(&relative);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(TingError::not_found(
        LookupErrorKind::File,
        "resolve_cover_path::not_found",
        format!("Cover image not found: {}", params.path),
    ))
}

fn normalize_cover_relative_path(value: &str) -> Result<PathBuf> {
    let raw = Path::new(value.trim());
    if raw.is_absolute() {
        return Err(TingError::security(
            SecurityErrorKind::PathEscape,
            "normalize_cover_relative_path::security",
            "Cover image path must be relative".to_string(),
        ));
    }

    let mut normalized = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(TingError::security(
                    SecurityErrorKind::PathEscape,
                    "normalize_cover_relative_path::security",
                    "Cover image path cannot escape its base directory".to_string(),
                ));
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err(TingError::invalid_request(
            InputErrorKind::MissingField,
            "normalize_cover_relative_path::invalid_request",
            "Cover image path is required".to_string(),
        ));
    }

    Ok(normalized)
}
