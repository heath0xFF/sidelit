use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const MAX_BYTES: u64 = 16 * 1024 * 1024;
pub type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub text: String,
    pub hash: String,
}

pub fn read_bytes(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A path can become a pipe or symlink between authorization and open.
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > limit {
        return Err(format!(
            "Not a regular file, or larger than {} MiB",
            limit / 1024 / 1024
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("File grew beyond the size limit while reading".into());
    }
    Ok(bytes)
}

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn text_snapshot(text: &str) -> Snapshot {
    Snapshot {
        text: text.into(),
        hash: hash(text.as_bytes()),
    }
}

pub fn snapshot(path: &Path) -> Result<Snapshot> {
    let bytes = read_bytes(path, MAX_BYTES)?;
    let hash = hash(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| "Only UTF-8 Markdown is supported")?;
    Ok(Snapshot { text, hash })
}

pub fn markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("markdown"))
}

pub fn canonical(path: &Path) -> Result<PathBuf> {
    fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))
}

// Resolve the parent even when a watched file has been deleted.
pub fn identity(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return canonical(path);
    }
    let parent = canonical(path.parent().ok_or("Missing parent directory")?)?;
    Ok(parent.join(path.file_name().ok_or("Missing file name")?))
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveResult {
    Saved {
        snapshot: Snapshot,
    },
    Conflict {
        snapshot: Option<Snapshot>,
        error: Option<String>,
    },
}

pub fn save(path: &Path, expected: &str, text: &str) -> Result<SaveResult> {
    if text.len() as u64 > MAX_BYTES {
        return Err("Document exceeds 16 MiB".into());
    }
    let disk = match snapshot(path) {
        Ok(disk) => disk,
        Err(error) => {
            return Ok(SaveResult::Conflict {
                snapshot: None,
                error: Some(error),
            })
        }
    };
    if disk.hash != expected {
        return Ok(SaveResult::Conflict {
            snapshot: Some(disk),
            error: None,
        });
    }
    if disk.text == text {
        return Ok(SaveResult::Saved { snapshot: disk });
    }
    atomic_write(path, text, false)?;
    // Return the bytes we wrote, not a later external writer's version.
    Ok(SaveResult::Saved {
        snapshot: text_snapshot(text),
    })
}

pub fn atomic_write(path: &Path, text: &str, create_only: bool) -> Result<()> {
    if text.len() as u64 > MAX_BYTES {
        return Err("Document exceeds 16 MiB".into());
    }
    let parent = path.parent().ok_or("Missing parent directory")?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    if !create_only {
        let permissions = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
        tmp.as_file()
            .set_permissions(permissions)
            .map_err(|e| e.to_string())?;
    }
    tmp.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    if create_only {
        tmp.persist_noclobber(path).map_err(|e| e.to_string())?;
    } else {
        tmp.persist(path).map_err(|e| e.to_string())?;
    }
    fs::File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_are_bounded_and_reject_special_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("image.png");
        fs::write(&path, b"image").unwrap();
        assert_eq!(read_bytes(&path, 5).unwrap(), b"image");
        assert!(read_bytes(&path, 4).is_err());
        assert!(read_bytes(dir.path(), MAX_BYTES).is_err());
        #[cfg(unix)]
        {
            use std::{ffi::CString, os::unix::ffi::OsStrExt};
            fs::remove_file(&path).unwrap();
            let name = CString::new(path.as_os_str().as_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
            assert!(read_bytes(&path, MAX_BYTES).is_err());
            fs::remove_file(&path).unwrap();
            std::os::unix::fs::symlink("missing", &path).unwrap();
            assert!(read_bytes(&path, MAX_BYTES).is_err());
        }
    }

    #[test]
    fn unchanged_bytes_and_optimistic_save() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        let original = "---\r\ntitle: Test\r\n---\r\n<custom>\r\n$$x$$\r\n";
        fs::write(&p, original).unwrap();
        let s = snapshot(&p).unwrap();
        let modified = fs::metadata(&p).unwrap().modified().unwrap();
        assert!(matches!(
            save(&p, &s.hash, original).unwrap(),
            SaveResult::Saved { .. }
        ));
        assert_eq!(fs::read(&p).unwrap(), original.as_bytes());
        assert_eq!(fs::metadata(&p).unwrap().modified().unwrap(), modified);
        fs::write(&p, "agent edit").unwrap();
        assert!(matches!(
            save(&p, &s.hash, "draft").unwrap(),
            SaveResult::Conflict { .. }
        ));
        assert_eq!(fs::read_to_string(&p).unwrap(), "agent edit");
    }
    #[test]
    fn directory_watch_observes_chunked_writes_rename_and_recreation() {
        use notify_debouncer_full::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
        use std::{
            sync::mpsc,
            time::{Duration, Instant},
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("watched.md");
        fs::write(&path, "original").unwrap();
        let (send, recv) = mpsc::channel();
        let mut watcher = new_debouncer(
            Duration::from_millis(100),
            None,
            move |events: DebounceEventResult| {
                if events.is_ok() {
                    let _ = send.send(());
                }
            },
        )
        .unwrap();
        watcher
            .watch(dir.path(), RecursiveMode::NonRecursive)
            .unwrap();
        let observed = |expected: Option<&str>| {
            let start = Instant::now();
            loop {
                recv.recv_timeout(Duration::from_secs(5))
                    .expect("directory event");
                if snapshot(&path).ok().as_ref().map(|s| s.text.as_str()) == expected {
                    break;
                }
                assert!(start.elapsed() < Duration::from_secs(5));
            }
        };
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(b"chunk ").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        file.write_all(b"complete").unwrap();
        drop(file);
        observed(Some("chunk complete"));
        atomic_write(&path, "replacement", false).unwrap();
        observed(Some("replacement"));
        fs::remove_file(&path).unwrap();
        observed(None);
        fs::write(&path, "recreated").unwrap();
        observed(Some("recreated"));
    }

    #[test]
    fn atomic_replace_delete_recreate_and_copy() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, "old").unwrap();
        let s = snapshot(&p).unwrap();
        save(&p, &s.hash, "new").unwrap();
        assert_eq!(snapshot(&p).unwrap().text, "new");
        assert!(atomic_write(&p, "do not clobber", true).is_err());
        fs::remove_file(&p).unwrap();
        assert!(matches!(
            save(&p, &s.hash, "draft").unwrap(),
            SaveResult::Conflict { snapshot: None, .. }
        ));
        atomic_write(&p, "recreated", true).unwrap();
        assert_eq!(snapshot(&p).unwrap().text, "recreated");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
