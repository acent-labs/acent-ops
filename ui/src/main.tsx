import * as React from "react";
import { StrictMode } from "react";
import * as ReactDOM from "react-dom";
import { BrowserRouter } from "@/lib/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { SentryGate } from "./components/SentryGate";
import { CompanyProvider, useCompany } from "./context/CompanyContext";
import { LiveUpdatesProvider } from "./context/LiveUpdatesProvider";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { PanelProvider } from "./context/PanelContext";
import { SidebarProvider } from "./context/SidebarContext";
import { DialogProvider } from "./context/DialogContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initPluginBridge } from "./plugins/bridge-init";
import { PluginLauncherProvider } from "./plugins/launchers";
import { startPerfMeasureReaper } from "./lib/perf-measure-reaper";
import { getOrCreatePaperclipReactRoot } from "./lib/react-root";
import { startServiceWorkerUpdates } from "./lib/service-worker-updates";
import { companySkillsApi } from "./api/companySkills";
import { dashboardApi } from "./api/dashboard";
import { queryKeys } from "./lib/queryKeys";
import "@mdxeditor/editor/style.css";
import "./index.css";

initPluginBridge(React, ReactDOM);

// React 19.2 emits an unbounded stream of performance.measure() entries for its
// DevTools performance tracks and never clears them; on a long-lived tab they
// accumulate into millions of native objects (GBs). Reap them periodically.
startPerfMeasureReaper();

// Parked SPA tabs never navigate, so beyond registering the worker this also
// re-checks /sw.js on tab focus and hourly, and applies a discovered update
// with one reload while the tab is hidden — otherwise an old worker and its
// cached shell can outlive a deploy indefinitely.
window.addEventListener("load", () => {
  startServiceWorkerUpdates();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Explicit so cross-tab-published cache entries for resources this tab
      // isn't observing get collected promptly rather than lingering. Single
      // tuning point if we need to trim the cache footprint further.
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    },
  },
});

const initialCompanyId = window.localStorage.getItem("paperclip.selectedCompanyId");
if (initialCompanyId && /^(?:\/[^/]+)?\/skills(?:\/|$)/.test(window.location.pathname)) {
  const bootstrapWindow = window as typeof window & {
    __paperclipSkillsBootstrap?: Promise<Awaited<ReturnType<typeof companySkillsApi.list>> | null>;
  };
  void Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.companySkills.list(initialCompanyId),
      queryFn: async () =>
        await bootstrapWindow.__paperclipSkillsBootstrap
        ?? companySkillsApi.list(initialCompanyId),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.companySkills.catalog(),
      queryFn: () => companySkillsApi.catalogList(),
    }),
  ]);
}
if (initialCompanyId && /^\/[^/]+\/dashboard\/?$/.test(window.location.pathname)) {
  void queryClient.prefetchQuery({
    queryKey: queryKeys.dashboard(initialCompanyId),
    queryFn: () => dashboardApi.summary(initialCompanyId, { initial: true }),
  });
}

function CompanyAwareBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const { selectedCompany } = useCompany();
  return <BreadcrumbProvider companyName={selectedCompany?.name ?? null}>{children}</BreadcrumbProvider>;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Paperclip root element is missing");

getOrCreatePaperclipReactRoot(window, rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SentryGate />
        <ThemeProvider>
          <BrowserRouter>
            <CompanyProvider>
              <ToastProvider>
                <LiveUpdatesProvider>
                  <TooltipProvider>
                    <CompanyAwareBreadcrumbProvider>
                      <SidebarProvider>
                        <PanelProvider>
                          <PluginLauncherProvider>
                            <DialogProvider>
                              <App />
                            </DialogProvider>
                          </PluginLauncherProvider>
                        </PanelProvider>
                      </SidebarProvider>
                    </CompanyAwareBreadcrumbProvider>
                  </TooltipProvider>
                </LiveUpdatesProvider>
              </ToastProvider>
            </CompanyProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>
);
