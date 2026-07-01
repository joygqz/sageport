import { useEffect, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { REFRESH_EVENT } from "@/lib/windows";
import { ThemeProvider } from "@/theme/ThemeProvider";

/** Invalidate all queries whenever any window emits a refresh event. */
function RefreshBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    const unlisten = listen(REFRESH_EVENT, () => {
      void qc.invalidateQueries();
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, [qc]);
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ThemeProvider>
          <RefreshBridge />
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
