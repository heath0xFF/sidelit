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
    matching(root, query, 200)
}

pub fn matching(root: &Path, query: &str, limit: usize) -> Result<Matches> {
    if query.len() > 512 {
        return Err("Search is limited to 512 bytes".into());
    }
    let terms: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
    let mut paths = Vec::new();
    let incomplete = walk(root, Duration::from_secs(2), |path| {
        let relative = path
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .to_lowercase();
        if terms.iter().all(|term| relative.contains(term)) {
            paths.push(path.to_path_buf());
            if paths.len() == limit {
                return Visit::Stop;
            }
        }
        Visit::Continue
    })?;
    paths.sort();
    Ok(Matches { paths, incomplete })
}

enum Visit {
    Continue,
    Stop,
}

// Visits supported documents under root, skipping symlinks and generated trees, within
// entry and time limits. Returns whether the walk stopped before seeing everything.
fn walk(root: &Path, budget: Duration, mut visit: impl FnMut(&Path) -> Visit) -> Result<bool> {
    let mut incomplete = false;
    let mut stack = vec![(root.to_path_buf(), 0)];
    let mut visited = 0;
    let started = Instant::now();
    while let Some((directory, depth)) = stack.pop() {
        if fs::symlink_metadata(&directory)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true)
            || !files::canonical(&directory).is_ok_and(|p| p.starts_with(root))
        {
            incomplete = true;
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(e) if directory == root => return Err(e.to_string()),
            Err(_) => {
                incomplete = true;
                continue;
            }
        };
        for entry in entries {
            visited += 1;
            if visited > 50_000 || started.elapsed() > budget {
                return Ok(true);
            }
            let Ok(entry) = entry else {
                incomplete = true;
                continue;
            };
            if EXCLUDED.contains(&entry.file_name().to_string_lossy().as_ref()) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                incomplete = true;
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if depth < 64 {
                    stack.push((path, depth + 1));
                } else {
                    incomplete = true;
                }
            } else if kind.is_file() && files::supported_document(&path) {
                if let Visit::Stop = visit(&path) {
                    return Ok(true);
                }
            }
        }
    }
    Ok(incomplete)
}

const MAX_CONTENT_QUERY_CHARS: usize = 128;
const MAX_CONTENT_RESULTS: usize = 200;
const MAX_RESULTS_PER_FILE: usize = 20;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const SNIPPET_CHARS: usize = 160;

