import { lazy, Suspense, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ResizeHandle, Spinner } from "@/components/ui";
import { useSettingSync } from "@/lib/settingSync";
import { IS_MACOS } from "@/lib/platform";
import { Toaster } from "@/components/ui/toaster";
import { GroupFormDialog } from "@/features/hosts/GroupFormDialog";
import { HostFormDialog } from "@/features/hosts/HostFormDialog";
import { bridgeSftpEvents } from "@/features/sftp/store";
import { HostKeyDialog } from "@/features/terminal/HostKeyDialog";
import { useUpdateNotifier } from "@/features/updates/notifier";
import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./CommandPalette";
import { EditorArea } from "./EditorArea";
import { FONT_SYNC_KEY, useFontStore } from "./font";
import { useKeybindings } from "./keybindings";
import {
  auxLimits,
  panelLimits,
  sidebarLimits,
  useLayoutStore,
} from "./layout";
import { useOverlayStore } from "./overlays";
import { SideBar } from "./SideBar";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { syncTrafficLights, useZoomStore, ZOOM_SYNC_KEY } from "./zoom";

const AssistantPanel = lazy(() =>
  import("@/features/ai/AssistantPanel").then((module) => ({
    default: module.AssistantPanel,
  })),
);

const SftpPanel = lazy(() =>
  import("@/features/sftp/SftpPanel").then((module) => ({
    default: module.SftpPanel,
  })),
);

export function Workbench() {
  useKeybindings();
  useUpdateNotifier();

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

  const fontFamily = useFontStore((s) => s.family);
  const pushFont = useSettingSync(FONT_SYNC_KEY, fontFamily, (remote) => {
    useFontStore.getState().setFamily(remote);
  });
  useEffect(() => {
    return useFontStore.subscribe((state, prev) => {
      if (state.family !== prev.family) pushFont(state.family);
    });
  }, [pushFont]);

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
          showLine={false}
          highlightOffset={0.5}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-x border-border">
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
                showLine={false}
                highlightOffset={0.5}
              />
              <Suspense
                fallback={<FeatureLoading height={layout.panelHeight} />}
              >
                <SftpPanel height={layout.panelHeight} />
              </Suspense>
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
              showLine={false}
              highlightOffset={-0.5}
            />
            <Suspense fallback={<FeatureLoading width={layout.auxWidth} />}>
              <AssistantPanel width={layout.auxWidth} />
            </Suspense>
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

function FeatureLoading({
  width,
  height,
}: {
  width?: number;
  height?: number;
}) {
  return (
    <div
      style={{ width, height }}
      className="flex shrink-0 items-center justify-center bg-surface"
    >
      <Spinner />
    </div>
  );
}
