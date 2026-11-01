use crate::files::{self, Result, Snapshot};
use crate::service::Service;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager, State};

// "What you last reviewed", so marks outlast a closed tab or a restart. This keeps a copy of
// document text: private, bounded, and deleted when the person marks the document reviewed.
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_ENTRIES: usize = 200;
const MAX_AGE: Duration = Duration::from_secs(90 * 24 * 60 * 60);

#[derive(Default)]
pub struct Baselines(Mutex<()>);

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Stored {
    version: u32,
    path: PathBuf,
    text: String,
}

fn entry(directory: &Path, document: &Path) -> PathBuf {
    let name = files::hash(document.to_string_lossy().as_bytes());
    directory.join(format!("{name}.json"))
}

fn load(directory: &Path, document: &Path) -> Result<Option<Snapshot>> {
    let path = entry(directory, document);
    if !path.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    // A damaged entry only loses marks, so it is not worth an error on every open.
    let stored = files::read_bytes(&path, files::MAX_BYTES)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok());
    Ok(stored
        .filter(|stored| stored.version == 1 && stored.path == document)
        .map(|stored| files::text_snapshot(&stored.text)))
}

fn sync_directory(directory: &Path) -> Result<()> {
    fs::File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())
}

fn remove(directory: &Path, document: &Path) -> Result<()> {
    match fs::remove_file(entry(directory, document)) {
        Ok(()) => sync_directory(directory),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Too large to keep is not a failure: the marks still last until the tab closes.
fn store(directory: &Path, document: &Path, text: &str) -> Result<()> {
    if text.len() > MAX_TEXT_BYTES {
        return remove(directory, document);
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec(&Stored {
        version: 1,
        path: document.to_path_buf(),
        text: text.to_string(),
    })
    .map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    temp.persist(entry(directory, document))
        .map_err(|e| e.to_string())?;
    sync_directory(directory)?;
    prune(directory);
    Ok(())
}

fn prune(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut kept: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|item| item.path().extension().is_some_and(|e| e == "json"))
        .filter_map(|item| Some((item.metadata().ok()?.modified().ok()?, item.path())))
        .collect();
    kept.sort();
    let extra = kept.len().saturating_sub(MAX_ENTRIES);
    let now = SystemTime::now();
    for (index, (modified, path)) in kept.iter().enumerate() {
        let old = now.duration_since(*modified).unwrap_or_default() > MAX_AGE;
        if index < extra || old {
            let _ = fs::remove_file(path);
        }
    }
}

fn directory(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("review/baselines"))
}

#[tauri::command]
pub async fn load_baseline(
    app: AppHandle,
    service: State<'_, Service>,
    baselines: State<'_, Baselines>,
    path: PathBuf,
) -> Result<Option<Snapshot>> {
    let document = service.document(&path)?;
    let _guard = baselines.0.lock().unwrap();
    load(&directory(&app)?, &document)
}

#[tauri::command]
pub async fn store_baseline(
    app: AppHandle,
    service: State<'_, Service>,
    baselines: State<'_, Baselines>,
    path: PathBuf,
    text: Option<String>,
) -> Result<()> {
    let document = service.document(&path)?;
    let _guard = baselines.0.lock().unwrap();
    let directory = directory(&app)?;
    match text {
        Some(text) => store(&directory, &document, &text),
        None => remove(&directory, &document),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baselines_are_private_keyed_to_their_document_and_deletable() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("baselines");
        let (one, two) = (Path::new("/repo/one.md"), Path::new("/repo/two.md"));
        assert!(load(&base, one).unwrap().is_none());
        store(&base, one, "before\n").unwrap();
        let loaded = load(&base, one).unwrap().unwrap();
        assert_eq!(loaded, files::text_snapshot("before\n"));
        assert!(load(&base, two).unwrap().is_none());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&base), 0o700);
            assert_eq!(mode(&entry(&base, one)), 0o600);
        }
        remove(&base, one).unwrap();
        assert!(load(&base, one).unwrap().is_none());
        remove(&base, one).unwrap();
    }

    #[test]
    fn damaged_misfiled_and_oversized_entries_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let (one, two) = (Path::new("/repo/one.md"), Path::new("/repo/two.md"));
        store(base, one, "text").unwrap();
        fs::copy(entry(base, one), entry(base, two)).unwrap();
        assert!(load(base, two).unwrap().is_none());
        fs::write(entry(base, one), b"not json").unwrap();
        assert!(load(base, one).unwrap().is_none());
        store(base, one, &"x".repeat(MAX_TEXT_BYTES + 1)).unwrap();
        assert!(!entry(base, one).exists());
    }

    #[test]
    fn old_entries_are_pruned_past_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        for index in 0..MAX_ENTRIES + 5 {
            store(base, Path::new(&format!("/repo/{index}.md")), "x").unwrap();
        }
        assert_eq!(fs::read_dir(base).unwrap().count(), MAX_ENTRIES);
    }
}
