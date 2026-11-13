//! Persist scraper-provided artwork; never extract an audio attachment into a book.
use anyhow::{Context, Result, ensure};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

const MAX_BYTES: usize = 16 * 1024 * 1024;

pub async fn save_remote_cover(directory: &Path, reference: &str) -> Result<Option<PathBuf>> {
    if !reference.starts_with("https://") && !reference.starts_with("http://") {
        return Ok(None);
    }
    let (url, referer) = reference.split_once("#referer=").unwrap_or((reference, ""));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let mut request = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0");
    if !referer.is_empty() {
        request = request.header(reqwest::header::REFERER, referer);
    }
    let mut response = request.send().await?.error_for_status()?;
    if let Some(size) = response.content_length() {
        ensure!(size <= MAX_BYTES as u64, "Cover image is too large");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            bytes.len() + chunk.len() <= MAX_BYTES,
            "Cover image is too large"
        );
        bytes.extend_from_slice(&chunk);
    }
    let directory = directory.to_path_buf();
    tokio::task::spawn_blocking(move || save_jpeg(&directory, &bytes))
        .await?
        .map(Some)
}

fn save_jpeg(directory: &Path, bytes: &[u8]) -> Result<PathBuf> {
    let reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let (width, height) = reader
        .into_dimensions()
        .context("Cover response is not an image")?;
    ensure!(
        width > 0 && height > 0 && u64::from(width) * u64::from(height) <= 32_000_000,
        "Invalid cover image dimensions"
    );
    let decoded = image::load_from_memory(bytes)?
        .resize_exact(600, 600, image::imageops::FilterType::Lanczos3)
        .to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 92).encode_image(&decoded)?;
    let target = directory.join("cover.jpg");
    ensure!(
        !target.is_symlink(),
        "Refusing to overwrite a cover symlink"
    );
    if std::fs::read(&target).ok().as_deref() == Some(jpeg.as_slice()) {
        return Ok(target);
    }
    let temporary = directory.join(format!(".cover-{}.jpg", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o644);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&jpeg)?;
        file.sync_all()?;
        std::fs::rename(&temporary, &target)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn downloaded_png_is_saved_as_a_real_jpeg_and_bad_data_does_not_replace_it() {
        let directory = tempfile::tempdir().unwrap();
        let image = image::DynamicImage::new_rgb8(8, 12);
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let target = save_jpeg(directory.path(), png.get_ref()).unwrap();
        let saved = std::fs::read(&target).unwrap();
        assert_eq!(
            image::guess_format(&saved).unwrap(),
            image::ImageFormat::Jpeg
        );
        let decoded = image::load_from_memory(&saved).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (600, 600));
        assert!(save_jpeg(directory.path(), b"<html>advert redirect</html>").is_err());
        assert_eq!(std::fs::read(target).unwrap(), saved);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    #[cfg(unix)]
    #[test]
    fn cover_symlink_is_not_followed() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), directory.path().join("cover.jpg")).unwrap();
        let image = image::DynamicImage::new_rgb8(4, 4);
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).unwrap();
        assert!(save_jpeg(directory.path(), png.get_ref()).is_err());
        assert_eq!(std::fs::metadata(outside.path()).unwrap().len(), 0);
    }
}
