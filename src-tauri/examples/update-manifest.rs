use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde_json::json;
use std::{error::Error, fs, path::PathBuf};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn verify(public_key: &str, signature: &str, bytes: &[u8], version: &str) -> Result<()> {
    let public_key = PublicKey::decode(&String::from_utf8(STANDARD.decode(public_key.trim())?)?)?;
    let signature = Signature::decode(&String::from_utf8(STANDARD.decode(signature.trim())?)?)?;
    public_key.verify(bytes, &signature, true)?;
    // Only the verified trusted comment can bind the archive to its advertised version.
    let signed_version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|s| s.strip_prefix("version:"));
    if signed_version != Some(version) {
        return Err("The signature must bind this archive to the release version.".into());
    }
    Ok(())
}

fn main() -> Result<()> {
    let bundle = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Usage: update-manifest BUNDLE_DIRECTORY")?,
    );
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))?;
    let version = config["version"].as_str().ok_or("Missing app version")?;
    let public_key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Missing update public key")?;
    let signature = fs::read_to_string(bundle.join("macos/Sidelit.app.tar.gz.sig"))?;
    verify(
        public_key,
        &signature,
        &fs::read(bundle.join("macos/Sidelit.app.tar.gz"))?,
        version,
    )?;
    let artifact = json!({
        "url": format!("https://github.com/heath0xFF/sidelit/releases/download/v{version}/Sidelit.app.tar.gz"),
        "signature": signature.trim(),
    });
    let manifest = json!({
        "version": version,
        "platforms": { "darwin-aarch64": artifact, "darwin-x86_64": artifact },
    });
    fs::write(
        bundle.join("latest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    println!("Verified update signature and signed version {version}; wrote latest.json.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg4NEY0OTIwOUY0MTkyODMKUldTRGtrR2ZJRWxQaUJ4R1JMREVyVDBLZ1JHaHhid3padHNsTmpYUytQUTNxY0U5VzM4MnNoWSsK";
    const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTRGtrR2ZJRWxQaU1laDg1Y3U0TWlXOGc0UEIrR29VQ3R0TDQ3NDNiYWxRMFpYOWFGU29acW5HdjJuMnlzNzRrb1c3NDdTZG1hTWZrTXRaNTNUZWZUdE0xc3EvRzFSN3dzPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxODQ1Nzc3CWZpbGU6c2lnbmVkLnR4dAl2ZXJzaW9uOjEuMi4zCjBYc1ZvaWlicmNUOUhuQXpXS0F3L0YzYkVwSGRnV0JiTmNKWTYyY2xlTkhManFROFN1a1NYeW13YnY0Z3RFMHNxY1pEWTFFRDBVa0FvM0kyRWF0VUNRPT0K";
    const CONTENT: &[u8] = b"Sidelit updater test\n";

    #[test]
    fn accepts_the_signed_archive_and_version() {
        verify(KEY, SIGNATURE, CONTENT, "1.2.3").unwrap();
    }

    #[test]
    fn rejects_changed_bytes_or_advertised_version() {
        assert!(verify(KEY, SIGNATURE, b"changed", "1.2.3").is_err());
        assert!(verify(KEY, SIGNATURE, CONTENT, "9.9.9").is_err());
    }

    #[test]
    fn rejects_an_edited_trusted_comment_or_invalid_signature() {
        let decoded = String::from_utf8(STANDARD.decode(SIGNATURE).unwrap()).unwrap();
        let edited = STANDARD.encode(decoded.replace("version:1.2.3", "version:9.9.9"));
        assert!(verify(KEY, &edited, CONTENT, "9.9.9").is_err());
        assert!(verify(KEY, "invalid", CONTENT, "1.2.3").is_err());
    }
}
