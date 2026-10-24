use crate::{
    cli::{self, Request},
    files::{self, Result, SaveResult, Snapshot},
    recovery::{Recovery, Session, Status},
    search,
};
use base64::Engine;
use notify_debouncer_full::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer, RecommendedCache,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct Inner {
    roots: HashSet<PathBuf>,
    grants: HashSet<PathBuf>,
    open: HashSet<PathBuf>,
    directories: HashSet<PathBuf>,
    assets: HashMap<PathBuf, HashSet<PathBuf>>,
    watchers: HashMap<PathBuf, Debouncer<RecommendedWatcher, RecommendedCache>>,
    requests: VecDeque<Request>,
}
#[derive(Default)]
pub struct Service(pub Mutex<Inner>);

impl Inner {
    fn allowed(&self, path: &Path) -> Result<PathBuf> {
        let p = files::identity(path)?;
        if self.grants.contains(&p) || self.roots.iter().any(|r| p.starts_with(r)) {
            Ok(p)
        } else {
            Err("This path has not been authorized. Use Open File or Open Folder.".into())
        }
    }
    fn registered(&self, path: &Path) -> Result<()> {
        if self.open.contains(path) {
            Ok(())
        } else {
            Err("Document is not open".into())
        }
    }
    fn validate_session(&self, session: &Session) -> Result<()> {
        session.validate()?;
        for doc in &session.documents {
            self.registered(&doc.path)?;
        }
        if session
            .workspace
            .as_ref()
            .is_some_and(|p| !self.roots.contains(p) && !self.directories.contains(p))
        {
            return Err("Recovery workspace has not been authorized".into());
        }
        Ok(())
    }
    fn document(&self, path: &Path) -> Result<PathBuf> {
        let p = self.allowed(path)?;
        if p != path || !self.open.contains(&p) {
            return Err("Document is not open, or its path now points elsewhere".into());
        }
        Ok(p)
    }
    fn grant(&mut self, request: &Request) {
        if request.directory {
            self.roots.insert(request.path.clone());
        } else {
            self.grants.insert(request.path.clone());
        }
    }
    fn watches(&mut self, app: &AppHandle) -> Result<()> {
        let mut wanted = self.directories.clone();
        wanted.extend(self.assets.values().flat_map(|paths| paths.iter().cloned()));
        wanted.extend(
            self.open
                .iter()
                .filter_map(|p| p.parent().map(Path::to_path_buf)),
        );
        self.watchers.retain(|p, _| wanted.contains(p));
        for path in wanted {
            if self.watchers.contains_key(&path)
                || !path.is_dir()
                || !files::canonical(&path).is_ok_and(|p| p == path)
            {
                continue;
            }
            let handle = app.clone();
            let mut watcher = new_debouncer(
                Duration::from_millis(350),
                None,
                move |event: DebounceEventResult| match event {
                    Ok(_) => {
                        let _ = handle.emit("disk-changed", ());
                    }
                    Err(errors) => {
                        let _ = handle.emit("service-error", format!("File watcher: {errors:?}"));
                    }
                },
            )
            .map_err(|e| e.to_string())?;
            watcher
                .watch(&path, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
            self.watchers.insert(path, watcher);
        }
        Ok(())
    }
}

pub fn enqueue(app: &AppHandle, request: Request) {
    let service = app.state::<Service>();
    let mut inner = service.0.lock().unwrap();
    inner.grant(&request);
    inner.requests.push_back(request);
    drop(inner);
    let _ = app.emit("open-requests", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn ready(state: State<Service>) -> Vec<Request> {
    state.0.lock().unwrap().requests.drain(..).collect()
}

#[tauri::command]
pub async fn choose(app: AppHandle, folder: bool) -> Result<()> {
    let dialog = app.dialog().file();
    let selected = if folder {
        dialog.blocking_pick_folder()
    } else {
        dialog
            .add_filter("Documents", &["md", "markdown", "mdx", "html", "htm"])
            .blocking_pick_file()
    };
    if let Some(path) = selected {
        let path = path.into_path().map_err(|e| e.to_string())?;
        let request =
            cli::parse(&[path.to_string_lossy().into()], Path::new("/"))?.ok_or("No path")?;
        enqueue(&app, request);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    path: PathBuf,
    snapshot: Snapshot,
    parent: PathBuf,
}

#[tauri::command]
pub async fn open_document(
    app: AppHandle,
    state: State<'_, Service>,
    path: PathBuf,
) -> Result<Opened> {
    let mut inner = state.0.lock().unwrap();
    let path = inner.allowed(&path)?;
    if !files::supported_document(&path) {
        return Err("Not a supported Sidelit document".into());
    }
    let snapshot = files::snapshot(&path)?;
    inner.open.insert(path.clone());
    inner.watches(&app)?;
    let parent = path.parent().ok_or("Missing parent")?.to_path_buf();
    // A selected document grants browsing its parent, but not arbitrary ancestors.
    inner.roots.insert(parent.clone());
    Ok(Opened {
        path,
        snapshot,
        parent,
    })
}

#[tauri::command]
pub async fn read_document(state: State<'_, Service>, path: PathBuf) -> Result<Snapshot> {
    let inner = state.0.lock().unwrap();
    files::snapshot(&inner.document(&path)?)
}
#[tauri::command]
pub async fn save_document(
    state: State<'_, Service>,
    path: PathBuf,
    expected: String,
    text: String,
) -> Result<SaveResult> {
    let inner = state.0.lock().unwrap();
    files::save(&inner.document(&path)?, &expected, &text)
}
#[tauri::command]
pub fn close_document(app: AppHandle, state: State<Service>, path: PathBuf) -> Result<()> {
    let mut inner = state.0.lock().unwrap();
    inner.open.remove(&path);
    inner.assets.remove(&path);
    inner.watches(&app)
}
#[tauri::command]
pub fn set_workspace(app: AppHandle, state: State<Service>, path: PathBuf) -> Result<()> {
    let mut inner = state.0.lock().unwrap();
    let path = inner.allowed(&path)?;
    if !path.is_dir() {
        return Err("Not a directory".into());
    }
    inner.directories.clear();
    inner.directories.insert(path);
    inner.watches(&app)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    path: PathBuf,
    name: String,
    directory: bool,
}
#[tauri::command]
pub async fn list_directory(
    app: AppHandle,
    state: State<'_, Service>,
    path: PathBuf,
) -> Result<Vec<Entry>> {
    let mut inner = state.0.lock().unwrap();
    let path = inner.allowed(&path)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if search::EXCLUDED.contains(&name.as_str()) {
            continue;
        }
        // Do not traverse symlinks; they may leave the authorized workspace.
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() || (kind.is_file() && files::supported_document(&entry.path())) {
            entries.push(Entry {
                path: entry.path(),
                name,
                directory: kind.is_dir(),
            });
        }
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    inner.directories.insert(path);
    inner.watches(&app)?;
    Ok(entries)
}
#[tauri::command]
pub fn collapse_directory(app: AppHandle, state: State<Service>, path: PathBuf) -> Result<()> {
    let mut inner = state.0.lock().unwrap();
    inner.directories.retain(|p| !p.starts_with(&path));
    inner.watches(&app)
}

#[tauri::command]
pub async fn save_copy(
    app: AppHandle,
    state: State<'_, Service>,
    path: Option<PathBuf>,
    text: String,
) -> Result<Option<Opened>> {
    if let Some(path) = &path {
        state.0.lock().unwrap().registered(path)?;
    }
    let name = path
        .as_ref()
        .map(|p| {
            format!(
                "{}-copy.{}",
                p.file_stem().unwrap_or_default().to_string_lossy(),
                p.extension().unwrap_or_default().to_string_lossy()
            )
        })
        .unwrap_or_else(|| "Untitled.md".into());
    let selected = app
        .dialog()
        .file()
        .set_file_name(name)
        .add_filter("Documents", &["md", "markdown", "mdx", "html", "htm"])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let mut inner = state.0.lock().unwrap();
    let opened = create_selected(
        &mut inner,
        &selected.into_path().map_err(|e| e.to_string())?,
        &text,
    )?;
    if let Err(error) = inner.watches(&app) {
        let _ = app.emit("service-error", error);
    }
    Ok(Some(opened))
}

fn create_selected(inner: &mut Inner, selected: &Path, text: &str) -> Result<Opened> {
    let target = files::identity(selected)?;
    if !files::supported_document(&target) {
        return Err("Use a .md, .markdown, .mdx, .html, or .htm extension".into());
    }
    if target.exists() {
        return Err("Choose a new file name; no existing file was overwritten.".into());
    }
    files::atomic_write(&target, text, true)?;
    let snapshot = files::text_snapshot(text);
    let parent = target.parent().unwrap().to_path_buf();
    inner.grants.insert(target.clone());
    inner.roots.insert(parent.clone());
    inner.open.insert(target.clone());
    Ok(Opened {
        path: target,
        parent,
        snapshot,
    })
}

#[tauri::command]
pub async fn image_data(
    app: AppHandle,
    state: State<'_, Service>,
    document: PathBuf,
    reference: String,
) -> Result<String> {
    let mut inner = state.0.lock().unwrap();
    let doc = inner.document(&document)?;
    let base = url::Url::from_file_path(&doc).map_err(|_| "Invalid document path")?;
    let target = base.join(&reference).map_err(|e| e.to_string())?;
    if target.scheme() != "file" {
        return Err("Remote images are disabled".into());
    }
    let target = files::canonical(&target.to_file_path().map_err(|_| "Invalid image path")?)?;
    if !target.starts_with(doc.parent().unwrap())
        && !inner.roots.iter().any(|r| target.starts_with(r))
    {
        return Err("Image is outside the authorized folders".into());
    }
    let ext = target
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("Only PNG, JPEG, GIF and WebP images are allowed".into()),
    };
    let parent = target.parent().ok_or("Missing image parent")?.to_path_buf();
    let paths = inner.assets.entry(doc).or_default();
    if paths.len() >= 128 && !paths.contains(&parent) {
        return Err("Image directory limit reached".into());
    }
    paths.insert(parent);
    inner.watches(&app)?;
    drop(inner);
    let bytes = files::read_bytes(&target, files::MAX_BYTES)?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAsset {
    kind: &'static str,
    value: String,
    path: PathBuf,
    mime: Option<&'static str>,
}

fn local_asset(inner: &Inner, document: &Path, reference: &str) -> Result<PathBuf> {
    let doc = inner.document(document)?;
    let base = url::Url::from_file_path(&doc).map_err(|_| "Invalid document path")?;
    let target = base.join(reference).map_err(|e| e.to_string())?;
    if target.scheme() != "file" {
        return Err("Only local preview assets are allowed".into());
    }
    let target = files::canonical(&target.to_file_path().map_err(|_| "Invalid asset path")?)?;
    if !target.starts_with(doc.parent().unwrap())
        && !inner.roots.iter().any(|r| target.starts_with(r))
    {
        return Err("Preview asset is outside the authorized folders".into());
    }
    Ok(target)
}

#[tauri::command]
pub async fn preview_asset(
    app: AppHandle,
    state: State<'_, Service>,
    document: PathBuf,
    reference: String,
) -> Result<PreviewAsset> {
    let mut inner = state.0.lock().unwrap();
    let target = local_asset(&inner, &document, &reference)?;
    let paths = inner.assets.entry(document.clone()).or_default();
    let parent = target.parent().ok_or("Missing asset parent")?.to_path_buf();
    if paths.len() >= 128 && !paths.contains(&parent) {
        return Err("Preview asset directory limit reached".into());
    }
    paths.insert(parent);
    inner.watches(&app)?;
    let ext = target
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if matches!(ext.as_str(), "css" | "js" | "mjs") {
        drop(inner);
        let bytes = files::read_bytes(&target, files::MAX_BYTES)?;
        return Ok(PreviewAsset {
            kind: if ext == "css" { "style" } else { "script" },
            value: String::from_utf8(bytes).map_err(|_| "Preview asset is not UTF-8")?,
            path: target,
            mime: Some(if ext == "css" {
                "text/css"
            } else {
                "text/javascript"
            }),
        });
    }
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        _ => {
            return Err(
                "Unsupported preview asset; use a development server for this resource type".into(),
            )
        }
    };
    drop(inner);
    let bytes = files::read_bytes(&target, files::MAX_BYTES)?;
    Ok(PreviewAsset {
        kind: "data",
        path: target,
        value: format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        mime: Some(mime),
    })
}

#[tauri::command]
pub async fn open_link(
    app: AppHandle,
    state: State<'_, Service>,
    document: PathBuf,
    reference: String,
) -> Result<()> {
    let doc = { state.0.lock().unwrap().document(&document)? };
    let base = url::Url::from_file_path(&doc).map_err(|_| "Invalid document path")?;
    let target = base.join(&reference).map_err(|e| e.to_string())?;
    match target.scheme() {
        "https" | "http" | "mailto" => app
            .opener()
            .open_url(target.to_string(), None::<&str>)
            .map_err(|e| e.to_string()),
        "file" => {
            let path = target.to_file_path().map_err(|_| "Invalid file link")?;
            let request =
                cli::parse(&[path.to_string_lossy().into()], Path::new("/"))?.ok_or("No path")?;
            let authorized = state.0.lock().unwrap().allowed(&request.path).is_ok();
            if !authorized
                && !app
                    .dialog()
                    .message(format!(
                        "Open {}? This grants access to its folder.",
                        request.path.display()
                    ))
                    .title("Open document link")
                    .buttons(MessageDialogButtons::OkCancel)
                    .blocking_show()
            {
                return Ok(());
            }
            enqueue(&app, request);
            Ok(())
        }
        _ => Err("This link scheme is not allowed".into()),
    }
}
#[tauri::command]
pub async fn search_documents(
    state: State<'_, Service>,
    path: PathBuf,
    query: String,
) -> Result<search::Matches> {
    let root = state.0.lock().unwrap().allowed(&path)?;
    if !root.is_dir() {
        return Err("Not a directory".into());
    }
    tauri::async_runtime::spawn_blocking(move || search::documents(&root, &query))
        .await
        .map_err(|e| e.to_string())?
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery/session.json"))
}

#[tauri::command]
pub async fn recovery_status(app: AppHandle, recovery: State<'_, Recovery>) -> Result<Status> {
    Ok(recovery
        .0
        .lock()
        .unwrap()
        .load(&recovery_path(&app)?)?
        .status())
}

#[tauri::command]
pub async fn set_recovery(
    app: AppHandle,
    recovery: State<'_, Recovery>,
    enabled: bool,
) -> Result<Status> {
    recovery
        .0
        .lock()
        .unwrap()
        .enable(&recovery_path(&app)?, enabled)
}

#[tauri::command]
pub async fn save_session(
    app: AppHandle,
    state: State<'_, Service>,
    recovery: State<'_, Recovery>,
    session: Session,
) -> Result<()> {
    state.0.lock().unwrap().validate_session(&session)?;
    recovery
        .0
        .lock()
        .unwrap()
        .checkpoint(&recovery_path(&app)?, session)
}

#[tauri::command]
pub async fn restore_session(
    app: AppHandle,
    state: State<'_, Service>,
    recovery: State<'_, Recovery>,
) -> Result<Option<Session>> {
    let session = recovery
        .0
        .lock()
        .unwrap()
        .load(&recovery_path(&app)?)?
        .session
        .clone();
    let Some(mut session) = session else {
        return Ok(None);
    };
    let mut folders: Vec<_> = session
        .documents
        .iter()
        .filter_map(|d| d.path.parent())
        .map(|p| p.display().to_string())
        .collect();
    if let Some(root) = &session.workspace {
        folders.push(root.display().to_string());
    }
    folders.sort();
    folders.dedup();
    if !app.dialog().message(format!("Restore {} tabs and permit access to these folders?\n\n{}\n\nDrafts will not overwrite files. Changed files will show a conflict.", session.documents.len(), folders.join("\n")))
        .title("Restore Sidelit session").buttons(MessageDialogButtons::OkCancel).blocking_show() {
        return Ok(None);
    }
    let mut inner = state.0.lock().unwrap();
    for doc in &session.documents {
        inner.grants.insert(doc.path.clone());
        inner.open.insert(doc.path.clone());
        if let Some(parent) = doc.path.parent() {
            inner.roots.insert(parent.into());
        }
    }
    if let Some(root) = &session.workspace {
        if root.is_dir() && files::canonical(root).is_ok_and(|p| p == *root) {
            inner.roots.insert(root.clone());
        } else {
            session.workspace = None;
        }
    }
    if let Err(error) = inner.watches(&app) {
        let _ = app.emit("service-error", error);
    }
    Ok(Some(session))
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_and_save_as_grant_only_native_selected_new_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        let target = root.join("new.md");
        let mut inner = Inner::default();
        assert!(inner.allowed(&target).is_err());
        let opened = create_selected(&mut inner, &target, "draft").unwrap();
        assert_eq!(opened.snapshot, files::text_snapshot("draft"));
        assert!(inner.document(&target).is_ok());
        assert!(create_selected(&mut inner, &target, "overwrite").is_err());
        assert_eq!(files::snapshot(&target).unwrap().text, "draft");
        assert!(create_selected(&mut inner, &root.join("bad.txt"), "draft").is_err());
        assert!(create_selected(&mut inner, &root.join("absent/new.md"), "draft").is_err());
        assert_eq!(
            create_selected(&mut inner, &root.join("empty.md"), "")
                .unwrap()
                .snapshot
                .text,
            ""
        );
    }

    #[test]
    fn missing_parent_does_not_revoke_draft_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let parent = files::canonical(dir.path()).unwrap().join("removed");
        fs::create_dir(&parent).unwrap();
        let path = parent.join("draft.md");
        fs::write(&path, "baseline").unwrap();
        let mut inner = Inner::default();
        inner.open.insert(path.clone());
        inner.grants.insert(path.clone());
        fs::remove_dir_all(&parent).unwrap();
        assert!(inner.document(&path).is_err());
        assert!(inner.registered(&path).is_ok());
        assert!(inner.registered(&parent.join("other.md")).is_err());
        let session = Session {
            documents: vec![],
            workspace: Some("/ungranted".into()),
            active: None,
        };
        assert!(inner.validate_session(&session).is_err());
    }

    #[test]
    fn scopes_reject_ungranted_paths_and_symlink_escapes() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut inner = Inner::default();
        inner.roots.insert(files::canonical(a.path()).unwrap());
        assert!(inner.allowed(&a.path().join("new.md")).is_ok());
        assert!(inner.allowed(&b.path().join("no.md")).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(b.path(), a.path().join("escape")).unwrap();
            assert!(inner.allowed(&a.path().join("escape/no.md")).is_err());
        }
    }

    #[test]
    fn preview_assets_require_open_document_and_canonical_folder_grants() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let root = files::canonical(a.path()).unwrap();
        let outside = files::canonical(b.path()).unwrap();
        fs::write(outside.join("secret.css"), "private").unwrap();
        fs::create_dir(root.join("css")).unwrap();
        fs::write(root.join("css/local.css"), "h1{}").unwrap();
        let mut inner = Inner::default();
        let doc = root.join("page.html");
        create_selected(&mut inner, &doc, "<h1>Preview</h1>").unwrap();
        assert_eq!(
            local_asset(&inner, &doc, "./css/local.css").unwrap(),
            root.join("css/local.css")
        );
        assert!(local_asset(&inner, &doc, "https://example.com/a.css").is_err());
        assert!(local_asset(
            &inner,
            &doc,
            &url::Url::from_file_path(outside.join("secret.css"))
                .unwrap()
                .to_string()
        )
        .is_err());
        assert!(local_asset(&inner, &root.join("unopened.html"), "css/local.css").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
            assert!(local_asset(&inner, &doc, "escape/secret.css").is_err());
        }
    }
}
