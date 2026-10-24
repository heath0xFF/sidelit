use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

type Result<T> = std::result::Result<T, String>;
const PI: &[(&str, &str)] = &[
    (
        "index.ts",
        include_str!("../../extensions/pi-sidelit/index.ts"),
    ),
    (
        "protocol.ts",
        include_str!("../../extensions/pi-sidelit/protocol.ts"),
    ),
    (
        "README.md",
        include_str!("../../extensions/pi-sidelit/README.md"),
    ),
];
const SKILL: &[(&str, &str)] = &[("SKILL.md", include_str!("../../skills/sidelit/SKILL.md"))];
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn home() -> Result<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("HOME is unavailable".into())
}
fn base(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support/Sidelit")
    } else {
        home.join(".local/share/sidelit")
    }
}
fn pi_directory(home: &Path) -> PathBuf {
    env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".pi/agent"))
}
fn private_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, MetadataExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .map_err(|e| e.to_string())?;
        let m = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
            return Err(format!(
                "Expected a private, owned directory: {}",
                path.display()
            ));
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err("Integration setup currently requires macOS or Linux".into())
    }
}
fn same_files(path: &Path, files: &[(&str, &str)]) -> bool {
    files.iter().all(|(name, content)| {
        fs::symlink_metadata(path.join(name)).is_ok_and(|m| m.is_file())
            && crate::files::read_bytes(&path.join(name), 256 * 1024)
                .is_ok_and(|b| b == content.as_bytes())
    })
}
fn unmodified_package(path: &Path) -> bool {
    if !fs::symlink_metadata(path).is_ok_and(|m| m.is_dir()) {
        return false;
    }
    let Ok(bytes) = crate::files::read_bytes(&path.join(".sidelit.json"), 16000) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_slice::<Value>(&bytes) else {
        return false;
    };
    let Some(files) = manifest
        .as_object()
        .filter(|m| !m.is_empty() && m.len() <= 32)
    else {
        return false;
    };
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    if entries.into_iter().any(|entry| {
        !entry.is_ok_and(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name == ".sidelit.json" || files.contains_key(name))
        })
    }) {
        return false;
    }
    files.iter().all(|(name, hash)| {
        Path::new(name).components().count() == 1
            && !name.starts_with('.')
            && fs::symlink_metadata(path.join(name)).is_ok_and(|m| m.is_file())
            && crate::files::read_bytes(&path.join(name), 256 * 1024)
                .is_ok_and(|b| hash.as_str() == Some(digest(&b).as_str()))
    })
}

