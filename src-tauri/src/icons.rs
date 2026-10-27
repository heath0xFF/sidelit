use tauri::{Theme, WebviewWindow};

#[cfg(target_os = "macos")]
fn icon_bytes(theme: Theme) -> &'static [u8] {
    match theme {
        Theme::Dark => include_bytes!("../icons/dark/icon.icns"),
        _ => include_bytes!("../icons/icon.icns"),
    }
}

pub fn sync(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let theme = window.theme()?;
    #[cfg(target_os = "macos")]
    {
        use objc2::{AllocAnyThread, MainThreadMarker};
        use objc2_app_kit::{NSApplication, NSImage};
        use objc2_foundation::NSData;

        let main_thread =
            MainThreadMarker::new().ok_or("app icon update requires the main thread")?;
        let data = NSData::with_bytes(icon_bytes(theme));
        let image = NSImage::initWithData(NSImage::alloc(), &data).ok_or("invalid app icon")?;
        // Window icons are a no-op on macOS; update the Dock without changing the signed bundle.
        unsafe {
            NSApplication::sharedApplication(main_thread).setApplicationIconImage(Some(&image));
        }
    }
    #[cfg(not(target_os = "macos"))]
    window.set_icon(match theme {
        Theme::Dark => tauri::include_image!("icons/dark/128x128@2x.png"),
        _ => tauri::include_image!("icons/128x128@2x.png"),
    })?;
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use objc2::AllocAnyThread;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSData;

    #[test]
    fn appearance_selects_valid_icons_in_both_directions() {
        assert_ne!(icon_bytes(Theme::Light), icon_bytes(Theme::Dark));
        for (theme, expected) in [
            (
                Theme::Light,
                include_bytes!("../icons/icon.icns").as_slice(),
            ),
            (
                Theme::Dark,
                include_bytes!("../icons/dark/icon.icns").as_slice(),
            ),
            (
                Theme::Light,
                include_bytes!("../icons/icon.icns").as_slice(),
            ),
        ] {
            let bytes = icon_bytes(theme);
            assert_eq!(bytes, expected);
            let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes))
                .expect("the supplied ICNS must load in AppKit");
            assert!(image.isValid());
        }
    }
}
