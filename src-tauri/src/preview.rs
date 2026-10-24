use std::{collections::HashMap, sync::Mutex};
use tauri::{
    http::{Request, Response},
    Manager, State,
};

#[derive(Default)]
pub struct Previews(pub Mutex<HashMap<String, String>>);

#[tauri::command]
pub fn publish_preview(state: State<Previews>, id: String, html: String) -> Result<String, String> {
    if id.len() != 36
        || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        || html.len() > 32 * 1024 * 1024
    {
        return Err("Invalid or oversized preview".into());
    }
    let mut pages = state.0.lock().unwrap();
    if !pages.contains_key(&id) && pages.len() >= 8 {
        return Err("Too many active previews".into());
    }
    pages.insert(id.clone(), html);
    Ok(format!("sidelit-preview://localhost/{id}"))
}

#[tauri::command]
pub fn release_preview(state: State<Previews>, id: String) {
    state.0.lock().unwrap().remove(&id);
}

pub fn response(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = request.uri().path().trim_start_matches('/');
    let html = app.state::<Previews>().0.lock().unwrap().get(path).cloned();
    Response::builder()
        .status(if html.is_some() { 200 } else { 404 })
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(
            html.unwrap_or_else(|| "Preview expired. Refresh to load it again.".into())
                .into_bytes(),
        )
        .unwrap()
}

pub fn local_server(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        && url.username().is_empty()
        && url.password().is_none()
        && !(url.host_str() == Some("127.0.0.1") && url.port() == Some(1420))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn server_navigation_is_loopback_only_and_never_the_privileged_dev_origin() {
        for address in [
            "http://localhost:3000/page",
            "http://127.0.0.1:5173",
            "https://[::1]:4321",
        ] {
            assert!(local_server(&url::Url::parse(address).unwrap()));
        }
        for address in [
            "https://example.com",
            "http://localhost.evil:3000",
            "http://user@localhost",
            "file:///tmp/a.html",
            "http://127.0.0.1:1420",
        ] {
            assert!(!local_server(&url::Url::parse(address).unwrap()));
        }
    }
}
