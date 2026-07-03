import { useEffect } from "react";

import { ResizeHandle } from "@/components/ui";
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

  const layout = useLayoutStore();
  const overlay = useOverlayStore((s) => s.overlay);
  const closeOverlay = useOverlayStore((s) => s.close);

  return (
    <div className="flex h-full flex-col bg-surface text-surface-foreground">
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <ActivityBar />

        {layout.sidebarVisible && (
          <>
            <SideBar width={layout.sidebarWidth} />
            <ResizeHandle
              axis="x"
              size={layout.sidebarWidth}
              onResize={layout.setSidebarWidth}
            />
          </>
        )}

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
