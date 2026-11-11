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
    // Discovery walks up, so the folder may sit inside a much larger worktree (say a
    // dotfiles repository at home). Scan only the folder, matched literally, not as a pattern.
    if let Some(scope) = root
        .strip_prefix(&base)
        .ok()
        .filter(|p| !p.as_os_str().is_empty())
    {
        options.pathspec(scope).disable_pathspec_match(true);
    }
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

const MAX_REVISION_BYTES: usize = 200;
const MAX_REFS: usize = 100;

// Only revision syntax: a leading '-' or spaces could never name a commit here.
fn valid_revision(revision: &str) -> bool {
    !revision.is_empty()
        && revision.len() <= MAX_REVISION_BYTES
        && !revision.starts_with('-')
        && revision
            .chars()
            .all(|c| c.is_alphanumeric() || "-_./~^@{}:+".contains(c))
}

fn committed_text(path: &Path, revision: Option<&str>) -> Result<Option<Snapshot>> {
    let found = (|| {
        let repository = Repository::discover(path.parent()?).ok()?;
        Some((workdir(&repository)?, repository))
    })();
    let Some((base, repository)) = found else {
        return match revision {
            Some(_) => Err("This document is not in a Git repository".into()),
            None => Ok(None),
        };
    };
    let Ok(relative) = path.strip_prefix(base) else {
        return Ok(None);
    };
    let tree = match revision {
        None => match repository.head().and_then(|head| head.peel_to_tree()) {
            Ok(tree) => tree,
            Err(_) => return Ok(None),
        },
        Some(revision) => {
            if !valid_revision(revision) {
                return Err("Enter a branch, tag, or commit, such as main or HEAD~1".into());
            }
            repository
                .revparse_single(revision)
                .and_then(|object| object.peel_to_tree())
                .map_err(|_| format!("No commit, branch, or tag named {revision}"))?
        }
    };
    let blob = tree
        .get_path(relative)
        .ok()
        .and_then(|entry| entry.to_object(&repository).ok())
        .and_then(|object| object.peel_to_blob().ok());
    let Some(blob) = blob else {
        return Ok(None);
    };
    if blob.size() > MAX_BLOB_BYTES {
        return Err("That version is larger than 16 MiB".into());
    }
    match std::str::from_utf8(blob.content()) {
        Ok(text) => Ok(Some(files::text_snapshot(text))),
        Err(_) => Err("That version is not UTF-8 text".into()),
    }
}

// Branch and tag names to suggest; newest commits first is not needed for a short list.
fn reference_names(path: &Path) -> Vec<String> {
    let Some(repository) = path.parent().and_then(|p| Repository::discover(p).ok()) else {
        return Vec::new();
    };
    let Ok(references) = repository.references() else {
        return Vec::new();
    };
    let mut names: Vec<String> = references
        .flatten()
        .filter(|r| r.is_branch() || r.is_remote() || r.is_tag())
        .filter_map(|r| r.shorthand().ok().map(str::to_string))
        .filter(|name| valid_revision(name) && !name.ends_with("/HEAD"))
        .take(MAX_REFS)
        .collect();
    names.sort();
    names.dedup();
    names
}

#[command]
pub async fn git_status(state: State<'_, Service>, path: PathBuf) -> Result<GitStatus> {
    let root = state.allowed(&path)?;
    tauri::async_runtime::spawn_blocking(move || changed_documents(&root))
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn git_committed(
    state: State<'_, Service>,
    path: PathBuf,
    revision: Option<String>,
) -> Result<Option<Snapshot>> {
    let document = state.document(&path)?;
    tauri::async_runtime::spawn_blocking(move || committed_text(&document, revision.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
pub async fn git_references(state: State<'_, Service>, path: PathBuf) -> Result<Vec<String>> {
    let document = state.document(&path)?;
    tauri::async_runtime::spawn_blocking(move || reference_names(&document))
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
        assert_eq!(
            committed_text(&docs.join("a.md"), None)
                .unwrap()
                .unwrap()
                .text,
            "old\n"
        );
        assert!(committed_text(&docs.join("new.mdx"), None)
            .unwrap()
            .is_none());
    }

    #[test]
    fn compares_with_a_named_revision_and_rejects_option_like_input() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        let repository = Repository::init(&root).unwrap();
        let path = root.join("a.md");
        fs::write(&path, "first\n").unwrap();
        commit_all(&repository);
        let first = repository.head().unwrap().peel_to_commit().unwrap();
        fs::write(&path, "second\n").unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(Path::new("a.md")).unwrap();
        index.write().unwrap();
        let tree = repository.find_tree(index.write_tree().unwrap()).unwrap();
        let author = git2::Signature::now("Test", "test@example.com").unwrap();
        repository
            .commit(Some("HEAD"), &author, &author, "second", &tree, &[&first])
            .unwrap();
        repository
            .tag_lightweight("v1", first.as_object(), false)
            .unwrap();
        fs::write(&path, "draft\n").unwrap();
        let text = |revision| committed_text(&path, revision).unwrap().unwrap().text;
        assert_eq!(text(None), "second\n");
        assert_eq!(text(Some("HEAD~1")), "first\n");
        assert_eq!(text(Some("v1")), "first\n");
        assert!(committed_text(&path, Some("missing")).is_err());
        assert!(committed_text(&path, Some("--output=x")).is_err());
        assert!(committed_text(&path, Some("a b")).is_err());
        assert!(reference_names(&path).contains(&"v1".to_string()));
        let other = root.join("new.md");
        fs::write(&other, "new\n").unwrap();
        assert!(committed_text(&other, Some("HEAD")).unwrap().is_none());
    }

    #[test]
    fn status_is_scoped_to_a_folder_named_like_a_pattern() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        Repository::init(&root).unwrap();
        let scoped = root.join("notes [draft]*");
        fs::create_dir(&scoped).unwrap();
        fs::create_dir(root.join("notes d")).unwrap();
        fs::write(scoped.join("a.md"), "a\n").unwrap();
        fs::write(root.join("notes d/b.md"), "b\n").unwrap();
        fs::create_dir(root.join("notes [draft]*x")).unwrap();
        fs::write(root.join("notes [draft]*x/b.md"), "b\n").unwrap();
        fs::write(root.join("top.md"), "c\n").unwrap();
        let found = changed_documents(&scoped).files;
        assert_eq!(
            found,
            [GitFile {
                path: scoped.join("a.md"),
                status: "added"
            }]
        );
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
