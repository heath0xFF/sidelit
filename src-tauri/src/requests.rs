use crate::files::{self, Result, Snapshot};
use crate::search;
use crate::service::Service;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{command, State};

// The project's documents as they stood when a request went out, so that when Pi finishes
// Sidelit can list what differs. It cannot tell who changed a file, and says so where shown.
// Held in memory only; a restart forgets it.
const MAX_FILES: usize = 2000;
const MAX_LISTED: usize = 200;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_KEPT_BYTES: usize = 32 * 1024 * 1024;
const MAX_READ_BYTES: usize = 256 * 1024 * 1024;
const MAX_REQUESTS: usize = 8;
const BUDGET: Duration = Duration::from_secs(2);

struct Captured {
    hash: String,
    text: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct RequestFile {
    path: PathBuf,
    status: &'static str,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Report {
    files: Vec<RequestFile>,
    incomplete: bool,
}

struct Capture {
    id: String,
    root: Option<PathBuf>,
    files: HashMap<PathBuf, Captured>,
    complete: bool,
    kept: usize,
    report: Option<Report>,
}

#[derive(Default)]
pub struct Requests(Mutex<VecDeque<Capture>>);

fn document_paths(root: Option<&Path>, open: Vec<PathBuf>) -> (Vec<PathBuf>, bool) {
    let (mut paths, mut complete) = (open, true);
    if let Some(root) = root {
        match search::matching(root, "", MAX_FILES) {
            Ok(found) => {
                complete = !found.incomplete;
                paths.extend(found.paths);
            }
            Err(_) => complete = false,
        }
    }
    paths.sort();
    paths.dedup();
    (paths, complete)
}

fn capture(id: String, root: Option<PathBuf>, open: Vec<PathBuf>) -> Capture {
    let started = Instant::now();
    let (paths, mut complete) = document_paths(root.as_deref(), open);
    let (mut files, mut kept, mut read) = (HashMap::new(), 0, 0);
    for path in paths {
        if started.elapsed() > BUDGET || read > MAX_READ_BYTES {
            complete = false;
            break;
        }
        let Ok(bytes) = files::read_bytes(&path, files::MAX_BYTES) else {
            complete = false;
            continue;
        };
        read += bytes.len();
        let room = bytes.len() <= MAX_TEXT_BYTES && kept + bytes.len() <= MAX_KEPT_BYTES;
        let text = room
            .then(|| String::from_utf8(bytes.clone()).ok())
            .flatten();
        kept += text.as_ref().map_or(0, String::len);
        files.insert(
            path,
            Captured {
                hash: files::hash(&bytes),
                text,
            },
        );
    }
    Capture {
        id,
        root,
        files,
        complete,
        kept,
        report: None,
    }
}

fn compare(
    before: HashMap<PathBuf, String>,
    complete: bool,
    root: Option<PathBuf>,
    open: Vec<PathBuf>,
) -> Report {
    let started = Instant::now();
    let (found, scanned) = document_paths(root.as_deref(), open);
    let found: HashSet<PathBuf> = found.into_iter().collect();
    let mut report = Report {
        incomplete: !complete || !scanned,
        ..Report::default()
    };
    for (path, hash) in &before {
        if started.elapsed() > BUDGET {
            report.incomplete = true;
            break;
        }
        match files::read_bytes(path, files::MAX_BYTES) {
            Ok(bytes) if files::hash(&bytes) != *hash => report.files.push(RequestFile {
                path: path.clone(),
                status: "modified",
            }),
            Ok(_) => {}
            Err(_) if !path.exists() => report.files.push(RequestFile {
                path: path.clone(),
                status: "removed",
            }),
            Err(_) => report.incomplete = true,
        }
    }
    // A file the first scan never reached is not new; a capped scan cannot tell.
    if complete {
        for path in found {
            if !before.contains_key(&path) {
                report.files.push(RequestFile {
                    path,
                    status: "added",
                });
            }
        }
    }
    report.files.sort_by(|a, b| a.path.cmp(&b.path));
    if report.files.len() > MAX_LISTED {
        report.files.truncate(MAX_LISTED);
        report.incomplete = true;
    }
    report
}

// Runs before delivery, and only once per ID: a retry is the same request.
pub async fn begin(service: &Service, requests: &Requests, id: &str, project_root: Option<&str>) {
    if requests.0.lock().unwrap().iter().any(|c| c.id == id) {
        return;
    }
    let root = project_root.and_then(|root| service.allowed(Path::new(root)).ok());
    let open = service.open_documents();
    let id = id.to_string();
    let Ok(captured) = tauri::async_runtime::spawn_blocking(move || capture(id, root, open)).await
    else {
        return;
    };
    let mut held = requests.0.lock().unwrap();
    held.push_back(captured);
    while held.len() > MAX_REQUESTS
        || (held.len() > 1 && held.iter().map(|c| c.kept).sum::<usize>() > 2 * MAX_KEPT_BYTES)
    {
        held.pop_front();
    }
}

// The first answer stands, so later edits are not counted against this request.
#[command]
pub async fn request_changes(
    service: State<'_, Service>,
    requests: State<'_, Requests>,
    id: String,
) -> Result<Option<Report>> {
    let (before, complete, root) = {
        let held = requests.0.lock().unwrap();
        let Some(found) = held.iter().find(|c| c.id == id) else {
            return Ok(None);
        };
        if let Some(report) = &found.report {
            return Ok(Some(report.clone()));
        }
        let hashes: HashMap<PathBuf, String> = found
            .files
            .iter()
            .map(|(path, entry)| (path.clone(), entry.hash.clone()))
            .collect();
        (hashes, found.complete, found.root.clone())
    };
    let allowed = root
        .as_ref()
        .filter(|root| service.allowed(root).is_ok())
        .cloned();
    let complete = complete && allowed.is_some() == root.is_some();
    let open = service.open_documents();
    let report =
        tauri::async_runtime::spawn_blocking(move || compare(before, complete, allowed, open))
            .await
            .map_err(|e| e.to_string())?;
    let mut held = requests.0.lock().unwrap();
    if let Some(found) = held.iter_mut().find(|c| c.id == id) {
        found.report.get_or_insert(report.clone());
    }
    Ok(Some(report))
}

#[command]
pub fn request_baseline(
    service: State<'_, Service>,
    requests: State<'_, Requests>,
    id: String,
    path: PathBuf,
) -> Result<Option<Snapshot>> {
    let document = service.document(&path)?;
    let held = requests.0.lock().unwrap();
    Ok(held
        .iter()
        .find(|c| c.id == id)
        .and_then(|c| c.files.get(&document))
        .and_then(|entry| entry.text.as_deref())
        .map(files::text_snapshot))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn hashes(capture: &Capture) -> HashMap<PathBuf, String> {
        capture
            .files
            .iter()
            .map(|(path, entry)| (path.clone(), entry.hash.clone()))
            .collect()
    }

    #[test]
    fn reports_what_differs_and_keeps_the_earlier_text() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        for name in ["same.md", "edited.md", "gone.md", "code.rs"] {
            fs::write(root.join(name), "before\n").unwrap();
        }
        let captured = capture("one".into(), Some(root.clone()), vec![]);
        assert!(captured.complete);
        assert_eq!(captured.files.len(), 3);
        assert_eq!(
            captured.files[&root.join("edited.md")].text.as_deref(),
            Some("before\n")
        );
        fs::write(root.join("edited.md"), "after\n").unwrap();
        fs::write(root.join("code.rs"), "after\n").unwrap();
        fs::remove_file(root.join("gone.md")).unwrap();
        fs::write(root.join("new.mdx"), "new\n").unwrap();
        let report = compare(hashes(&captured), true, Some(root.clone()), vec![]);
        assert!(!report.incomplete);
        assert_eq!(
            report.files,
            [
                RequestFile {
                    path: root.join("edited.md"),
                    status: "modified"
                },
                RequestFile {
                    path: root.join("gone.md"),
                    status: "removed"
                },
                RequestFile {
                    path: root.join("new.mdx"),
                    status: "added"
                },
            ]
        );
    }

