import { CredentialsView } from "@/features/credentials/CredentialsView";
import { ForwardsView } from "@/features/forwards/ForwardsView";
import { HostsView } from "@/features/hosts/HostsView";
import { MonitorView } from "@/features/monitor/MonitorView";
import { SnippetsView } from "@/features/snippets/SnippetsView";
import { useLayoutStore } from "./layout";

export function SideBar({ width }: { width: number }) {
  const activity = useLayoutStore((s) => s.activity);

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col overflow-hidden bg-surface"
    >
      {activity === "hosts" && <HostsView />}
      {activity === "credentials" && <CredentialsView />}
      {activity === "snippets" && <SnippetsView />}
      {activity === "forwards" && <ForwardsView />}
      {activity === "monitor" && <MonitorView />}
    </aside>
  );
}
