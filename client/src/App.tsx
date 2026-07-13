import { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProcessingQueue } from "@/components/processing-queue";
import { Skeleton } from "@/components/ui/skeleton";
import NewsFeed from "@/pages/news-feed";

const Trends = lazy(() => import("@/pages/trends"));
const Analyst = lazy(() => import("@/pages/analyst"));
const Sources = lazy(() => import("@/pages/sources"));
const Enablement = lazy(() => import("@/pages/enablement"));
const DbPov = lazy(() => import("@/pages/db-pov"));
const CompanyAnalysis = lazy(() => import("@/pages/company-analysis"));
const ThoughtLeadershipPage = lazy(() => import("@/pages/thought-leadership"));
const Research = lazy(() => import("@/pages/research"));
const Briefings = lazy(() => import("@/pages/briefings"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="h-full p-6 space-y-4" data-testid="page-loader" role="status" aria-label="Loading page">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="space-y-3 pt-4">
        <Skeleton className="h-24 w-full max-w-3xl" />
        <Skeleton className="h-24 w-full max-w-3xl" />
        <Skeleton className="h-24 w-full max-w-3xl" />
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={NewsFeed} />
        <Route path="/briefing">
          <Redirect to="/briefings" replace />
        </Route>
        <Route path="/morning-brief">
          <Redirect to="/briefings?tab=morning-brief" replace />
        </Route>
        <Route path="/briefings" component={Briefings} />
        <Route path="/trends" component={Trends} />
        <Route path="/analyst" component={Analyst} />
        <Route path="/sources" component={Sources} />
        <Route path="/enablement" component={Enablement} />
        <Route path="/db-pov" component={DbPov} />
        <Route path="/company-analysis" component={CompanyAnalysis} />
        <Route path="/thought-leadership" component={ThoughtLeadershipPage} />
        <Route path="/research" component={Research} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

const sidebarStyle = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3rem",
};

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SidebarProvider style={sidebarStyle as React.CSSProperties}>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
            >
              Skip to content
            </a>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between gap-2 px-3 md:px-4 border-b border-border/60 h-11 md:h-12 bg-background/80 backdrop-blur-sm">
                  <SidebarTrigger data-testid="button-sidebar-toggle" aria-label="Toggle sidebar" />
                  <div className="flex items-center gap-1.5">
                    <ProcessingQueue />
                    <ThemeToggle />
                  </div>
                </header>
                <main id="main-content" className="flex-1 overflow-hidden">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <CommandPalette />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