fn install(
    home: &Path,
    destination: &Path,
    name: &str,
    files: &[(&str, &str)],
    dry: bool,
) -> Result<Value> {
    let version = digest(
        files
            .iter()
            .flat_map(|(name, content)| name.bytes().chain(content.bytes()))
            .collect::<Vec<_>>()
            .as_slice(),
    );
    let packages = base(home).join("integrations");
    let package = packages.join(format!("{name}-{}", &version[..16]));
    if same_files(destination, files) {
        return Ok(json!({"component":name,"status":"current","path":destination}));
    }
    let existing = fs::symlink_metadata(destination).ok();
    let previous = fs::read_link(destination).ok();
    if existing.is_some() {
        let managed = previous
            .as_ref()
            .is_some_and(|p| p.parent() == Some(packages.as_path()) && unmodified_package(p));
        if !managed {
            return Ok(
                json!({"component":name,"status":"conflict","path":destination,"error":"Existing custom or modified installation was preserved. Move it aside deliberately before installing."}),
            );
        }
    }
    if dry {
        return Ok(
            json!({"component":name,"status":"planned","path":destination,"resource":package}),
        );
    }
    private_directory(&packages)?;
    if package.exists() {
        if !same_files(&package, files) {
            return Err(format!(
                "Bundled installation was modified: {}",
                package.display()
            ));
        }
    } else {
        let staging = tempfile::Builder::new()
            .prefix("install-")
            .tempdir_in(&packages)
            .map_err(|e| e.to_string())?;
        let mut manifest = serde_json::Map::new();
        for (file, content) in files {
            let mut output =
                fs::File::create(staging.path().join(file)).map_err(|e| e.to_string())?;
            output
                .write_all(content.as_bytes())
                .and_then(|_| output.sync_all())
                .map_err(|e| e.to_string())?;
            manifest.insert(file.to_string(), json!(digest(content.as_bytes())));
        }
        fs::write(
            staging.path().join(".sidelit.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .map_err(|e| e.to_string())?;
        fs::rename(staging.path(), &package).map_err(|e| e.to_string())?;
    }
    let parent = destination
        .parent()
        .ok_or("Invalid installation destination")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        if existing.is_none() {
            std::os::unix::fs::symlink(&package, destination)
                .map_err(|e| format!("Could not install {}: {e}", destination.display()))?;
        } else {
            let staging = tempfile::Builder::new()
                .prefix(".sidelit-link-")
                .tempdir_in(parent)
                .map_err(|e| e.to_string())?;
            let link = staging.path().join("link");
            std::os::unix::fs::symlink(&package, &link).map_err(|e| e.to_string())?;
            if fs::read_link(destination).ok() != previous {
                return Err("Installation changed during setup; retry after reviewing it".into());
            }
            fs::rename(link, destination).map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(unix))]
    return Err("Integration setup requires macOS or Linux".into());
    Ok(json!({"component":name,"status":"installed","path":destination,"resource":package}))
}

pub fn build_info() -> Value {
    json!({"version":env!("CARGO_PKG_VERSION"),"buildId":env!("SIDELIT_BUILD_ID"),"desktopTest":cfg!(feature="desktop-test"),"executable":env::current_exe().ok()})
}
pub struct Instance(PathBuf);
impl Drop for Instance {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
pub fn register_instance() -> Result<Instance> {
    let directory = base(&home()?).join("instances");
    private_directory(&directory)?;
    let path = directory.join(format!("{}.json", std::process::id()));
    let mut file = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
    let mut info = build_info();
    info["pid"] = json!(std::process::id());
    file.write_all(serde_json::to_string(&info).unwrap().as_bytes())
        .map_err(|e| e.to_string())?;
    file.persist(&path).map_err(|e| e.to_string())?;
    Ok(Instance(path))
}
fn running_apps(home: &Path) -> Vec<Value> {
    let records: Vec<Value> = fs::read_dir(base(home).join("instances"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| crate::files::read_bytes(&entry.path(), 16000).ok())
        .filter_map(|bytes| serde_json::from_slice(&bytes).ok())
        .collect();
    let Ok(output) = Command::new("ps").args(["-axo", "pid=,comm="]).output() else {
        return vec![];
    };
    String::from_utf8_lossy(&output.stdout).lines().filter_map(|line| {
        let (pid, exe) = line.trim().split_once(char::is_whitespace)?;
        let pid: u32 = pid.parse().ok()?; let exe = exe.trim();
        if pid == std::process::id() || Path::new(exe).file_name()?.to_str()? != "sidelit" { return None; }
        Some(records.iter().find(|v| v["pid"] == pid && v["executable"] == exe).cloned().unwrap_or_else(|| json!({"pid":pid,"executable":exe,"buildId":null,"status":"unreported; quit and reopen to use this build"})))
    }).collect()
}

pub fn dispatch(args: &[String], cwd: &Path) -> Option<i32> {
    if !args
        .first()
        .is_some_and(|a| matches!(a.as_str(), "setup" | "doctor" | "sessions"))
    {
        return None;
    }
    let json_output = args.iter().any(|a| a == "--json");
    let result = run(args, cwd);
    match result {
        Ok((value, code)) => {
            if json_output {
                println!("{}", serde_json::to_string_pretty(&value).unwrap());
            } else {
                println!("Sidelit {} · {}", args[0], env!("SIDELIT_BUILD_ID"));
                if let Some(items) = value["results"].as_array() {
                    for item in items {
                        println!(
                            "{}: {} — {}",
                            item["component"].as_str().unwrap_or(""),
                            item["status"].as_str().unwrap_or(""),
                            item["path"].as_str().unwrap_or("")
                        );
                        if let Some(error) = item["error"].as_str() {
                            println!("  {error}");
                        }
                    }
                }
                if let Some(items) = value["sessions"].as_array() {
                    for item in items {
                        println!(
                            "{} · {} · {}",
                            item["label"].as_str().unwrap_or("Pi"),
                            item["projectRoot"].as_str().unwrap_or(""),
                            item["health"]["status"].as_str().unwrap_or("setup needed")
                        );
                    }
                }
                if let Some(items) = value["nextSteps"].as_array() {
                    for item in items {
                        println!("{}", item.as_str().unwrap_or(""));
                    }
                }
                if args[0] == "doctor" {
                    println!("Use --json for executable, running builds, installation paths and protocol details.");
                }
            }
            Some(code)
        }
        Err(error) => {
            if json_output {
                println!("{}", json!({"schemaVersion":1,"error":error}));
            } else {
                eprintln!("sidelit: {error}");
            }
            Some(2)
        }
    }
}
fn run(args: &[String], cwd: &Path) -> Result<(Value, i32)> {
    let command = args[0].as_str();
    let mut pi = false;
    let mut skill = false;
    let mut dry = false;
    let mut project = cwd.to_path_buf();
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => {}
            "--pi" if command == "setup" => pi = true,
            "--skill" if command == "setup" => skill = true,
            "--dry-run" if command == "setup" => dry = true,
            "--project" if command != "setup" => {
                index += 1;
                project = cwd.join(args.get(index).ok_or("--project needs a directory")?);
            }
            arg => {
                return Err(format!(
                    "Unknown {command} option: {arg}. Use sidelit --help."
                ))
            }
        }
        index += 1;
    }
    let home = home()?;
    let pi_path = pi_directory(&home).join("extensions/sidelit");
    let skill_path = home.join(".agents/skills/sidelit");
    if command == "setup" {
        if !pi && !skill {
            pi = true;
            skill = true;
        }
        let mut results = vec![];
        if pi {
            results.push(install(&home, &pi_path, "pi", PI, dry)?);
        }
        if skill {
            results.push(install(&home, &skill_path, "skill", SKILL, dry)?);
        }
        let code = if results.iter().any(|r| r["status"] == "conflict") {
            1
        } else {
            0
        };
        return Ok((
            json!({"schemaVersion":1,"build":build_info(),"dryRun":dry,"results":results,"nextSteps":["In the intended existing Pi session run /reload, then /sidelit-status. Setup never types into a terminal.","Run sidelit doctor --project /absolute/project/path to verify a live bridge. No Rex plugin is required."]}),
            code,
        ));
    }
    project = fs::canonicalize(&project).map_err(|e| format!("Could not open project: {e}"))?;
    if !project.is_dir() {
        return Err("--project must name a directory".into());
    }
    let sessions: Vec<Value> =
        crate::agents::discover_targets(Some(project.to_string_lossy().into_owned()))
            .into_iter()
            .map(|target| {
                let health = if target.connected {
                    crate::agents::bridge_health(&target.id)
                        .unwrap_or_else(|error| json!({"status":"unavailable","error":error}))
                } else {
                    json!({"status":"extension_not_loaded"})
                };
                let mut value = serde_json::to_value(target).unwrap();
                value["health"] = health;
                value
            })
            .collect();
    let ready = sessions.iter().any(|v| v["health"]["status"] == "ready");
    let rex_available = crate::agents::rex_available();
    let pi_installed = pi_path.join("index.ts").is_file();
    let steps = if ready {
        vec!["Select the intended Pi session in Sidelit. The health check did not send an agent instruction."]
    } else if pi_installed {
        vec!["The Pi extension is installed, but no healthy session matched this project. In the intended Pi session run /reload and /sidelit-status, then retry."]
    } else {
        vec!["Run sidelit setup --pi --skill, then /reload and /sidelit-status in the intended existing Pi session."]
    };
    Ok((
        json!({"schemaVersion":1,"build":build_info(),"projectRoot":project,"runningApps":running_apps(&home),"rex":{"available":rex_available,"pluginRequired":false},"integrations":{"pi":{"installed":pi_installed,"current":same_files(&pi_path,PI),"path":pi_path},"skill":{"installed":skill_path.join("SKILL.md").is_file(),"current":same_files(&skill_path,SKILL),"path":skill_path}},"sessions":sessions,"nextSteps":steps}),
        if command == "doctor" && !ready { 1 } else { 0 },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn setup_is_idempotent_dry_and_preserves_custom_content() {
        let home = tempfile::tempdir().unwrap();
        let dest = home.path().join("extensions/sidelit");
        let files = &[("index.ts", "first")];
        assert_eq!(
            install(home.path(), &dest, "pi", files, true).unwrap()["status"],
            "planned"
        );
        assert!(!dest.exists());
        assert_eq!(
            install(home.path(), &dest, "pi", files, false).unwrap()["status"],
            "installed"
        );
        assert_eq!(
            install(home.path(), &dest, "pi", files, false).unwrap()["status"],
            "current"
        );
        assert_eq!(
            install(home.path(), &dest, "pi", &[("index.ts", "second")], false).unwrap()["status"],
            "installed"
        );
        fs::write(dest.join("index.ts"), "custom").unwrap();
        assert_eq!(
            install(home.path(), &dest, "pi", files, false).unwrap()["status"],
            "conflict"
        );
        assert_eq!(fs::read_to_string(dest.join("index.ts")).unwrap(), "custom");
    }
    #[test]
    fn existing_directory_and_broken_link_are_not_overwritten() {
        let home = tempfile::tempdir().unwrap();
        let dest = home.path().join("existing");
        fs::create_dir(&dest).unwrap();
        assert_eq!(
            install(home.path(), &dest, "pi", PI, false).unwrap()["status"],
            "conflict"
        );
        #[cfg(unix)]
        {
            let link = home.path().join("broken");
            std::os::unix::fs::symlink("missing", &link).unwrap();
            assert_eq!(
                install(home.path(), &link, "pi", PI, false).unwrap()["status"],
                "conflict"
            );
        }
    }
    #[test]
    fn setup_preserves_extra_files_in_managed_installations() {
        let home = tempfile::tempdir().unwrap();
        let dest = home.path().join("extensions/sidelit");
        install(home.path(), &dest, "pi", &[("index.ts", "first")], false).unwrap();
        fs::create_dir(dest.join("custom")).unwrap();
        fs::write(dest.join("custom/config.json"), "{}").unwrap();
        assert_eq!(
            install(home.path(), &dest, "pi", &[("index.ts", "second")], false).unwrap()["status"],
            "conflict"
        );
        assert_eq!(fs::read_to_string(dest.join("index.ts")).unwrap(), "first");
        assert!(dest.join("custom/config.json").is_file());
    }
}
