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

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    state: State<'_, Updates>,
) -> Result<Option<AvailableUpdate>, String> {
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let allow_http = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("dangerousInsecureTransportProtocol"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
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
    if update.version != version {
        return Err("The update changed. Check for updates again.".into());
    }
    // The plugin verifies the archive and its signed version before replacing the app.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.request_restart();
    Ok(())
}
