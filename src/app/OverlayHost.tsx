import { GroupFormDialog } from "@/overlays/GroupFormDialog";
import { HostFormDialog } from "@/overlays/HostFormDialog";
import { SettingsDialog } from "@/overlays/SettingsDialog";
import { useOverlayStore } from "./overlay-store";

/** Mounts every app-level dialog once, driven entirely by `useOverlayStore`. */
export function OverlayHost() {
  const overlay = useOverlayStore((s) => s.overlay);
  const close = useOverlayStore((s) => s.close);

  return (
    <>
      <SettingsDialog
        open={overlay?.type === "settings"}
        section={overlay?.type === "settings" ? overlay.section : "appearance"}
        onClose={close}
      />
      <HostFormDialog
        open={overlay?.type === "host-form"}
        hostId={overlay?.type === "host-form" ? overlay.hostId : null}
        onClose={close}
      />
      <GroupFormDialog
        open={overlay?.type === "group-form"}
        groupId={overlay?.type === "group-form" ? overlay.groupId : null}
        onClose={close}
      />
    </>
  );
}
