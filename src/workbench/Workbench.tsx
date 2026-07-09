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
import { HostKeyDialog } from "@/features/terminal/HostKeyDialog";
import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./CommandPalette";
import { EditorArea } from "./EditorArea";
import { useKeybindings } from "./keybindings";
import {
  auxLimits,
  panelLimits,
  sidebarLimits,
  useLayoutStore,
} from "./layout";
import { FONT_FAMILY_SYNC_KEY, useFontStore } from "./fonts";
import { useOverlayStore } from "./overlays";
import { SideBar } from "./SideBar";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { syncTrafficLights, useZoomStore, ZOOM_SYNC_KEY } from "./zoom";

export function Workbench() {
  useKeybindings();

  useEffect(() => {
    bridgeSftpEvents();
  }, []);

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

  useEffect(() => {
    useZoomStore.getState().init();
    useFontStore.getState().init();
  }, []);

  const zoomLevel = useZoomStore((s) => s.level);
  const pushZoom = useSettingSync(
    ZOOM_SYNC_KEY,
    String(zoomLevel),
    (remote) => {
      const level = Number(remote);
      if (Number.isFinite(level)) useZoomStore.getState().setLevel(level);
    },
  );
  useEffect(() => {
    return useZoomStore.subscribe((state, prev) => {
      if (state.level !== prev.level) pushZoom(String(state.level));
    });
  }, [pushZoom]);

  const fontFamily = useFontStore((s) => s.fontFamily);
  const pushFontFamily = useSettingSync(
    FONT_FAMILY_SYNC_KEY,
    fontFamily,
    (remote) => useFontStore.getState().setFontFamily(remote),
  );
  useEffect(() => {
    return useFontStore.subscribe((state, prev) => {
      if (state.fontFamily !== prev.fontFamily) pushFontFamily(state.fontFamily);
    });
  }, [pushFontFamily]);

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
      <HostKeyDialog />
      <Toaster />
    </div>
  );
}
