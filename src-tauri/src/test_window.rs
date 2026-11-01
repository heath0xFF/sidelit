// Only in desktop-test builds. Test runs must not take focus or cover the person's work, so the app
// runs as a background process with a transparent window that clicks pass through.
// SIDELIT_TEST_VISIBLE=1 shows a normal window, for watching a test.
use tauri::{Runtime, WebviewWindow};

pub fn background() -> bool {
    std::env::var_os("SIDELIT_TEST_VISIBLE").is_none()
}

#[cfg(target_os = "macos")]
extern "C-unwind" fn always_key(_: *mut objc2::runtime::AnyObject, _: objc2::runtime::Sel) -> bool {
    true
}

// Private switches and a replaced method, fine here because this file never reaches a real build.
pub fn run_unseen<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{class, ffi, msg_send, runtime::AnyObject, sel};
        use objc2_foundation::NSString;
        let _ = window.with_webview(|webview| unsafe {
            let view: *mut AnyObject = webview.inner().cast();
            let host: *mut AnyObject = webview.ns_window().cast();
            let _: () = msg_send![host, setAlphaValue: 0.0_f64];
            let _: () = msg_send![host, setIgnoresMouseEvents: true];
            // NSWindowCollectionBehaviorTransient | IgnoresCycle: out of Mission Control and ⌘`.
            let _: () = msg_send![host, setCollectionBehavior: 8_usize | 64];

            // WebKit stops drawing, and pauses animation frames and timers, for a window it thinks
            // nobody can see.
            let selector = sel!(_setWindowOcclusionDetectionEnabled:);
            let available: bool = msg_send![view, respondsToSelector: selector];
            assert!(available, "WebKit no longer offers occlusion control");
            let _: () = msg_send![view, _setWindowOcclusionDetectionEnabled: false];

            // Editors check document.hasFocus(), and a real key window needs an active app. WebKit's
            // own tests force this the same way, so typing reaches the page and nothing loses focus.
            let imp: unsafe extern "C-unwind" fn() = std::mem::transmute(
                always_key as extern "C-unwind" fn(*mut AnyObject, objc2::runtime::Sel) -> bool,
            );
            let host_class = ffi::object_getClass(host) as *mut objc2::runtime::AnyClass;
            ffi::class_replaceMethod(host_class, sel!(isKeyWindow), imp, c"B@:".as_ptr());
            let _: bool = msg_send![host, makeFirstResponder: view];
            let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
            let name = NSString::from_str("NSWindowDidBecomeKeyNotification");
            let _: () = msg_send![center, postNotificationName: &*name, object: host];

            let _: () = msg_send![host, orderFront: std::ptr::null::<AnyObject>()];
        });
        unsafe {
            let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
            let reason = NSString::from_str("Sidelit desktop test");
            // NSActivityUserInitiatedAllowingIdleSystemSleep, against App Nap; held until exit.
            let activity: *mut AnyObject =
                msg_send![info, beginActivityWithOptions: 0x00EF_FFFF_u64, reason: &*reason];
            let _: *mut AnyObject = msg_send![activity, retain];
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}
