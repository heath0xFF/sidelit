use crate::files::{canonical, supported_document, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
pub struct Stop {
    pub find: String,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub path: PathBuf,
    pub directory: bool,
    pub source: bool,
    pub stops: Vec<Stop>,
    pub append: bool,
    pub anchor: Option<String>,
}

const MAX_FIND_CHARS: usize = 300;
const MAX_NOTE_CHARS: usize = 500;
const MAX_STOPS: usize = 20;

pub fn parse(args: &[String], cwd: &Path) -> Result<Option<Request>> {
    let mut source = false;
    let mut path = None;
    let mut literal = false;
    let mut stops: Vec<Stop> = Vec::new();
    let mut append = false;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if !literal && arg == "--find" {
            let text = args.next().ok_or("--find needs the text to look for")?;
            if text.trim().is_empty() || text.chars().count() > MAX_FIND_CHARS {
                return Err(format!("--find needs 1 to {MAX_FIND_CHARS} characters"));
            }
            if stops.len() == MAX_STOPS {
                return Err(format!("Use at most {MAX_STOPS} --find stops per request"));
            }
            stops.push(Stop {
                find: text.clone(),
                note: None,
            });
            continue;
        }
        if !literal && arg == "--note" {
            let text = args.next().ok_or("--note needs the text to show")?;
            if text.trim().is_empty() || text.chars().count() > MAX_NOTE_CHARS {
                return Err(format!("--note needs 1 to {MAX_NOTE_CHARS} characters"));
            }
            match stops.last_mut() {
                Some(stop) if stop.note.is_none() => stop.note = Some(text.clone()),
                _ => return Err("Each --note must follow its own --find".into()),
            }
            continue;
        }
        if !literal && arg == "--then" {
            append = true;
            continue;
        }
        if !literal && arg == "--" {
            literal = true;
            continue;
        }
        if !literal && arg == "--source" {
            source = true;
            continue;
        }
        if !literal && arg.starts_with('-') {
            return Err(format!("Unknown option: {arg}. Use --help."));
        }
        if path.is_some() {
            return Err("Open one file or directory per CLI request".into());
        }
        path = Some(cwd.join(arg));
    }
    if append && stops.is_empty() {
        return Err("--then adds --find stops to a walkthrough".into());
    }
    if path.is_none() && !stops.is_empty() {
        return Err("--find requires a supported document file".into());
    }
    path.map(|p| {
        let path = canonical(&p)?;
        let directory = path.is_dir();
        if !directory && !supported_document(&path) {
            return Err("Choose a .md, .markdown, .mdx, .html, or .htm file".into());
        }
        if directory && source {
            return Err("--source requires a supported document file".into());
        }
        if directory && !stops.is_empty() {
            return Err("--find requires a supported document file".into());
        }
        Ok(Request {
            path,
            directory,
            source,
            stops: stops.clone(),
            append,
            anchor: None,
        })
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn caller_cwd_unicode_spaces_and_validation() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("研究 notes.md");
        std::fs::write(&p, "# Hi").unwrap();
        let request = parse(&["--source".into(), "研究 notes.md".into()], dir.path())
            .unwrap()
            .unwrap();
        assert_eq!(request.path, canonical(&p).unwrap());
        assert!(request.source);
        assert!(parse(&["absent.md".into()], dir.path()).is_err());
        assert!(parse(&["--wat".into()], dir.path()).is_err());
        assert!(parse(&["--source".into(), ".".into()], dir.path()).is_err());

        let found = parse(
            &["--find".into(), "a passage".into(), "研究 notes.md".into()],
            dir.path(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(found.stops[0].find, "a passage");
        assert!(found.stops[0].note.is_none() && !found.append);
        let name = "研究 notes.md".to_string();
        let walk = parse(
            &[
                "--then".into(),
                "--find".into(),
                "one".into(),
                "--note".into(),
                "why".into(),
                "--find".into(),
                "two".into(),
                name.clone(),
            ],
            dir.path(),
        )
        .unwrap()
        .unwrap();
        assert!(walk.append);
        assert_eq!(walk.stops.len(), 2);
        assert_eq!(walk.stops[0].note.as_deref(), Some("why"));
        assert!(walk.stops[1].note.is_none());
        for bad in [
            vec!["--note".to_string(), "x".into(), name.clone()],
            vec!["--then".to_string(), name.clone()],
            vec!["--find".to_string(), "a".into()],
            vec![
                "--find".to_string(),
                "a".into(),
                "--note".into(),
                "x".into(),
                "--note".into(),
                "y".into(),
                name.clone(),
            ],
            vec![
                "--find".to_string(),
                "a".into(),
                "--note".into(),
                "x".repeat(501),
                name.clone(),
            ],
        ] {
            assert!(parse(&bad, dir.path()).is_err(), "{bad:?}");
        }
        let too_many: Vec<String> = (0..21)
            .flat_map(|_| ["--find".to_string(), "a".to_string()])
            .chain([name.clone()])
            .collect();
        assert!(parse(&too_many, dir.path()).is_err());
        assert!(parse(&["--find".into()], dir.path()).is_err());
        assert!(parse(
            &["--find".into(), " ".into(), "研究 notes.md".into()],
            dir.path()
        )
        .is_err());
        assert!(parse(
            &["--find".into(), "x".repeat(301), "研究 notes.md".into()],
            dir.path()
        )
        .is_err());
        assert!(parse(&["--find".into(), "x".into(), ".".into()], dir.path()).is_err());

        for extension in ["html", "mdx"] {
            let path = dir.path().join(format!("page.{extension}"));
            std::fs::write(&path, "<h1>Preview</h1>").unwrap();
            assert!(parse(
                &[path
                    .file_name()
                    .unwrap()
                    .to_os_string()
                    .into_string()
                    .unwrap()],
                dir.path()
            )
            .is_ok());
        }
    }
}
