use crate::files::{canonical, markdown, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub path: PathBuf,
    pub directory: bool,
    pub source: bool,
}

pub fn parse(args: &[String], cwd: &Path) -> Result<Option<Request>> {
    let mut source = false;
    let mut path = None;
    let mut literal = false;
    for arg in args {
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
        if !directory && !markdown(&path) {
            return Err("Choose a .md or .markdown file".into());
        }
        if directory && source {
            return Err("--source requires a Markdown file".into());
        }
        Ok(Request {
            path,
            directory,
            source,
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
    }
}