    #[test]
    fn an_incomplete_capture_never_calls_a_file_new() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        fs::write(root.join("seen.md"), "a").unwrap();
        fs::write(root.join("unseen.md"), "a").unwrap();
        let mut before = HashMap::new();
        before.insert(root.join("seen.md"), files::hash(b"a"));
        let report = compare(before, false, Some(root.clone()), vec![]);
        assert!(report.incomplete && report.files.is_empty());
    }

    #[test]
    fn open_documents_outside_the_folder_are_included() {
        let (dir, other) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let root = files::canonical(dir.path()).unwrap();
        let outside = files::canonical(other.path()).unwrap().join("open.md");
        fs::write(&outside, "before").unwrap();
        let captured = capture("one".into(), Some(root.clone()), vec![outside.clone()]);
        fs::write(&outside, "after").unwrap();
        let report = compare(hashes(&captured), true, Some(root), vec![outside.clone()]);
        assert_eq!(report.files[0].path, outside);
        assert_eq!(report.files[0].status, "modified");
    }

    #[test]
    fn large_documents_are_tracked_by_hash_without_keeping_their_text() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        fs::write(root.join("big.md"), "x".repeat(MAX_TEXT_BYTES + 1)).unwrap();
        let captured = capture("one".into(), Some(root.clone()), vec![]);
        assert!(captured.files[&root.join("big.md")].text.is_none());
        assert_eq!(captured.kept, 0);
    }
}
