use crate::error::AppResult;

#[cfg(target_os = "macos")]
const DEFAULT_INSET_X: f64 = 13.0;
#[cfg(target_os = "macos")]
const DEFAULT_INSET_HEIGHT: f64 = 33.75;

pub fn preset_traffic_light_inset(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(ptr) = window.ns_window() {
        macos::set_inset(ptr.cast(), DEFAULT_INSET_X, DEFAULT_INSET_HEIGHT);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[tauri::command]
pub fn window_set_traffic_light_inset(window: tauri::Window, x: f64, height: f64) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let win = window.clone();
        window
            .run_on_main_thread(move || {
                if let Ok(ptr) = win.ns_window() {
                    macos::set_inset(ptr.cast(), x, height);
                }
            })
            .map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, x, height);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr::NonNull;
    use std::sync::Arc;

    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSWindow, NSWindowButton, NSWindowDidEndLiveResizeNotification,
        NSWindowDidExitFullScreenNotification, NSWindowDidResizeNotification, NSWindowStyleMask,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    use parking_lot::Mutex;

    #[derive(Clone, Copy)]
    struct Inset {
        x: f64,
        height: f64,
    }

    static REGISTRY: Mutex<Vec<(usize, Arc<Mutex<Inset>>)>> = Mutex::new(Vec::new());

    pub fn set_inset(ns_window: *mut NSWindow, x: f64, height: f64) {
        let inset = Inset { x, height };
        let key = ns_window as usize;
        let mut registry = REGISTRY.lock();
        if let Some((_, shared)) = registry.iter().find(|(k, _)| *k == key) {
            *shared.lock() = inset;
        } else {
            let shared = Arc::new(Mutex::new(inset));
            registry.push((key, shared.clone()));
            unsafe { observe(ns_window, shared) };
        }
        drop(registry);
        unsafe { apply(ns_window, inset) };
    }

    unsafe fn observe(ns_window: *mut NSWindow, shared: Arc<Mutex<Inset>>) {
        let window_key = ns_window as usize;
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            let inset = *shared.lock();
            unsafe { apply(window_key as *mut NSWindow, inset) };
        });
        let center = NSNotificationCenter::defaultCenter();
        let object = unsafe { &*ns_window.cast::<AnyObject>() };
        let names = unsafe {
            [
                NSWindowDidResizeNotification,
                NSWindowDidEndLiveResizeNotification,
                NSWindowDidExitFullScreenNotification,
            ]
        };
        for name in names {
            let _token = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(name),
                    Some(object),
                    None,
                    &block,
                )
            };
        }
    }

    unsafe fn apply(ns_window: *mut NSWindow, inset: Inset) {
        let Some(window) = (unsafe { ns_window.as_ref() }) else {
            return;
        };

        if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return;
        }

        let buttons = [
            window.standardWindowButton(NSWindowButton::CloseButton),
            window.standardWindowButton(NSWindowButton::MiniaturizeButton),
            window.standardWindowButton(NSWindowButton::ZoomButton),
        ];
        let [Some(close), Some(miniaturize), Some(zoom)] = buttons else {
            return;
        };

        let Some(container) = close.superview().and_then(|v| v.superview()) else {
            return;
        };
        let mut container_rect = container.frame();
        container_rect.size.height = inset.height;
        container_rect.origin.y = window.frame().size.height - inset.height;
        container.setFrame(container_rect);

        let spacing = miniaturize.frame().origin.x - close.frame().origin.x;
        for (i, button) in [close, miniaturize, zoom].into_iter().enumerate() {
            let mut rect = button.frame();
            rect.origin.x = inset.x + i as f64 * spacing;
            rect.origin.y = (inset.height - rect.size.height) / 2.0;
            button.setFrameOrigin(rect.origin);
        }
    }
}
