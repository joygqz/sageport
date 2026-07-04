//! Window-chrome helpers.
//!
//! macOS traffic lights sit at a fixed position chosen for the system's
//! standard 28pt title bar. Sageport's title bar is taller and scales with
//! the UI zoom, so the buttons are re-centered at runtime. AppKit resets
//! them to their default spot on every window re-layout — each tick of a
//! live resize, fullscreen transitions — and a round-trip through the
//! webview can never win that race: repositioning from JS lands a frame or
//! more late and the buttons visibly jitter during a drag. So the frontend
//! only *declares* the target inset (via the command below, on zoom and
//! theme changes), and the reposition itself runs natively and
//! synchronously inside `NSWindowDidResize` — the same runloop pass as
//! AppKit's own layout, before the frame reaches the screen.
//!
//! Only public AppKit API is used (`standardWindowButton` + frame setters +
//! the notification center — the same technique tao itself uses for its
//! static `trafficLightPosition` window option). The static config option
//! is intentionally NOT set: tao would re-apply it on every `drawRect:`,
//! stomping this dynamic position.

use crate::error::AppResult;

/// Center the macOS traffic lights vertically within a title bar of
/// `height` logical pixels, keeping their left edge at `x`. The first call
/// installs native observers that keep re-applying the inset through
/// window resizes and fullscreen transitions; the frontend re-invokes this
/// only when the target inset itself changes (zoom changes, and theme
/// changes, where AppKit re-creates the buttons without a resize firing).
/// A no-op on other platforms.
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

    /// Live insets per NSWindow (keyed by pointer, so a re-created window
    /// would get fresh observers). Only touched on the main thread, but a
    /// mutex keeps the shared handle trivially sound for the blocks below.
    static REGISTRY: Mutex<Vec<(usize, Arc<Mutex<Inset>>)>> = Mutex::new(Vec::new());

    /// Record the desired inset for this window, install the notification
    /// observers on first sight of it, and apply immediately. Main thread
    /// only (callers arrive via `run_on_main_thread`).
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

    /// Re-apply the inset synchronously whenever AppKit re-lays out the
    /// window chrome. Delivered with `queue: nil`, i.e. inline on the main
    /// thread within the resize handling itself — the buttons never hit the
    /// screen at their default position, which is what an async (webview
    /// round-trip) reposition could not guarantee.
    ///
    /// The observer tokens are never removed: the notification center keeps
    /// the block alive, and the main window lives for the app's lifetime.
    /// (If the window were destroyed, its notifications simply stop, so the
    /// captured pointer is never dereferenced dangling.)
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
                // `apply` sits out fullscreen (system-managed title bar);
                // catch up once the window is back to normal chrome.
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

    /// Grow the title-bar container to `inset.height` (pinned to the top
    /// edge; AppKit coordinates are bottom-up) and center the three buttons
    /// vertically in it, laid out from `inset.x` with their native spacing.
    unsafe fn apply(ns_window: *mut NSWindow, inset: Inset) {
        let Some(window) = (unsafe { ns_window.as_ref() }) else {
            return;
        };
        // In fullscreen the title bar is system-managed (auto-hiding overlay);
        // fighting its layout mid-transition visibly glitches the animation.
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

        // The container (buttons' superview's superview) must actually cover
        // the buttons for them to stay clickable, so grow it to the bar height.
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
