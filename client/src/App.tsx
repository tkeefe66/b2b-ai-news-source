import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProcessingQueue } from "@/components/processing-queue";
import { Loader2 } from "lucide-react";
import NewsFeed from "@/pages/news-feed";

const Trends = lazy(() => import("@/pages/trends"));
const Analyst = lazy(() => import("@/pages/analyst"));
const Briefing = lazy(() => import("@/pages/briefing"));
const Sources = lazy(() => import("@/pages/sources"));
const Enablement = lazy(() => import("@/pages/enablement"));
const DbPov = lazy(() => import("@/pages/db-pov"));
const CompanyAnalysis = lazy(() => import("@/pages/company-analysis"));
const ThoughtLeadershipPage = lazy(() => import("@/pages/thought-leadership"));
const SlideOutlines = lazy(() => import("@/pages/slide-outlines"));
const Research = lazy(() => import("@/pages/research"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full" data-testid="page-loader">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={NewsFeed} />
        <Route path="/briefing" component={Briefing} />
        <Route path="/trends" component={Trends} />
        <Route path="/analyst" component={Analyst} />
        <Route path="/sources" component={Sources} />
        <Route path="/enablement" component={Enablement} />
        <Route path="/db-pov" component={DbPov} />
        <Route path="/company-analysis" component={CompanyAnalysis} />
        <Route path="/thought-leadership" component={ThoughtLeadershipPage} />
        <Route path="/slide-outlines" component={SlideOutlines} />
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
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between gap-2 px-3 md:px-4 border-b border-border/60 h-11 md:h-12 bg-background/80 backdrop-blur-sm">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex items-center gap-1.5">
                    <ProcessingQueue />
                    <ThemeToggle />
                  </div>
                </header>
                <main className="flex-1 overflow-hidden">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
