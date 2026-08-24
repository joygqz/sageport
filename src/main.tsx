import React from "react";
import ReactDOM from "react-dom/client";

import { AppProviders } from "@/app/providers";
import App from "@/App";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DEFAULT_LOCALE, detectLocale } from "@/i18n/config";
import { loadLocale } from "@/i18n/translate";
import "@/styles/globals.css";

async function start() {
  try {
    await loadLocale(detectLocale());
  } catch {
    await loadLocale(DEFAULT_LOCALE).catch(() => {});
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppProviders>
          <App />
        </AppProviders>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void start();
