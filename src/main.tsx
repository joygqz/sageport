import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";

import { AppProviders } from "@/app/providers";
import "@/styles/globals.css";

/* eslint-disable react-refresh/only-export-components -- entry point, never itself hot-reloaded */
const App = lazy(() => import("@/App"));
const GroupsWindow = lazy(() =>
  import("@/windows/GroupsWindow").then((m) => ({ default: m.GroupsWindow })),
);
const HostFormWindow = lazy(() =>
  import("@/windows/HostFormWindow").then((m) => ({
    default: m.HostFormWindow,
  })),
);
const SettingsWindow = lazy(() =>
  import("@/windows/SettingsWindow").then((m) => ({
    default: m.SettingsWindow,
  })),
);

/**
 * Each Tauri window loads this same bundle with a `#/<view>?id=…` hash. The
 * views are lazy-imported so a popup window (e.g. settings) doesn't have to
 * download the main window's terminal/markdown dependencies.
 */
function resolveView() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [view, qs] = raw.split("?");
  const id = new URLSearchParams(qs).get("id");

  switch (view) {
    case "settings":
      return <SettingsWindow />;
    case "host":
      return <HostFormWindow hostId={id} />;
    case "groups":
      return <GroupsWindow groupId={id} />;
    default:
      return <App />;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <Suspense fallback={null}>{resolveView()}</Suspense>
    </AppProviders>
  </React.StrictMode>,
);
