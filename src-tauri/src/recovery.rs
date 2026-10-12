use crate::files::{self, Result, Snapshot};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_SESSION_BYTES: u64 = 64 * 1024 * 1024;
const RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Rendered,
    Source,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub path: PathBuf,
    pub text: String,
    pub disk: Snapshot,
    pub mode: Mode,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub documents: Vec<Draft>,
    pub workspace: Option<PathBuf>,
    pub active: Option<PathBuf>,
}

impl Session {
    pub fn validate(&self) -> Result<()> {
        let valid_path = |p: &Path| {
            p.is_absolute()
                && p.components()
                    .all(|c| matches!(c, Component::RootDir | Component::Normal(_)))
        };
        let mut paths = HashSet::new();
        let mut bytes = 0u64;
        if self.documents.len() > 100 {
            return Err("Recovery supports at most 100 tabs".into());
        }
        for doc in &self.documents {
            if !valid_path(&doc.path)
                || !files::markdown(&doc.path)
                || !paths.insert(doc.path.clone())
            {
                return Err("Invalid or duplicate recovery path".into());
            }
            if doc.text.len() as u64 > files::MAX_BYTES
                || doc.disk.text.len() as u64 > files::MAX_BYTES
            {
                return Err("A recovery document exceeds 16 MiB".into());
            }
            bytes += (doc.text.len() + doc.disk.text.len()) as u64;
            if bytes > MAX_SESSION_BYTES {
                return Err("Recovery session exceeds 64 MiB".into());
            }
            if files::hash(doc.disk.text.as_bytes()) != doc.disk.hash {
                return Err("Recovery baseline hash does not match its text".into());
            }
        }
        if self.active.as_ref().is_some_and(|p| !paths.contains(p))
            || self.workspace.as_ref().is_some_and(|p| !valid_path(p))
        {
            return Err("Invalid recovery workspace or active tab".into());
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    version: u32,
    pub enabled: bool,
    saved_at: u64,
    pub session: Option<Session>,
}
impl Default for Record {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            saved_at: 0,
            session: None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    available: bool,
    saved_at: u64,
    count: usize,
    dirty: usize,
}
impl Record {
    pub fn status(&self) -> Status {
        let docs = self
            .session
            .as_ref()
            .map(|s| s.documents.as_slice())
            .unwrap_or_default();
        Status {
            enabled: self.enabled,
            available: self
                .session
                .as_ref()
                .is_some_and(|s| !s.documents.is_empty() || s.workspace.is_some()),
            saved_at: self.saved_at,
            count: docs.len(),
            dirty: docs.iter().filter(|d| d.text != d.disk.text).count(),
        }
    }
}

#[derive(Default)]
pub struct Recovery(pub Mutex<Store>);
#[derive(Default)]
pub struct Store {
    record: Option<Record>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl Store {
    pub fn load(&mut self, path: &Path) -> Result<&Record> {
        if self.record.is_none() {
            let mut record: Record = if path.try_exists().map_err(|e| e.to_string())? {
                serde_json::from_slice(&files::read_bytes(path, MAX_SESSION_BYTES)?).map_err(|e| format!("Cannot read recovery data: {e}. Delete it in Session & Recovery to start again."))?
            } else {
                Record::default()
            };
            if record.version != 1 {
                return Err("Unsupported recovery version; the saved data was not changed".into());
            }
            if let Some(session) = &record.session {
                session.validate()?;
            }
            if record.session.is_some() && now().saturating_sub(record.saved_at) > RETENTION_SECONDS
            {
                record.session = None;
                self.write(path, record)?;
            } else {
                self.record = Some(record);
            }
        }
        Ok(self.record.as_ref().unwrap())
    }
    fn write(&mut self, path: &Path, mut record: Record) -> Result<()> {
        let parent = path.parent().ok_or("Missing recovery directory")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        record.saved_at = now();
        let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_SESSION_BYTES {
            return Err(
                "Encoded recovery session exceeds 64 MiB; the previous checkpoint was kept".into(),
            );
        }
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temp.write_all(&bytes)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        temp.persist(path).map_err(|e| e.to_string())?;
        fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        self.record = Some(record);
        Ok(())
    }
    pub fn enable(&mut self, path: &Path, enabled: bool) -> Result<Status> {
        if !enabled {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
            if let Some(parent) = path.parent().filter(|p| p.exists()) {
                fs::File::open(parent)
                    .and_then(|f| f.sync_all())
                    .map_err(|e| e.to_string())?;
            }
            self.record = Some(Record::default());
        } else {
            let mut record = self.load(path)?.clone();
            record.enabled = true;
            self.write(path, record)?;
        }
        Ok(self.record.as_ref().unwrap().status())
    }
    pub fn checkpoint(&mut self, path: &Path, session: Session) -> Result<()> {
        if !self.load(path)?.enabled {
            return Err("Recovery is turned off".into());
        }
        session.validate()?;
        self.write(
            path,
            Record {
                version: 1,
                enabled: true,
                saved_at: now(),
                session: Some(session),
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session() -> Session {
        Session {
            documents: vec![Draft {
                path: "/notes/a.md".into(),
                text: "draft".into(),
                disk: files::text_snapshot("baseline"),
                mode: Mode::Source,
            }],
            workspace: Some("/notes".into()),
            active: Some("/notes/a.md".into()),
        }
    }
    #[test]
    fn private_atomic_recovery_survives_restart_and_can_be_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("private/session.json");
        let mut store = Store::default();
        assert!(!store.load(&path).unwrap().enabled);
        assert!(store.checkpoint(&path, session()).is_err());
        store.enable(&path, true).unwrap();
        store.checkpoint(&path, session()).unwrap();
        let mut restarted = Store::default();
        assert_eq!(
            restarted
                .load(&path)
                .unwrap()
                .session
                .as_ref()
                .unwrap()
                .documents[0]
                .text,
            "draft"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        restarted.enable(&path, false).unwrap();
        assert!(!path.exists());
    }
    #[test]
    fn malformed_sessions_are_rejected_without_replacing_the_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        let mut store = Store::default();
        store.enable(&path, true).unwrap();
        store.checkpoint(&path, session()).unwrap();
        let bytes = fs::read(&path).unwrap();
        let mut bad = session();
        bad.documents[0].disk.hash = "incorrect".into();
        assert!(store.checkpoint(&path, bad).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let mut duplicate = session();
        duplicate.documents.push(duplicate.documents[0].clone());
        assert!(duplicate.validate().is_err());
        let mut relative = session();
        relative.documents[0].path = "../a.md".into();
        assert!(relative.validate().is_err());
    }
    #[test]
    fn old_checkpoints_expire_but_keep_the_preference() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        let record = Record {
            version: 1,
            enabled: true,
            saved_at: 1,
            session: Some(session()),
        };
        fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
        let mut store = Store::default();
        let loaded = store.load(&path).unwrap();
        assert!(loaded.enabled && loaded.session.is_none());
    }
}
