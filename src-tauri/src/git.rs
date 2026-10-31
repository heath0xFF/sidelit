use crate::files::{self, Result, Snapshot};
use crate::service::Service;
use git2::{Repository, Status, StatusOptions};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{command, State};

// libgit2, not the git command: a repository's own config can make `git status` run
// programs through core.fsmonitor or clean filters, and any folder can be opened here.
const MAX_FILES: usize = 2000;
const MAX_BLOB_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    files: Vec<GitFile>,
    incomplete: bool,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct GitFile {
    path: PathBuf,
    status: &'static str,
}

fn workdir(repository: &Repository) -> Option<PathBuf> {
    files::canonical(repository.workdir()?).ok()
}

fn label(status: Status) -> Option<&'static str> {
    if status.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
        None
    } else if status.intersects(Status::WT_NEW | Status::INDEX_NEW) {
        Some("added")
    } else {
        Some("modified")
    }
}

fn changed_documents(root: &Path) -> GitStatus {
    let Ok(repository) = Repository::discover(root) else {
        return GitStatus::default();
    };
    let Some(base) = workdir(&repository) else {
        return GitStatus::default();
    };
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .exclude_submodules(true);
    let Ok(statuses) = repository.statuses(Some(&mut options)) else {
        return GitStatus::default();
    };
    let mut result = GitStatus::default();
    for entry in statuses.iter() {
        let (Ok(relative), Some(status)) = (entry.path(), label(entry.status())) else {
            continue;
        };
        let path = base.join(relative);
        if !path.starts_with(root) || !files::supported_document(&path) {
            continue;
        }
        if result.files.len() == MAX_FILES {
            result.incomplete = true;
            break;
        }
        result.files.push(GitFile { path, status });
    }
    result
}

fn committed_text(path: &Path) -> Option<Snapshot> {
    let repository = Repository::discover(path.parent()?).ok()?;
    let relative = path.strip_prefix(workdir(&repository)?).ok()?;
    let tree = repository.head().ok()?.peel_to_tree().ok()?;
    let blob = tree
        .get_path(relative)
        .ok()?
        .to_object(&repository)
        .ok()?
        .peel_to_blob()
        .ok()?;
    if blob.size() > MAX_BLOB_BYTES {
        return None;
    }
    Some(files::text_snapshot(
        std::str::from_utf8(blob.content()).ok()?,
    ))
}

#[command]
pub async fn git_status(state: State<'_, Service>, path: PathBuf) -> Result<GitStatus> {
    let root = state.allowed(&path)?;
    tauri::async_runtime::spawn_blocking(move || changed_documents(&root))
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn git_committed(state: State<'_, Service>, path: PathBuf) -> Result<Option<Snapshot>> {
    let document = state.document(&path)?;
    tauri::async_runtime::spawn_blocking(move || committed_text(&document))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn commit_all(repository: &Repository) {
        let mut index = repository.index().unwrap();
        index
            .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree = repository.find_tree(index.write_tree().unwrap()).unwrap();
        let author = git2::Signature::now("Test", "test@example.com").unwrap();
        repository
            .commit(Some("HEAD"), &author, &author, "commit", &tree, &[])
            .unwrap();
    }

    #[test]
    fn reports_documents_and_committed_text_inside_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        let repository = Repository::init(&root).unwrap();
        fs::create_dir(root.join("docs")).unwrap();
        for name in ["docs/a.md", "docs/same.md", "outside.md", "code.rs"] {
            fs::write(root.join(name), "old\n").unwrap();
        }
        commit_all(&repository);
        for name in ["docs/a.md", "outside.md", "code.rs"] {
            fs::write(root.join(name), "new\n").unwrap();
        }
        fs::write(root.join("docs/new.mdx"), "new\n").unwrap();

        let docs = root.join("docs");
        let mut found = changed_documents(&docs).files;
        found.sort_by(|a, b| a.path.cmp(&b.path));
        assert_eq!(
            found,
            [
                GitFile {
                    path: docs.join("a.md"),
                    status: "modified"
                },
                GitFile {
                    path: docs.join("new.mdx"),
                    status: "added"
                },
            ]
        );
        assert_eq!(committed_text(&docs.join("a.md")).unwrap().text, "old\n");
        assert!(committed_text(&docs.join("new.mdx")).is_none());
    }

    #[test]
    fn a_folder_outside_a_repository_is_simply_clean() {
        let dir = tempfile::tempdir().unwrap();
        let status = changed_documents(dir.path());
        assert!(status.files.is_empty() && !status.incomplete);
    }

    #[test]
    fn repository_config_cannot_run_programs() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        let repository = Repository::init(&root).unwrap();
        fs::write(root.join("a.md"), "old\n").unwrap();
        commit_all(&repository);
        let marker = root.join("ran");
        let script = format!("sh -c 'touch {}; cat'", marker.display());
        let mut config = repository.config().unwrap();
        config.set_str("core.fsmonitor", &script).unwrap();
        config.set_str("filter.evil.clean", &script).unwrap();
        config.set_str("filter.evil.required", "true").unwrap();
        fs::write(root.join(".gitattributes"), "*.md filter=evil\n").unwrap();
        fs::write(root.join("a.md"), "changed\n").unwrap();
        assert!(!changed_documents(&root).files.is_empty());
        assert!(!marker.exists());
    }
}