#[derive(Debug, Serialize, PartialEq)]
pub struct ContentMatch {
    pub path: PathBuf,
    pub line: usize,
    pub snippet: String,
    // The matched text as written in the file, for jumping to it.
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct ContentMatches {
    pub matches: Vec<ContentMatch>,
    pub incomplete: bool,
}

// Case-insensitive positions of needle in line, as byte ranges of the original line.
fn find_folded(line: &str, needle: &str) -> Vec<(usize, usize)> {
    let mut folded = String::new();
    let mut origin = Vec::new();
    for (at, c) in line.char_indices() {
        for lower in c.to_lowercase() {
            let start = folded.len();
            folded.push(lower);
            origin.extend(std::iter::repeat_n(at, folded.len() - start));
        }
    }
    let end_of = |index: usize| {
        let at = origin[index];
        at + line[at..].chars().next().map_or(0, char::len_utf8)
    };
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(offset) = folded[from..].find(needle) {
        let start = from + offset;
        let last = start + needle.len() - 1;
        found.push((origin[start], end_of(last)));
        from = start + needle.len();
    }
    found
}

fn snippet(line: &str, start: usize) -> String {
    let line = line.trim_end();
    if line.chars().count() <= SNIPPET_CHARS {
        return line.trim_start().to_string();
    }
    let before = line[..start.min(line.len())].chars().count();
    let skip = before.saturating_sub(SNIPPET_CHARS / 3);
    let mut text: String = line.chars().skip(skip).take(SNIPPET_CHARS).collect();
    if skip > 0 {
        text.insert(0, '…');
    }
    if skip + SNIPPET_CHARS < line.chars().count() {
        text.push('…');
    }
    text
}

pub fn contents(root: &Path, query: &str) -> Result<ContentMatches> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || query.trim().chars().count() > MAX_CONTENT_QUERY_CHARS {
        return Err(format!(
            "Search for 1 to {MAX_CONTENT_QUERY_CHARS} characters"
        ));
    }
    let mut matches = Vec::new();
    let mut skipped = false;
    let mut total = 0u64;
    let incomplete = walk(root, Duration::from_secs(3), |path| {
        let Ok(bytes) = files::read_bytes(path, MAX_FILE_BYTES) else {
            skipped = true;
            return Visit::Continue;
        };
        total += bytes.len() as u64;
        if total > MAX_TOTAL_BYTES {
            return Visit::Stop;
        }
        let Ok(text) = String::from_utf8(bytes) else {
            skipped = true;
            return Visit::Continue;
        };
        let mut in_file = 0;
        for (index, line) in text.lines().enumerate() {
            // One result per line is enough to find it.
            if let Some(&(start, end)) = find_folded(line, &needle).first() {
                matches.push(ContentMatch {
                    path: path.to_path_buf(),
                    line: index + 1,
                    snippet: snippet(line, start),
                    text: line[start..end].to_string(),
                });
                in_file += 1;
                if matches.len() == MAX_CONTENT_RESULTS {
                    return Visit::Stop;
                }
                if in_file == MAX_RESULTS_PER_FILE {
                    skipped = true;
                    return Visit::Continue;
                }
            }
        }
        Visit::Continue
    })?;
    matches.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    Ok(ContentMatches {
        matches,
        incomplete: incomplete || skipped,
    })
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

    #[test]
    fn content_search_is_case_insensitive_bounded_and_skips_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let root = files::canonical(dir.path()).unwrap();
        fs::create_dir(root.join("notes")).unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(
            root.join("notes/a.md"),
            "# Title\nThe Release Plan\nnothing\n",
        )
        .unwrap();
        fs::write(root.join("b.html"), "<p>release plan</p>").unwrap();
        fs::write(root.join("code.rs"), "release plan").unwrap();
        fs::write(root.join("node_modules/c.md"), "release plan").unwrap();
        fs::write(root.join("binary.md"), [0xff, 0xfe, 0x00]).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("notes", root.join("linked")).unwrap();
        let found = contents(&root, "  release PLAN ").unwrap();
        assert_eq!(
            found
                .matches
                .iter()
                .map(|m| (m.path.clone(), m.line, m.text.as_str()))
                .collect::<Vec<_>>(),
            [
                (root.join("b.html"), 1, "release plan"),
                (root.join("notes/a.md"), 2, "Release Plan"),
            ]
        );
        assert!(found.incomplete, "the non-UTF-8 file was skipped");
        assert!(contents(&root, "   ").is_err());
        assert!(contents(&root, &"x".repeat(129)).is_err());
        for i in 0..30 {
            fs::write(root.join(format!("many{i}.md")), "hit\n".repeat(30)).unwrap();
        }
        let many = contents(&root, "hit").unwrap();
        assert_eq!(many.matches.len(), 200);
        assert!(many.incomplete);
    }

    #[test]
    fn folded_matches_map_back_to_the_original_text() {
        let line = "Straße İstanbul ÉCOLE école";
        let found: Vec<_> = find_folded(line, "école")
            .into_iter()
            .map(|(a, b)| &line[a..b])
            .collect();
        assert_eq!(found, ["ÉCOLE", "école"]);
        let long = format!("{}needle{}", "a".repeat(300), "b".repeat(300));
        let text = snippet(&long, 300);
        assert!(text.starts_with('…') && text.ends_with('…') && text.contains("needle"));
    }
}
