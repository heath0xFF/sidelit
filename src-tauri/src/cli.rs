use crate::files::{canonical, supported_document, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub path: PathBuf,
    pub directory: bool,
    pub source: bool,
    pub find: Option<String>,
    pub anchor: Option<String>,
}

const MAX_FIND_CHARS: usize = 300;

pub fn parse(args: &[String], cwd: &Path) -> Result<Option<Request>> {
    let mut source = false;
    let mut path = None;
    let mut literal = false;
    let mut find = None;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if !literal && arg == "--find" {
            let text = args.next().ok_or("--find needs the text to look for")?;
            if text.trim().is_empty() || text.chars().count() > MAX_FIND_CHARS {
                return Err(format!("--find needs 1 to {MAX_FIND_CHARS} characters"));
            }
            find = Some(text.clone());
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
    path.map(|p| {
        let path = canonical(&p)?;
        let directory = path.is_dir();
        if !directory && !supported_document(&path) {
            return Err("Choose a .md, .markdown, .mdx, .html, or .htm file".into());
        }
        if directory && source {
            return Err("--source requires a supported document file".into());
        }
        if directory && find.is_some() {
            return Err("--find requires a supported document file".into());
        }
        Ok(Request {
            path,
            directory,
            source,
            find: find.clone(),
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
        assert_eq!(found.find.as_deref(), Some("a passage"));
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
