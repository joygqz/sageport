//! Window-chrome helpers.
//!
//! macOS traffic lights sit at a fixed position chosen for the system's
//! standard 28pt title bar. Sageport's title bar is taller and scales with
//! the UI zoom, so the frontend re-centers the buttons at runtime whenever
//! the bar's height changes. This uses only public AppKit API
//! (`standardWindowButton` + frame setters — the same technique tao itself
//! uses for the static `trafficLightPosition` window option). The static
//! config option is intentionally NOT set: tao would re-apply it on every
//! `drawRect:`, stomping the dynamic position.

use crate::error::AppResult;

/// Center the macOS traffic lights vertically within a title bar of
/// `height` logical pixels, keeping their left edge at `x`. The frontend
/// re-invokes this on zoom changes, window resizes and theme changes
/// (AppKit re-creates or re-lays-out the buttons on those). A no-op on
/// other platforms.
#[tauri::command]
pub fn window_set_traffic_light_inset(window: tauri::Window, x: f64, height: f64) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let win = window.clone();
        window
            .run_on_main_thread(move || {
                if let Ok(ptr) = win.ns_window() {
                    unsafe { inset_traffic_lights(ptr.cast(), x, height) }
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
unsafe fn inset_traffic_lights(ns_window: *mut objc2_app_kit::NSWindow, x: f64, height: f64) {
    use objc2_app_kit::NSWindowButton;

    let Some(window) = ns_window.as_ref() else {
        return;
    };
    let buttons = [
        window.standardWindowButton(NSWindowButton::CloseButton),
        window.standardWindowButton(NSWindowButton::MiniaturizeButton),
        window.standardWindowButton(NSWindowButton::ZoomButton),
    ];
    let [Some(close), Some(miniaturize), Some(zoom)] = buttons else {
        return;
    };

    // Grow the title-bar container (buttons' superview's superview) to the
    // requested height, pinned to the window's top edge (AppKit coordinates
    // are bottom-up).
    let Some(container) = close.superview().and_then(|v| v.superview()) else {
        return;
    };
    let mut container_rect = container.frame();
    container_rect.size.height = height;
    container_rect.origin.y = window.frame().size.height - height;
    container.setFrame(container_rect);

    // Center each button vertically in the container and lay them out from
    // `x` with their original spacing.
    let spacing = miniaturize.frame().origin.x - close.frame().origin.x;
    for (i, button) in [close, miniaturize, zoom].into_iter().enumerate() {
        let mut rect = button.frame();
        rect.origin.x = x + i as f64 * spacing;
        rect.origin.y = (height - rect.size.height) / 2.0;
        button.setFrameOrigin(rect.origin);
    }
}
