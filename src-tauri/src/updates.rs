use serde::Serialize;
use std::time::Duration;
use tauri::{async_runtime::Mutex, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct AvailableUpdate {
    version: String,
}

// Only the isolated updater smoke test sets this; release config must never.
fn insecure_transport(updater: Option<&serde_json::Value>) -> bool {
    updater
        .and_then(|config| config.get("dangerousInsecureTransportProtocol"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

// The person approved one version; a re-check that found another must not install it.
fn approved(pending: &str, version: &str) -> Result<(), String> {
    if pending != version {
        return Err("The update changed. Check for updates again.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    state: State<'_, Updates>,
) -> Result<Option<AvailableUpdate>, String> {
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let allow_http = insecure_transport(app.config().plugins.0.get("updater"));
    let mut update = app
        .updater_builder()
        .configure_client(move |client| client.https_only(!allow_http))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    if let Some(update) = &mut update {
        update.timeout = Some(Duration::from_secs(120));
    }
    let available = update.as_ref().map(|update| AvailableUpdate {
        version: update.version.clone(),
    });
    *pending = update;
    Ok(available)
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, Updates>,
    version: String,
) -> Result<(), String> {
    let pending = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let update = pending.as_ref().ok_or("Check for updates first.")?;
    approved(&update.version, &version)?;
    // The plugin verifies the archive and its signed version before replacing the app.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn installs_only_the_approved_version() {
        assert!(approved("0.9.1", "0.9.1").is_ok());
        assert!(approved("0.9.2", "0.9.1").is_err());
        assert!(approved("0.9.1", "").is_err());
    }

    #[test]
    fn insecure_transport_is_off_unless_explicitly_true() {
        assert!(!insecure_transport(None));
        assert!(!insecure_transport(Some(&json!({}))));
        assert!(!insecure_transport(Some(
            &json!({ "dangerousInsecureTransportProtocol": "true" })
        )));
        assert!(insecure_transport(Some(
            &json!({ "dangerousInsecureTransportProtocol": true })
        )));
    }

    #[test]
    fn release_config_requires_signed_https_updates() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &config["plugins"]["updater"];
        assert!(!updater["pubkey"].as_str().unwrap_or_default().is_empty());
        assert_eq!(updater["requireSignedVersion"], true);
        let endpoints = updater["endpoints"].as_array().unwrap();
        assert!(!endpoints.is_empty());
        for endpoint in endpoints {
            assert!(endpoint.as_str().unwrap().starts_with("https://"));
        }
        for flag in [
            "dangerousInsecureTransportProtocol",
            "dangerousAcceptInvalidCerts",
            "dangerousAcceptInvalidHostnames",
            "allowDowngrades",
        ] {
            assert_ne!(
                updater[flag], true,
                "{flag} must stay off in release config"
            );
        }
        assert!(!insecure_transport(Some(updater)));
    }
}
