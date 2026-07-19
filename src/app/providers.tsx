import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/query";
import { ThemeProvider } from "@/themes";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <SyncEventBridge />
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

function SyncEventBridge() {
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void ipc.sync
      .onCompleted(() => void queryClient.invalidateQueries())
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return null;
}
