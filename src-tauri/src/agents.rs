use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use tauri::command;

const MAX_REGISTRY_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTarget {
    pub id: String,
    pub label: String,
    pub project_root: String,
    pub session_id: Option<String>,
    pub block_id: Option<String>,
    pub process: Option<String>,
    pub busy: bool,
    pub connected: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registration {
    id: String,
    socket_path: String,
    project_root: String,
    session_id: Option<String>,
    block_id: Option<String>,
    label: Option<String>,
    process: Option<String>,
    busy: Option<bool>,
    pid: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackMessage {
    pub id: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    pub document: Value,
    pub selection: Value,
    pub instruction: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackBatch {
    pub id: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    pub notes: Vec<FeedbackMessage>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeliveryAck {
    pub id: String,
    pub status: String,
    pub delivery: String,
}

fn registry_dir() -> PathBuf {
    #[cfg(unix)]
    return PathBuf::from(format!("/tmp/sidelit-pi-{}", unsafe { libc::geteuid() }));
    #[cfg(not(unix))]
    std::env::temp_dir().join("sidelit-pi-unsupported")
}

fn private_owned(path: &Path, directory: bool) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fs::symlink_metadata(path).is_ok_and(|m| {
            !m.file_type().is_symlink()
                && (!directory || m.is_dir())
                && m.uid() == unsafe { libc::geteuid() }
                && m.mode() & 0o077 == 0
        })
    }
    #[cfg(not(unix))]
    {
        let _ = (path, directory);
        false
    }
}

pub(crate) fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_:.".contains(&byte))
}

fn compatible(project: Option<&str>, target: &str) -> bool {
    let Some(project) = project.filter(|value| !value.is_empty()) else {
        return true;
    };
    project == target
        || Path::new(project).starts_with(target)
        || Path::new(target).starts_with(project)
}

fn read_registration(path: &Path) -> Option<Registration> {
    if !private_owned(path, false) {
        return None;
    }
    let bytes = crate::files::read_bytes(path, MAX_REGISTRY_BYTES).ok()?;
    let registration: Registration = serde_json::from_slice(&bytes).ok()?;
    if !safe_id(&registration.id)
        || registration.project_root.is_empty()
        || registration.socket_path.is_empty()
    {
        return None;
    }
    Some(registration)
}

fn registrations() -> Vec<Registration> {
    if !private_owned(&registry_dir(), true) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(registry_dir()) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .filter_map(|entry| read_registration(&entry.path()))
        .filter(|registration| {
            let socket = Path::new(&registration.socket_path);
            #[cfg(unix)]
            {
                use std::os::unix::fs::FileTypeExt;
                socket.parent() == Some(registry_dir().as_path())
                    && private_owned(socket, false)
                    && fs::symlink_metadata(socket).is_ok_and(|m| m.file_type().is_socket())
                    && registration.pid > 0
                    && unsafe { libc::kill(registration.pid as i32, 0) == 0 }
            }
            #[cfg(not(unix))]
            {
                let _ = socket;
                false
            }
        })
        .collect()
}

fn registered_targets(project_root: Option<&str>) -> Vec<AgentTarget> {
    registrations()
        .into_iter()
        .filter(|registration| compatible(project_root, &registration.project_root))
        .map(|registration| AgentTarget {
            id: registration.id,
            label: registration.label.unwrap_or_else(|| "Pi".to_string()),
            project_root: registration.project_root,
            session_id: registration.session_id,
            block_id: registration.block_id,
            process: registration.process,
            busy: registration.busy.unwrap_or(false),
            connected: true,
        })
        .collect()
}

fn rex_command() -> Command {
    let executable = std::env::var_os("REX_BIN_DIR")
        .map(|dir| PathBuf::from(dir).join("rex"))
        .unwrap_or_else(|| PathBuf::from("rex"));
    let mut command = Command::new(executable);
    command.arg("--autostart=false");
    command
}

fn rex_json(args: &[&str]) -> Option<Value> {
    let mut child = rex_command()
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(1024 * 1024 + 1).read_to_end(&mut bytes).ok()?;
        Some(bytes)
    });
    let deadline = Instant::now() + Duration::from_millis(800);
    loop {
        match child.try_wait().ok()? {
            Some(status) => {
                let bytes = reader.join().ok()??;
                return if status.success() && bytes.len() <= 1024 * 1024 {
                    serde_json::from_slice(&bytes).ok()
                } else {
                    None
                };
            }
            None if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn rex_targets(project_root: Option<&str>) -> Vec<AgentTarget> {
    let Some(Value::Array(sessions)) =
        rex_json(&["ls", "--json"]).and_then(|value| value.get("sessions").cloned())
    else {
        return Vec::new();
    };
    let mut targets = Vec::new();
    let started = Instant::now();
    for session in sessions.into_iter().take(32) {
        if started.elapsed() > Duration::from_secs(3) {
            break;
        }
        let Some(session_id) = session.get("session_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(view) = rex_json(&["session", "inspect", session_id, "--json"]) else {
            continue;
        };
        let Some(windows) = view.get("windows").and_then(Value::as_array) else {
            continue;
        };
        for window in windows {
            let Some(layers) = window.get("layers").and_then(Value::as_array) else {
                continue;
            };
            for layer in layers {
                let Some(blocks) = layer.get("blocks").and_then(Value::as_array) else {
                    continue;
                };
                for block in blocks {
                    if started.elapsed() > Duration::from_secs(3) {
                        return targets;
                    }
                    let Some(block_id) = block.get("block_id").and_then(Value::as_str) else {
                        continue;
                    };
                    if block.get("creator_name").and_then(Value::as_str)
                        != Some("com.superlogical.terminal")
                    {
                        continue;
                    }
                    let process_arg = format!(r#"{{"block_id":"{block_id}"}}"#);
                    let process = rex_json(&[
                        "api",
                        "call",
                        "-s",
                        session_id,
                        "com.superlogical.terminal.process",
                        &process_arg,
                    ]);
                    let foreground = process.as_ref().and_then(|value| value.get("foreground"));
                    let process_name = foreground
                        .and_then(|value| value.get("name"))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    if !process_name
                        .as_deref()
                        .is_some_and(|name| name.eq_ignore_ascii_case("pi"))
                    {
                        continue;
                    }
                    let cwd = foreground
                        .and_then(|value| value.get("cwd"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if !compatible(project_root, cwd) {
                        continue;
                    }
                    let label = block
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or("Pi")
                        .to_string();
                    targets.push(AgentTarget {
                        id: format!("rex:{session_id}:{block_id}"),
                        label,
                        project_root: cwd.to_string(),
                        session_id: Some(session_id.to_string()),
                        block_id: Some(block_id.to_string()),
                        process: process_name,
                        busy: false,
                        connected: false,
                    });
                }
            }
        }
    }
    targets
}

pub(crate) fn discover_targets(project_root: Option<String>) -> Vec<AgentTarget> {
    let project = project_root.as_deref();
    let mut targets = registered_targets(project);
    let registered_pairs: Vec<(String, String)> = targets
        .iter()
        .filter_map(|target| Some((target.session_id.clone()?, target.block_id.clone()?)))
        .collect();
    targets.extend(rex_targets(project).into_iter().filter(|target| {
        !registered_pairs.iter().any(|(session, block)| {
            target.session_id.as_deref() == Some(session.as_str())
                && target.block_id.as_deref() == Some(block.as_str())
        })
    }));
    targets.sort_by_key(|target| (!target.connected, target.busy, target.label.clone()));
    targets
}

pub(crate) fn rex_available() -> bool {
    rex_json(&["whoami", "--json"]).is_some()
}

#[command]
pub async fn agent_targets(project_root: Option<String>) -> Result<Vec<AgentTarget>, String> {
    tauri::async_runtime::spawn_blocking(move || discover_targets(project_root))
        .await
        .map_err(|e| e.to_string())
}

pub(crate) fn validate_note(message: &FeedbackMessage, draft: bool) -> Result<(), String> {
    if message
        .intent
        .as_deref()
        .is_some_and(|value| !matches!(value, "explain" | "review" | "edit"))
    {
        return Err("Unknown feedback intent".into());
    }
    if message.source != "sidelit" || !safe_id(&message.id) {
        return Err("Invalid Sidelit feedback message".into());
    }
    if (!draft && message.instruction.trim().is_empty()) || message.instruction.len() > 8000 {
        return Err("Feedback instruction must be between 1 and 8000 bytes".into());
    }
    if serde_json::to_vec(&message.document).map_or(true, |bytes| bytes.len() > 6000)
        || serde_json::to_vec(&message.selection)
            .map_or(true, |bytes| bytes.len() > if draft { 16000 } else { 8000 })
    {
        return Err("Feedback context is too large".into());
    }
    if !matches!(
        message.document.get("format").and_then(Value::as_str),
        Some("markdown" | "html" | "mdx" | "url")
    ) || !matches!(
        message.selection.get("type").and_then(Value::as_str),
        Some("text" | "element" | "document")
    ) || !message.selection.get("text").is_some_and(Value::is_string)
    {
        return Err("Invalid feedback context".into());
    }
    if !message.document.get("path").is_some_and(Value::is_string)
        && !message.document.get("url").is_some_and(Value::is_string)
    {
        return Err("Feedback needs a document path or URL".into());
    }
    if let Some(url) = message.document.get("url") {
        let valid = url
            .as_str()
            .and_then(|value| url::Url::parse(value).ok())
            .is_some_and(|url| matches!(url.scheme(), "http" | "https"));
        if !valid {
            return Err("Invalid feedback page URL".into());
        }
    }
    let strings = |value: &Value, keys: &[&str]| {
        keys.iter()
            .all(|key| value.get(key).is_none_or(Value::is_string))
    };
    if !strings(&message.document, &["path", "diskHash", "capturedAt"])
        || !strings(
            &message.selection,
            &[
                "selector",
                "tag",
                "id",
                "surrounding",
                "prefix",
                "suffix",
                "anchorText",
                "locatorConfidence",
            ],
        )
        || message
            .document
            .get("revision")
            .is_some_and(|v| v.as_u64().is_none_or(|n| n > 9_007_199_254_740_991))
        || message
            .document
            .get("unsaved")
            .is_some_and(|v| !v.is_boolean())
        || message
            .selection
            .get("truncated")
            .is_some_and(|v| !v.is_boolean())
        || message.selection.get("sourceLine").is_some_and(|v| {
            !v.is_null()
                && v.as_u64()
                    .is_none_or(|n| n == 0 || n > 9_007_199_254_740_991)
        })
        || message.selection.get("classes").is_some_and(|v| {
            v.as_array()
                .is_none_or(|items| items.len() > 8 || items.iter().any(|v| !v.is_string()))
        })
        || message.selection.get("styles").is_some_and(|v| {
            v.as_object()
                .is_none_or(|styles| styles.values().any(|v| !v.is_string()))
        })
    {
        return Err("Invalid feedback capture metadata".into());
    }
    Ok(())
}

fn note_scope(note: &FeedbackMessage) -> Option<String> {
    if let Some(root) = note.project_root.as_deref().filter(|root| !root.is_empty()) {
        return Path::new(root)
            .is_absolute()
            .then(|| format!("project:{root}"));
    }
    let url = url::Url::parse(note.document.get("url")?.as_str()?).ok()?;
    matches!(url.scheme(), "http" | "https")
        .then(|| format!("page:{}", url.origin().ascii_serialization()))
}

pub(crate) fn validate_batch(batch: &FeedbackBatch) -> Result<(), String> {
    if batch.source != "sidelit"
        || !safe_id(&batch.id)
        || batch.notes.is_empty()
        || batch.notes.len() > 20
        || serde_json::to_vec(batch).map_or(true, |bytes| bytes.len() > 30 * 1024)
    {
        return Err("Review batch must contain 1–20 notes and fit within 30 KiB".into());
    }
    let scope =
        note_scope(&batch.notes[0]).ok_or("Review notes need a project or live-page origin")?;
    let mut ids = std::collections::HashSet::new();
    for note in &batch.notes {
        validate_note(note, false)?;
        if !ids.insert(&note.id)
            || note.id == batch.id
            || note_scope(note).as_ref() != Some(&scope)
            || note.project_root != batch.project_root
        {
            return Err(
                "Review notes must have unique IDs and belong to one project or live-page origin"
                    .into(),
            );
        }
    }
    Ok(())
}

pub(crate) fn bridge_health(target_id: &str) -> Result<Value, String> {
    let registration = registrations()
        .into_iter()
        .find(|r| r.id == target_id)
        .ok_or("Pi session disconnected")?;
    #[cfg(unix)]
    {
        let mut stream = std::os::unix::net::UnixStream::connect(&registration.socket_path)
            .map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_millis(800)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_millis(800)))
            .map_err(|e| e.to_string())?;
        stream
            .write_all(b"{\"op\":\"ping\",\"id\":\"sidelit-doctor\"}\n")
            .map_err(|e| e.to_string())?;
        let mut line = String::new();
        BufReader::new(stream.take(8193))
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        let response: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if line.len() > 8192
            || response["id"] != "sidelit-doctor"
            || response["status"] != "ready"
            || response["protocol"] != 1
        {
            return Err("Bridge needs an update or /reload in Pi".into());
        }
        Ok(response)
    }
    #[cfg(not(unix))]
    {
        let _ = registration;
        Err("Pi requires a Unix-like desktop".into())
    }
}

#[command]
pub async fn focus_agent(target_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = registrations()
            .into_iter()
            .find(|r| r.id == target_id)
            .ok_or("Pi session disconnected")?;
        let (session, block) = target
            .session_id
            .zip(target.block_id)
            .ok_or("This Pi session is not associated with Rex")?;
        if !safe_id(&session)
            || !safe_id(&block)
            || !session.starts_with("session:")
            || !block.starts_with("block:")
        {
            return Err("Invalid Rex destination".into());
        }
        let status = rex_command()
            .args(["--timeout", "2s", "focus", "-s", &session, &block])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("Could not open Rex: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("Rex could not focus that session. It may have closed.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn delivery(target_id: String, message: Value, id: &str) -> Result<DeliveryAck, String> {
    let registration = registrations()
        .into_iter()
        .find(|registration| registration.id == target_id)
        .ok_or_else(|| "That Pi session is no longer connected".to_string())?;
    if message.get("op").and_then(Value::as_str) != Some("status") {
        let project = if message.get("notes").is_some() {
            let batch: FeedbackBatch = serde_json::from_value(message.clone())
                .map_err(|e| format!("Invalid review batch: {e}"))?;
            validate_batch(&batch)?;
            batch.project_root
        } else {
            let feedback: FeedbackMessage = serde_json::from_value(message.clone())
                .map_err(|e| format!("Invalid feedback: {e}"))?;
            validate_note(&feedback, false)?;
            feedback.project_root
        };
        if !compatible(project.as_deref(), &registration.project_root) {
            return Err("The selected Pi session belongs to a different project".into());
        }
    }
    #[cfg(not(unix))]
    return Err("Pi delivery currently requires a Unix-like desktop".into());
    #[cfg(unix)]
    {
        let socket = Path::new(&registration.socket_path);
        if !private_owned(socket, false) {
            return Err("Unsafe Pi bridge socket permissions".into());
        }
        let mut stream = std::os::unix::net::UnixStream::connect(socket)
            .map_err(|e| format!("Could not reach Pi: {e}"))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        let line = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        stream
            .write_all(line.as_bytes())
            .and_then(|_| stream.write_all(b"\n"))
            .map_err(|e| format!("Could not send feedback to Pi: {e}"))?;
        let mut response = String::new();
        BufReader::new(stream.take(8193))
            .read_line(&mut response)
            .map_err(|e| format!("Pi did not acknowledge feedback: {e}"))?;
        parse_ack(&response, id)
    }
}

fn parse_ack(response: &str, id: &str) -> Result<DeliveryAck, String> {
    if response.len() > 8192 || !response.ends_with('\n') {
        return Err("Pi acknowledgment was incomplete or too large".into());
    }
    let value: Value =
        serde_json::from_str(response).map_err(|e| format!("Invalid Pi acknowledgment: {e}"))?;
    if value.get("id").and_then(Value::as_str) != Some(id) {
        return Err("Pi acknowledged a different message".into());
    }
    if value.get("status").and_then(Value::as_str) == Some("error") {
        return Err(value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Pi rejected feedback")
            .to_string());
    }
    let ack: DeliveryAck = serde_json::from_value(value).map_err(|e| e.to_string())?;
    if !matches!(ack.status.as_str(), "received" | "accepted" | "duplicate")
        || !matches!(ack.delivery.as_str(), "submitted" | "queued" | "consumed")
    {
        return Err("Unknown Pi acknowledgment status".into());
    }
    Ok(ack)
}

#[command]
pub async fn send_feedback(
    target_id: String,
    message: FeedbackMessage,
) -> Result<DeliveryAck, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delivery(
            target_id,
            serde_json::to_value(&message).map_err(|e| e.to_string())?,
            &message.id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn send_review(target_id: String, message: FeedbackBatch) -> Result<DeliveryAck, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delivery(
            target_id,
            serde_json::to_value(&message).map_err(|e| e.to_string())?,
            &message.id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn feedback_status(target_id: String, id: String) -> Result<DeliveryAck, String> {
    if !safe_id(&id) {
        return Err("Invalid message ID".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        delivery(
            target_id,
            serde_json::json!({"op": "status", "id": id}),
            &id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batches_are_bounded_and_keep_project_and_note_identities() {
        let note = serde_json::json!({"id":"one","source":"sidelit","projectRoot":"/repo",
            "document":{"path":"/repo/doc.md","format":"markdown"},
            "selection":{"type":"text","text":"Quote"},"instruction":"Explain this","intent":"explain"});
        let mut batch: FeedbackBatch = serde_json::from_value(serde_json::json!({"id":"batch","source":"sidelit","projectRoot":"/repo","notes":[note]})).unwrap();
        assert!(validate_batch(&batch).is_ok());
        batch.notes.push(batch.notes[0].clone());
        assert!(validate_batch(&batch).is_err());
        batch.notes[1].id = "two".into();
        assert!(validate_batch(&batch).is_ok());
        batch.notes[1].project_root = Some("/repo/other".into());
        assert!(validate_batch(&batch).is_err());
        batch.notes.pop();
        batch.notes[0].id = "batch".into();
        assert!(validate_batch(&batch).is_err());
        batch.notes[0].id = "one".into();
        batch.notes[0].instruction = "語".repeat(2700);
        assert!(validate_batch(&batch).is_err());
        batch.notes[0].instruction = "語".repeat(2000);
        batch.notes = (0..6)
            .map(|i| {
                let mut note = batch.notes[0].clone();
                note.id = format!("note-{i}");
                note
            })
            .collect();
        assert!(validate_batch(&batch).is_err());
        batch.notes.clear();
        assert!(validate_batch(&batch).is_err());
    }

    #[test]
    fn ids_are_bounded_and_path_safe() {
        assert!(safe_id("pi-session_01:socket"));
        assert!(!safe_id(""));
        assert!(!safe_id("pi session"));
        assert!(!safe_id(&"x".repeat(129)));
    }

    #[test]
    fn projects_match_when_one_is_a_parent() {
        assert!(compatible(Some("/work/site"), "/work/site"));
        assert!(compatible(Some("/work/site/docs"), "/work/site"));
        assert!(compatible(Some("/work"), "/work/site"));
        assert!(!compatible(Some("/work/other"), "/work/site"));
        assert!(compatible(None, "/work/site"));
        assert!(!compatible(Some("/work/site-other"), "/work/site"));
    }

    #[test]
    fn receipts_require_matching_ids_complete_framing_and_known_semantics() {
        let received = "{\"id\":\"one\",\"status\":\"received\",\"delivery\":\"queued\"}\n";
        assert_eq!(parse_ack(received, "one").unwrap().status, "received");
        assert!(parse_ack(received, "two").is_err());
        assert!(parse_ack(received.trim(), "one").is_err());
        assert!(parse_ack(&format!("{}\n", "x".repeat(8192)), "one").is_err());
        assert!(parse_ack(
            "{\"id\":\"one\",\"status\":\"error\",\"error\":\"different project\"}\n",
            "one"
        )
        .unwrap_err()
        .contains("different project"));
        assert!(parse_ack(
            "{\"id\":\"one\",\"status\":\"success\",\"delivery\":\"typed\"}\n",
            "one"
        )
        .is_err());
    }
}
