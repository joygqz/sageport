import { lazy, Suspense, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ResizeHandle } from "@/components/ui/resize-handle";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorMessage, toast, useToastStore } from "@/lib/toast";
import { useSettingSync } from "@/lib/settingSync";
import { IS_MACOS } from "@/lib/platform";
import { bridgeSftpEvents } from "@/features/sftp/store";
import {
  listenHostKeyEvents,
  useHostKeyStore,
} from "@/features/terminal/host-key";
import {
  listenPasswordPrompts,
  usePasswordPromptStore,
} from "@/features/terminal/password-prompt";
import { ActivityBar } from "./ActivityBar";
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
import { isFileDirty, useTabsStore } from "./tabs";
import { installWindowListener } from "./window-listener";

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

const SettingsDialog = lazy(() =>
  import("@/features/settings/SettingsPage").then((module) => ({
    default: module.SettingsDialog,
  })),
);

const CommandPalette = lazy(() =>
  import("./CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);

const HostFormDialog = lazy(() =>
  import("@/features/hosts/HostFormDialog").then((module) => ({
    default: module.HostFormDialog,
  })),
);

const GroupFormDialog = lazy(() =>
  import("@/features/hosts/GroupFormDialog").then((module) => ({
    default: module.GroupFormDialog,
  })),
);

const HostKeyDialog = lazy(() =>
  import("@/features/terminal/HostKeyDialog").then((module) => ({
    default: module.HostKeyDialog,
  })),
);

const PasswordPromptDialog = lazy(() =>
  import("@/features/terminal/PasswordPromptDialog").then((module) => ({
    default: module.PasswordPromptDialog,
  })),
);

const Toaster = lazy(() =>
  import("@/components/ui/toaster").then((module) => ({
    default: module.Toaster,
  })),
);

const UpdateNotifier = lazy(() =>
  import("@/features/updates/notifier").then((module) => ({
    default: module.UpdateNotifier,
  })),
);

export function Workbench() {
  const { t } = useI18n();
  useKeybindings();

  useEffect(() => {
    void bridgeSftpEvents().catch((error) =>
      toast.error(t("sftp.listenerError"), errorMessage(error)),
    );
  }, [t]);

  useEffect(
    () =>
      installWindowListener(listenHostKeyEvents, (error) =>
        toast.error(t("windowControls.listenerError"), errorMessage(error)),
      ),
    [t],
  );

  useEffect(
    () =>
      installWindowListener(listenPasswordPrompts, (error) =>
        toast.error(t("windowControls.listenerError"), errorMessage(error)),
      ),
    [t],
  );

  useEffect(() => {
    const unlisten = installWindowListener(
      () =>
        getCurrentWindow().onCloseRequested((event) => {
          if (useTabsStore.getState().requestWindowClose()) {
            event.preventDefault();
          }
        }),
      (error) =>
        toast.error(t("windowControls.listenerError"), errorMessage(error)),
    );

    const beforeUnload = (event: BeforeUnloadEvent) => {
      const tabs = useTabsStore.getState();
      if (tabs.pendingWindowClose) return;
      if (tabs.tabs.some((tab) => tab.kind === "file" && isFileDirty(tab))) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unlisten();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [t]);

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
    {
      onLoadError: (error) =>
        toast.error(t("settings.persistence.loadError"), errorMessage(error)),
      onSaveError: (error) =>
        toast.error(t("settings.persistence.saveError"), errorMessage(error)),
    },
  );
  useEffect(() => {
    return useZoomStore.subscribe((state, prev) => {
      if (state.level !== prev.level) pushZoom(String(state.level));
    });
  }, [pushZoom]);

  const fontFamily = useFontStore((s) => s.family);
  const pushFont = useSettingSync(
    FONT_SYNC_KEY,
    fontFamily,
    (remote) => {
      useFontStore.getState().setFamily(remote);
    },
    {
      onLoadError: (error) =>
        toast.error(t("settings.persistence.loadError"), errorMessage(error)),
      onSaveError: (error) =>
        toast.error(t("settings.persistence.saveError"), errorMessage(error)),
    },
  );
  useEffect(() => {
    return useFontStore.subscribe((state, prev) => {
      if (state.family !== prev.family) pushFont(state.family);
    });
  }, [pushFont]);

  useEffect(() => {
    if (!IS_MACOS) return;
    return installWindowListener(
      () => getCurrentWindow().onThemeChanged(() => syncTrafficLights()),
      (error) =>
        toast.error(t("windowControls.listenerError"), errorMessage(error)),
    );
  }, [t]);

  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const panelVisible = useLayoutStore((s) => s.panelVisible);
  const panelHeight = useLayoutStore((s) => s.panelHeight);
  const setPanelHeight = useLayoutStore((s) => s.setPanelHeight);
  const auxVisible = useLayoutStore((s) => s.auxVisible);
  const auxWidth = useLayoutStore((s) => s.auxWidth);
  const setAuxWidth = useLayoutStore((s) => s.setAuxWidth);
  const overlay = useOverlayStore((s) => s.overlay);
  const closeOverlay = useOverlayStore((s) => s.close);
  const setSettingsSection = useOverlayStore((s) => s.setSettingsSection);
  const hasHostKeyPrompt = useHostKeyStore((s) => s.queue.length > 0);
  const hasPasswordPrompt = usePasswordPromptStore((s) => s.queue.length > 0);

  return (
    <div className="flex h-full flex-col bg-surface text-surface-foreground">
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <ActivityBar />

        {sidebarVisible && <SideBar width={sidebarWidth} />}
        <ResizeHandle
          axis="x"
          sashId="sidebar"
          size={sidebarVisible ? sidebarWidth : 0}
          onResize={setSidebarWidth}
          limits={sidebarLimits}
          showLine={false}
          highlightOffset={0.5}
        />

        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col border-border",
            sidebarVisible && "border-l",
            auxVisible && "border-r",
          )}
        >
          <EditorArea />
          {panelVisible && (
            <>
              <ResizeHandle
                axis="y"
                reverse
                sashId="panel"
                size={panelHeight}
                onResize={setPanelHeight}
                limits={panelLimits}
                startCorner={{
                  targetId: "sidebar",
                  size: sidebarVisible ? sidebarWidth : 0,
                  onResize: setSidebarWidth,
                }}
                endCorner={
                  auxVisible
                    ? {
                        targetId: "aux",
                        size: auxWidth,
                        reverse: true,
                        onResize: setAuxWidth,
                      }
                    : undefined
                }
                showLine={false}
                highlightOffset={0.5}
              />
              <Suspense fallback={<FeatureLoading height={panelHeight} />}>
                <SftpPanel height={panelHeight} />
              </Suspense>
            </>
          )}
        </div>

        {auxVisible && (
          <>
            <ResizeHandle
              axis="x"
              reverse
              sashId="aux"
              size={auxWidth}
              onResize={setAuxWidth}
              limits={auxLimits}
              showLine={false}
              highlightOffset={-0.5}
            />
            <Suspense fallback={<FeatureLoading width={auxWidth} />}>
              <AssistantPanel width={auxWidth} />
            </Suspense>
          </>
        )}
      </div>

      <StatusBar />

      {overlay?.type === "host-form" && (
        <Suspense fallback={null}>
          <HostFormDialog open hostId={overlay.hostId} onClose={closeOverlay} />
        </Suspense>
      )}
      {overlay?.type === "group-form" && (
        <Suspense fallback={null}>
          <GroupFormDialog
            open
            groupId={overlay.groupId}
            onClose={closeOverlay}
          />
        </Suspense>
      )}
      {overlay?.type === "palette" && (
        <Suspense fallback={null}>
          <CommandPalette
            open
            initialMode={overlay.mode}
            onClose={closeOverlay}
          />
        </Suspense>
      )}
      {overlay?.type === "settings" && (
        <Suspense fallback={null}>
          <SettingsDialog
            open
            section={overlay.section}
            onSectionChange={setSettingsSection}
            onClose={closeOverlay}
          />
        </Suspense>
      )}
      {hasHostKeyPrompt && (
        <Suspense fallback={null}>
          <HostKeyDialog />
        </Suspense>
      )}
      {hasPasswordPrompt && (
        <Suspense fallback={null}>
          <PasswordPromptDialog />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <UpdateNotifier />
      </Suspense>
      <LazyToaster />
    </div>
  );
}

function LazyToaster() {
  const hasToasts = useToastStore((state) => state.toasts.length > 0);
  if (!hasToasts) return null;
  return (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
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
