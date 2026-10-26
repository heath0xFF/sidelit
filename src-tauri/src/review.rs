use crate::{
    agents::{self, DeliveryAck, FeedbackBatch, FeedbackMessage},
    files::{self, Result},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

const MAX_BYTES: u64 = 512 * 1024;
#[derive(Default)]
pub struct Review(pub Mutex<()>);

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Attempt {
    target: String,
    message: FeedbackBatch,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ack: Option<DeliveryAck>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    version: u32,
    notes: Vec<FeedbackMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attempt: Option<Attempt>,
}
impl Default for Record {
    fn default() -> Self {
        Self {
            version: 1,
            notes: Vec::new(),
            attempt: None,
        }
    }
}
impl Record {
    fn validate(&self) -> Result<()> {
        if self.version != 1 || self.notes.len() > 20 {
            return Err("Unsupported review record or more than 20 notes".into());
        }
        let mut ids = HashSet::new();
        for note in &self.notes {
            agents::validate_note(note, true)?;
            if !ids.insert(&note.id) {
                return Err("Duplicate review note ID".into());
            }
        }
        if let Some(attempt) = &self.attempt {
            agents::validate_batch(&attempt.message)?;
            if !agents::safe_id(&attempt.target)
                || attempt
                    .message
                    .notes
                    .iter()
                    .any(|note| !ids.contains(&note.id))
            {
                return Err("Invalid review delivery target or missing note".into());
            }
            if let Some(ack) = &attempt.ack {
                if ack.id != attempt.message.id
                    || !matches!(ack.status.as_str(), "received" | "accepted" | "duplicate")
                    || !matches!(ack.delivery.as_str(), "submitted" | "queued" | "consumed")
                {
                    return Err("Invalid review receipt".into());
                }
            }
        }
        Ok(())
    }
}
fn load(path: &Path) -> Result<Record> {
    if !path.try_exists().map_err(|e| e.to_string())? {
        return Ok(Record::default());
    }
    let record: Record = serde_json::from_slice(&files::read_bytes(path, MAX_BYTES)?)
        .map_err(|e| format!("Cannot read review notes: {e}. The saved file was not changed."))?;
    record.validate()?;
    Ok(record)
}
fn save(path: &Path, record: &Record) -> Result<()> {
    record.validate()?;
    let bytes = serde_json::to_vec(record).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Review notes exceed 512 KiB; the previous notes were kept".into());
    }
    let parent = path.parent().ok_or("Missing review directory")?;
    // Only an explicit empty record can replace unreadable saved notes.
    if !record.notes.is_empty() {
        let old = load(path)?;
        if let Some(previous) = old.attempt {
            if let Some(next) = &record.attempt {
                if next.target != previous.target
                    || next.message != previous.message
                    || previous.message.notes.iter().any(|sent| {
                        old.notes.iter().find(|note| note.id == sent.id)
                            != record.notes.iter().find(|note| note.id == sent.id)
                    })
                {
                    return Err(
                        "A review delivery attempt cannot change its target or payload".into(),
                    );
                }
            } else if previous
                .message
                .notes
                .iter()
                .any(|sent| record.notes.iter().any(|note| note.id == sent.id))
            {
                return Err("Remove attempted notes together with their delivery record".into());
            }
        }
    }
    if record.notes.is_empty() {
        match fs::remove_file(path) {
            Ok(()) => {
                fs::File::open(parent)
                    .and_then(|f| f.sync_all())
                    .map_err(|e| e.to_string())?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        return Ok(());
    }
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    fs::File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("review/notes.json"))
}
#[tauri::command]
pub async fn load_review(app: AppHandle, review: State<'_, Review>) -> Result<Record> {
    let _guard = review.0.lock().unwrap();
    load(&path(&app)?)
}
#[tauri::command]
pub async fn store_review(app: AppHandle, review: State<'_, Review>, record: Record) -> Result<()> {
    let _guard = review.0.lock().unwrap();
    save(&path(&app)?, &record)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record() -> Record {
        serde_json::from_value(serde_json::json!({"version":1,"notes":[{
            "id":"one","source":"sidelit","projectRoot":"/repo","intent":"edit",
            "document":{"path":"/repo/doc.md","format":"markdown"},
            "selection":{"type":"text","text":"Keep this"},"instruction":""
        }]}))
        .unwrap()
    }
    #[test]
    fn notes_are_private_atomic_bounded_and_explicitly_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("review/notes.json");
        save(&path, &record()).unwrap();
        assert_eq!(load(&path).unwrap().notes[0].selection["text"], "Keep this");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        let before = fs::read(&path).unwrap();
        let mut bad = record();
        bad.notes.push(bad.notes[0].clone());
        assert!(save(&path, &bad).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        bad.notes = vec![record().notes[0].clone(); 21];
        assert!(save(&path, &bad).is_err());
        fs::write(&path, b"invalid").unwrap();
        assert!(load(&path).is_err());
        assert!(save(&path, &record()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"invalid");
        save(&path, &Record::default()).unwrap();
        assert!(!path.exists());
    }
    #[test]
    fn malformed_capture_metadata_is_rejected_before_display() {
        for (field, value) in [
            ("path", serde_json::json!(42)),
            ("capturedAt", serde_json::json!({})),
            ("unsaved", serde_json::json!("yes")),
        ] {
            let mut bad = record();
            bad.notes[0].document[field] = value;
            assert!(bad.validate().is_err());
        }
        for field in ["tag", "selector", "prefix", "anchorText"] {
            let mut bad = record();
            bad.notes[0].selection[field] = serde_json::json!(["not text"]);
            assert!(bad.validate().is_err());
        }
    }

    #[test]
    fn frozen_attempt_survives_restart_and_cannot_be_retargeted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.json");
        let mut r = record();
        let mut note = r.notes[0].clone();
        note.instruction = "Edit this".into();
        r.attempt = Some(Attempt {
            target: "pi-1".into(),
            message: FeedbackBatch {
                id: "batch-1".into(),
                source: "sidelit".into(),
                project_root: Some("/repo".into()),
                notes: vec![note],
            },
            ack: None,
        });
        save(&path, &r).unwrap();
        let mut restored = load(&path).unwrap();
        assert_eq!(restored.attempt.as_ref().unwrap().message.id, "batch-1");
        restored.attempt.as_mut().unwrap().target = "pi-2".into();
        assert!(save(&path, &restored).is_err());
        restored.attempt = None;
        assert!(save(&path, &restored).is_err());
        save(&path, &Record::default()).unwrap();
    }
}
