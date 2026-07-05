import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ResizeHandle } from "@/components/ui";
import { useSettingSync } from "@/lib/settingSync";
import { IS_MACOS } from "@/lib/platform";
import { Toaster } from "@/components/ui/toaster";
import { AssistantPanel } from "@/features/ai/AssistantPanel";
import { GroupFormDialog } from "@/features/hosts/GroupFormDialog";
import { HostFormDialog } from "@/features/hosts/HostFormDialog";
import { SftpPanel } from "@/features/sftp/SftpPanel";
import { bridgeSftpEvents } from "@/features/sftp/store";
import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./CommandPalette";
import { EditorArea } from "./EditorArea";
import { useKeybindings } from "./keybindings";
import { auxLimits, panelLimits, sidebarLimits, useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { SideBar } from "./SideBar";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { syncTrafficLights, useZoomStore, ZOOM_SYNC_KEY } from "./zoom";

/**
 * The workbench: a fixed chrome of title bar, activity bar, side bar,
 * editor area, bottom panel, auxiliary bar and status bar, in the layout
 * language of a code editor. Regions are toggled and sized through the
 * layout store; everything inside them is feature code.
 */
export function Workbench() {
  useKeybindings();

  // SFTP events feed the store (and the status bar) even while the panel
  // itself is hidden.
  useEffect(() => {
    bridgeSftpEvents();
  }, []);

  // Panels keep their share of a shrinking window in check (VSCode-style):
  // resizing the window or zooming the UI re-clamps every part so the editor
  // never collapses (layout constraints scale with the zoom factor).
  useEffect(() => {
    const reclamp = () => useLayoutStore.getState().clampToViewport();
    reclamp();
    window.addEventListener("resize", reclamp);
    const unsubZoom = useZoomStore.subscribe(reclamp);
    return () => {
      window.removeEventListener("resize", reclamp);
      unsubZoom();
    };
  }, []);

  // Re-apply the persisted UI zoom level to the document root on launch.
  useEffect(() => {
    useZoomStore.getState().init();
  }, []);

  // Reconciles with a zoom level merged in from another device (on mount,
  // and whenever a sync connect/push/restore invalidates queries), and pushes
  // this device's own zoom changes back out so they ride along with sync.
  const zoomLevel = useZoomStore((s) => s.level);
  const pushZoom = useSettingSync(ZOOM_SYNC_KEY, String(zoomLevel), (remote) => {
    const level = Number(remote);
    if (Number.isFinite(level)) useZoomStore.getState().setLevel(level);
  });
  useEffect(() => {
    return useZoomStore.subscribe((state, prev) => {
      if (state.level !== prev.level) pushZoom(String(state.level));
    });
  }, [pushZoom]);

  // The native side keeps the traffic lights centered through window
  // resizes and fullscreen transitions itself, synchronously inside
  // AppKit's layout pass (see src-tauri/src/commands/window.rs) — an async
  // webview round-trip would always land a frame late and jitter. From
  // here they only need a re-sync when the target inset changes without a
  // resize: zoom changes (handled in zoom.ts) and theme changes, where
  // AppKit re-creates the buttons at their default spot.
  useEffect(() => {
    if (!IS_MACOS) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onThemeChanged(() => syncTrafficLights())
      .then((un) => {
        unlisten = un;
      });
    return () => unlisten?.();
  }, []);

  const layout = useLayoutStore();
  const overlay = useOverlayStore((s) => s.overlay);
  const closeOverlay = useOverlayStore((s) => s.close);

  return (
    <div className="flex h-full flex-col bg-surface text-surface-foreground">
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <ActivityBar />

        {layout.sidebarVisible && <SideBar width={layout.sidebarWidth} />}
        {/* Kept mounted while the side bar is hidden (VSCode-style): the
            sash rests on the activity bar's edge and dragging it from
            width 0 pulls the side bar back open. */}
        <ResizeHandle
          axis="x"
          sashId="sidebar"
          size={layout.sidebarVisible ? layout.sidebarWidth : 0}
          onResize={layout.setSidebarWidth}
          limits={sidebarLimits}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EditorArea />
          {layout.panelVisible && (
            <>
              {/* The corners where this sash meets the side sashes resize
                  both panels in one diagonal drag (VSCode-style); each
                  corner mirrors the linked sash's own props, including the
                  sidebar's drag-open-from-hidden behavior. */}
              <ResizeHandle
                axis="y"
                reverse
                sashId="panel"
                size={layout.panelHeight}
                onResize={layout.setPanelHeight}
                limits={panelLimits}
                startCorner={{
                  targetId: "sidebar",
                  size: layout.sidebarVisible ? layout.sidebarWidth : 0,
                  onResize: layout.setSidebarWidth,
                }}
                endCorner={
                  layout.auxVisible
                    ? {
                        targetId: "aux",
                        size: layout.auxWidth,
                        reverse: true,
                        onResize: layout.setAuxWidth,
                      }
                    : undefined
                }
              />
              <SftpPanel height={layout.panelHeight} />
            </>
          )}
        </div>

        {layout.auxVisible && (
          <>
            <ResizeHandle
              axis="x"
              reverse
              sashId="aux"
              size={layout.auxWidth}
              onResize={layout.setAuxWidth}
              limits={auxLimits}
            />
            <AssistantPanel width={layout.auxWidth} />
          </>
        )}
      </div>

      <StatusBar />

      <HostFormDialog
        open={overlay?.type === "host-form"}
        hostId={overlay?.type === "host-form" ? overlay.hostId : null}
        onClose={closeOverlay}
      />
      <GroupFormDialog
        open={overlay?.type === "group-form"}
        groupId={overlay?.type === "group-form" ? overlay.groupId : null}
        onClose={closeOverlay}
      />
      <CommandPalette
        open={overlay?.type === "palette"}
        initialMode={overlay?.type === "palette" ? overlay.mode : "quick"}
        onClose={closeOverlay}
      />
      <Toaster />
    </div>
  );
}
