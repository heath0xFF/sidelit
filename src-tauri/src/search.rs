use crate::files::{self, Result};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub const EXCLUDED: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
];
#[derive(Serialize)]
pub struct Matches {
    pub paths: Vec<PathBuf>,
    pub incomplete: bool,
}

pub fn documents(root: &Path, query: &str) -> Result<Matches> {
    if query.len() > 512 {
        return Err("Search is limited to 512 bytes".into());
    }
    let terms: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
    let mut result = Matches {
        paths: Vec::new(),
        incomplete: false,
    };
    let mut stack = vec![(root.to_path_buf(), 0)];
    let mut visited = 0;
    let started = Instant::now();
    while let Some((directory, depth)) = stack.pop() {
        if fs::symlink_metadata(&directory)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true)
            || !files::canonical(&directory).is_ok_and(|p| p.starts_with(root))
        {
            result.incomplete = true;
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(e) if directory == root => return Err(e.to_string()),
            Err(_) => {
                result.incomplete = true;
                continue;
            }
        };
        for entry in entries {
            visited += 1;
            if visited > 50_000 || started.elapsed() > Duration::from_secs(2) {
                result.incomplete = true;
                result.paths.sort();
                return Ok(result);
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    result.incomplete = true;
                    continue;
                }
            };
            if EXCLUDED.contains(&entry.file_name().to_string_lossy().as_ref()) {
                continue;
            }
            let kind = match entry.file_type() {
                Ok(k) => k,
                Err(_) => {
                    result.incomplete = true;
                    continue;
                }
            };
            let path = entry.path();
            if kind.is_dir() {
                if depth < 64 {
                    stack.push((path, depth + 1));
                } else {
                    result.incomplete = true;
                }
            } else if kind.is_file() && files::supported_document(&path) {
                let relative = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .to_lowercase();
                if terms.iter().all(|term| relative.contains(term)) {
                    result.paths.push(path);
                    if result.paths.len() == 200 {
                        result.incomplete = true;
                        result.paths.sort();
                        return Ok(result);
                    }
                }
            }
        }
    }
    result.paths.sort();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_is_scoped_bounded_and_skips_generated_trees_and_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        fs::create_dir(root.join("notes")).unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join("notes/研究 Plan.MD"), "").unwrap();
        fs::write(root.join("notes/code.rs"), "").unwrap();
        fs::write(root.join("node_modules/hidden.md"), "").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("notes", root.join("linked")).unwrap();
        let found = documents(&root, "notes PLAN").unwrap();
        assert_eq!(found.paths, vec![root.join("notes/研究 Plan.MD")]);
        assert_eq!(documents(&root, "").unwrap().paths.len(), 1);
        for name in ["page.html", "page.htm", "page.mdx", "page.markdown"] {
            fs::write(root.join(name), "").unwrap();
        }
        assert_eq!(documents(&root, "page").unwrap().paths.len(), 4);
        for i in 0..210 {
            fs::write(root.join(format!("{i}.md")), "").unwrap();
        }
        let limited = documents(&root, "").unwrap();
        assert!(limited.incomplete);
        assert_eq!(limited.paths.len(), 200);
    }
}
