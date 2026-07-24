import React from "react";
import ReactDOM from "react-dom/client";

import { AppProviders } from "@/app/providers";
import App from "@/App";
import { detectLocale } from "@/i18n/config";
import { loadLocale } from "@/i18n/translate";
import "@/styles/globals.css";

void loadLocale(detectLocale()).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </React.StrictMode>,
  );
});
