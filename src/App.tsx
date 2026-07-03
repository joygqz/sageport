import { useCallback, useEffect, useState } from "react";

import { TitleBar } from "@/components/layout/TitleBar";
import { Toaster } from "@/components/ui/toaster";
import type { Host } from "@/types/models";
import { AiPanel } from "@/features/ai/AiPanel";
import { HostSidebar } from "@/features/hosts/HostSidebar";
import { SftpPanel } from "@/features/sftp/SftpPanel";
import { useSftpStore } from "@/features/sftp/store";
import { useSessionStore } from "@/features/terminal/sessionStore";
import { Workspace } from "@/features/terminal/Workspace";
import { OverlayHost } from "@/app/OverlayHost";
import { useOverlayStore } from "@/app/overlay-store";

export default function App() {
  const openSession = useSessionStore((s) => s.open);
  const [aiOpen, setAiOpen] = useState(false);
  const sftpVisible = useSftpStore((s) => s.visible);
  const toggleSftp = useSftpStore((s) => s.toggle);
  const openSettings = useOverlayStore((s) => s.openSettings);
  const openHostForm = useOverlayStore((s) => s.openHostForm);

  const connect = useCallback(
    (host: Host) => {
      openSession(host);
    },
    [openSession],
  );

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openHostForm();
      } else if (meta && e.key === ",") {
        e.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openHostForm, openSettings]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        onOpenSettings={() => openSettings()}
        onToggleAi={() => setAiOpen((v) => !v)}
        aiOpen={aiOpen}
        onToggleSftp={toggleSftp}
        sftpOpen={sftpVisible}
      />

      <div className="flex min-h-0 flex-1">
        <HostSidebar
          onConnect={connect}
          onNewHost={() => openHostForm()}
          onEditHost={(host) => openHostForm(host.id)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Workspace onNewHost={() => openHostForm()} />
          <SftpPanel />
        </div>
        {aiOpen && (
          <AiPanel
            onClose={() => setAiOpen(false)}
            onOpenSettings={() => openSettings("ai")}
          />
        )}
      </div>

      <Toaster />
      <OverlayHost />
    </div>
  );
}
