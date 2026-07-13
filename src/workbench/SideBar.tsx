import { lazy, Suspense } from "react";

import { Spinner } from "@/components/ui";
import { HostsView } from "@/features/hosts/HostsView";
import { useLayoutStore } from "./layout";

const CredentialsView = lazy(() =>
  import("@/features/credentials/CredentialsView").then((module) => ({
    default: module.CredentialsView,
  })),
);

const ForwardsView = lazy(() =>
  import("@/features/forwards/ForwardsView").then((module) => ({
    default: module.ForwardsView,
  })),
);

const MonitorView = lazy(() =>
  import("@/features/monitor/MonitorView").then((module) => ({
    default: module.MonitorView,
  })),
);

const SnippetsView = lazy(() =>
  import("@/features/snippets/SnippetsView").then((module) => ({
    default: module.SnippetsView,
  })),
);

export function SideBar({ width }: { width: number }) {
  const activity = useLayoutStore((s) => s.activity);

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col overflow-hidden bg-surface/80"
    >
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        {activity === "hosts" && <HostsView />}
        {activity === "credentials" && <CredentialsView />}
        {activity === "snippets" && <SnippetsView />}
        {activity === "forwards" && <ForwardsView />}
        {activity === "monitor" && <MonitorView />}
      </Suspense>
    </aside>
  );
}
