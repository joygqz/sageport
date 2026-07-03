import React from "react";
import ReactDOM from "react-dom/client";

import { AppProviders } from "@/app/providers";
import App from "@/App";
import "@/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
