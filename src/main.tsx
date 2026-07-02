import React from "react";
import ReactDOM from "react-dom/client";

import { AppProviders } from "@/app/providers";
import App from "@/App";
import { GroupsWindow } from "@/windows/GroupsWindow";
import { HostFormWindow } from "@/windows/HostFormWindow";
import { SettingsWindow } from "@/windows/SettingsWindow";
import "@/styles/globals.css";

/** Each window loads this same bundle with a `#/<view>?id=…` hash. */
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
    <AppProviders>{resolveView()}</AppProviders>
  </React.StrictMode>,
);
