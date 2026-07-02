import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { TitleBar } from "@/components/layout/TitleBar";
import { Toaster } from "@/components/ui/toaster";
import { ipc } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import {
  ACTION_EVENT,
  openHostWindow,
  openSettingsWindow,
  type WindowAction,
} from "@/lib/windows";
import { useI18n } from "@/i18n";
import type { Host } from "@/types/models";
import { AiPanel } from "@/features/ai/AiPanel";
import { HostSidebar } from "@/features/hosts/HostSidebar";
import { SftpPanel } from "@/features/sftp/SftpPanel";
import { useSftpStore } from "@/features/sftp/store";
import { useSessionStore } from "@/features/terminal/sessionStore";
import { Workspace } from "@/features/terminal/Workspace";

export default function App() {
  const { t } = useI18n();
  const openSession = useSessionStore((s) => s.open);
  const [aiOpen, setAiOpen] = useState(false);
  const sftpVisible = useSftpStore((s) => s.visible);
  const toggleSftp = useSftpStore((s) => s.toggle);

  const connect = useCallback(
    (host: Host) => {
      openSession(host);
    },
    [openSession],
  );

  // Handle actions dispatched from other windows (e.g. running a snippet).
  useEffect(() => {
    const unlisten = listen<WindowAction>(ACTION_EVENT, (e) => {
      const action = e.payload;
      if (action.type === "run-command") {
        const activeId = useSessionStore.getState().activeId;
        if (!activeId) {
          toast.error(t("common.noActiveTerminalTitle"));
          return;
        }
        void ipc.ssh.send(activeId, action.command + "\n").catch(() => {});
      }
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, [t]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void openHostWindow();
      } else if (meta && e.key === ",") {
        e.preventDefault();
        void openSettingsWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        onOpenSettings={() => void openSettingsWindow()}
        onToggleAi={() => setAiOpen((v) => !v)}
        aiOpen={aiOpen}
        onToggleSftp={toggleSftp}
        sftpOpen={sftpVisible}
      />

      <div className="flex min-h-0 flex-1">
        <HostSidebar
          onConnect={connect}
          onNewHost={() => void openHostWindow()}
          onEditHost={(host) => void openHostWindow(host.id)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Workspace onNewHost={() => void openHostWindow()} />
          <SftpPanel />
        </div>
        {aiOpen && (
          <AiPanel
            onClose={() => setAiOpen(false)}
            onOpenSettings={() => void openSettingsWindow()}
          />
        )}
      </div>

      <Toaster />
    </div>
  );
}
