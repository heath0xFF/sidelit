use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter,
};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "Quit Sidelit", true, Some("CmdOrCtrl+Q"))?;
    let application = Submenu::with_items(
        app,
        "Sidelit",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Sidelit"), None)?,
            &MenuItem::with_id(app, "updates", "Check for Updates…", true, None::<&str>)?,
            &quit,
        ],
    )?;
    let new = MenuItem::with_id(app, "new", "New File…", true, Some("CmdOrCtrl+N"))?;
    let quick = MenuItem::with_id(app, "quick", "Quick Open…", true, Some("CmdOrCtrl+P"))?;
    let recovery = MenuItem::with_id(app, "session", "Session & Recovery…", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open File…", true, Some("CmdOrCtrl+O"))?;
    let folder = MenuItem::with_id(
        app,
        "folder",
        "Open Folder…",
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "save-as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
    let close = MenuItem::with_id(app, "close", "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new, &open, &folder, &quick, &save, &save_as, &close, &recovery,
        ],
    )?;
    // WebKit's native undo manager does not own the editors' history.
    let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    app.set_menu(Menu::with_items(app, &[&application, &file, &edit])?)?;
    app.on_menu_event(|app, event| {
        let _ = app.emit("menu-action", event.id().as_ref());
    });
    Ok(())
}
