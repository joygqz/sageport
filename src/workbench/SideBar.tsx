import { CredentialsView } from "@/features/credentials/CredentialsView";
import { HostsView } from "@/features/hosts/HostsView";
import { SnippetsView } from "@/features/snippets/SnippetsView";
import { useLayoutStore } from "./layout";

/** The side bar renders the view of whichever activity is selected. */
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
    </aside>
  );
}
