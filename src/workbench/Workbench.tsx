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
import { useLayoutStore } from "./layout";
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

  // AppKit resets the traffic lights to their default position whenever the
  // window re-lays out its chrome (resize, fullscreen transitions, theme
  // change) — push them back to the title bar's center each time.
  useEffect(() => {
    if (!IS_MACOS) return;
    const appWindow = getCurrentWindow();
    const unlisteners: Array<() => void> = [];
    void appWindow.onResized(() => syncTrafficLights()).then((un) => {
      unlisteners.push(un);
    });
    void appWindow.onThemeChanged(() => syncTrafficLights()).then((un) => {
      unlisteners.push(un);
    });
    return () => unlisteners.forEach((un) => un());
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
          size={layout.sidebarVisible ? layout.sidebarWidth : 0}
          onResize={layout.setSidebarWidth}
        />


        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EditorArea />
          {layout.panelVisible && (
            <>
              <ResizeHandle
                axis="y"
                reverse
                size={layout.panelHeight}
                onResize={layout.setPanelHeight}
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
              size={layout.auxWidth}
              onResize={layout.setAuxWidth}
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
