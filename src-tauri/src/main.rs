mod agents;
mod cli;
mod files;
mod integrations;
mod menu;
mod preview;
mod recovery;
mod search;
mod service;
mod updates;

use std::{
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const ACK_FLAG: &str = "--sidelit-handoff";
fn split_ack(mut args: Vec<String>) -> (Vec<String>, Option<PathBuf>) {
    let ack = if args.len() >= 2 && args[args.len() - 2] == ACK_FLAG {
        let path = PathBuf::from(args.pop().unwrap());
        args.pop();
        Some(path)
    } else {
        None
    };
    (args, ack)
}
fn acknowledge(path: Option<&Path>, result: Result<(), String>) {
    if let Some(path) = path {
        // The launcher owns this pre-created file; never create an arbitrary callback path.
        if path.parent() == Some(env::temp_dir().as_path())
            && path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with("sidelit-handoff-")
        {
            if let Ok(mut file) = fs::OpenOptions::new().write(true).truncate(true).open(path) {
                let _ = file.write_all(match &result {
                    Ok(()) => b"OK",
                    Err(e) => e.as_bytes(),
                });
            }
        }
    }
}
fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args == ["--help"] || args == ["-h"] {
        println!("Sidelit — a visual companion for terminal development.\n\nUsage: sidelit [--source] [PATH]\n       sidelit setup [--pi] [--skill] [--dry-run] [--json]\n       sidelit doctor [--project DIR] [--json]\n       sidelit sessions [--project DIR] [--json]\n       sidelit --help\n       sidelit --version\n\nPATH is a Markdown, MDX, or HTML file, or a folder, relative to your current directory.\nRequests reuse the running app. The command returns after handoff.\nSetup installs bundled integrations without a checkout. Existing custom installations are preserved.\nDoctor is read-only; it never sends an agent instruction. JSON schema version: 1.\nExit codes: 0 success, 1 setup conflict or no healthy matching Pi (doctor), 2 invalid request/error.\nUse -- before a path named setup, doctor, or sessions.");
        return;
    }
    if args == ["--version"] {
        println!(
            "Sidelit {} ({})",
            env!("CARGO_PKG_VERSION"),
            env!("SIDELIT_BUILD_ID")
        );
        return;
    }
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    if let Some(code) = integrations::dispatch(&args, &cwd) {
        std::process::exit(code);
    }
    // Launch Services sends file-open events to its child, so only detach terminal launches.
    #[cfg(target_os = "macos")]
    let native_launch = unsafe { libc::getppid() == 1 };
    #[cfg(not(target_os = "macos"))]
    let native_launch = false;
    if env::var_os("SIDELIT_GUI").is_none() && !native_launch {
        if let Err(error) = cli::parse(&args, &cwd) {
            eprintln!("sidelit: {error}");
            std::process::exit(2);
        }
        let mut ack = tempfile::Builder::new()
            .prefix("sidelit-handoff-")
            .tempfile()
            .expect("create handoff receipt");
        // Start the real bundle even when the CLI was reached through a PATH symlink.
        let child = env::current_exe()
            .and_then(fs::canonicalize)
            .and_then(|executable| {
                Command::new(executable)
                    .args(&args)
                    .arg(ACK_FLAG)
                    .arg(ack.path())
                    .env("SIDELIT_GUI", "1")
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
            });
        if let Err(error) = child {
            eprintln!("sidelit: {error}");
            std::process::exit(1);
        }
        let start = Instant::now();
        loop {
            let mut receipt = String::new();
            let _ = ack.read_to_string(&mut receipt);
            if receipt == "OK" {
                return;
            }
            if !receipt.is_empty() {
                eprintln!("sidelit: {receipt}");
                std::process::exit(1);
            }
            if start.elapsed() > Duration::from_secs(15) {
                eprintln!("sidelit: application did not acknowledge the request within 15 seconds");
                std::process::exit(1);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    let (args, ack) = split_ack(args);
    let request = match cli::parse(&args, &cwd) {
        Ok(r) => r,
        Err(e) => {
            acknowledge(ack.as_deref(), Err(e));
            return;
        }
    };
    // Relaunch without the original file path or its now-expired CLI handoff receipt.
    let mut restart_env = tauri::Env::default();
    restart_env.args_os.truncate(1);
    let builder = tauri::Builder::default()
        .manage(restart_env)
        .manage(updates::Updates::default())
        .manage(service::Service::default())
        .manage(recovery::Recovery::default())
        .manage(preview::Previews::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let (args, ack) = split_ack(args.into_iter().skip(1).collect());
            let result = cli::parse(&args, Path::new(&cwd)).map(|r| {
                if let Some(r) = r {
                    service::enqueue(app, r);
                }
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            });
            acknowledge(ack.as_deref(), result);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("sidelit-preview", |context, request| {
            preview::response(context.app_handle(), request)
        })
        .invoke_handler(tauri::generate_handler![
            service::ready,
            service::choose,
            service::open_document,
            service::read_document,
            service::save_document,
            service::close_document,
            service::set_workspace,
            service::list_directory,
            service::collapse_directory,
            service::save_copy,
            service::image_data,
            service::open_link,
            service::preview_asset,
            preview::publish_preview,
            preview::release_preview,
            service::search_documents,
            agents::agent_targets,
            agents::send_feedback,
            agents::feedback_status,
            agents::focus_agent,
            service::recovery_status,
            service::set_recovery,
            service::save_session,
            service::restore_session,
            service::quit,
            updates::check_update,
            updates::install_update
        ])
        .setup(move |app| {
            if let Ok(instance) = integrations::register_instance() {
                app.manage(instance);
            }
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(|url| {
                    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"));
                    let dev = cfg!(debug_assertions)
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(1420);
                    ((local || dev) && matches!(url.path(), "" | "/" | "/index.html"))
                        || (url.scheme() == "sidelit-preview"
                            && url.host_str() == Some("localhost"))
                        || preview::local_server(url)
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            menu::install(app.handle())?;
            if let Some(request) = request {
                service::enqueue(app.handle(), request);
            }
            acknowledge(ack.as_deref(), Ok(()));
            Ok(())
        });
    #[cfg(feature = "desktop-test")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    let app = builder
        .build(tauri::generate_context!())
        .expect("build Sidelit");
    app.run(|app, event| match event {
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            api.prevent_close();
            let _ = app.emit("request-quit", ());
        }
        tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            api.prevent_exit();
            let _ = app.emit("request-quit", ());
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    match cli::parse(&[path.to_string_lossy().into()], Path::new("/")) {
                        Ok(Some(r)) => service::enqueue(app, r),
                        Err(e) => {
                            let _ = app.emit("service-error", e);
                        }
                        _ => {}
                    }
                }
            }
        }
        _ => {}
    });
}
