import { Newspaper, Brain, BookOpen, RefreshCw, TrendingUp, FileText, Target, Database, BarChart3, Building2, Lightbulb, Search, Mail } from "lucide-react";
import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { title: "News Feed", url: "/", icon: Newspaper, description: "Latest articles from your sources" },
  { title: "Daily Briefing", url: "/briefing", icon: FileText, description: "Generate an AI news summary for any date range" },
  { title: "Morning Brief", url: "/morning-brief", icon: Mail, description: "Archive of the weekday-morning email digest" },
  { title: "Trends", url: "/trends", icon: BarChart3, description: "AI trend snapshots and competitive intelligence" },
  { title: "Thought Leadership", url: "/thought-leadership", icon: Lightbulb, description: "Turn news into content ideas, blogs, and decks" },
  { title: "Public Company Analysis", url: "/company-analysis", icon: Building2, description: "AI reports on public companies" },
  { title: "AI Analyst", url: "/analyst", icon: Brain, description: "Chat with an analyst grounded in your news and briefings" },
  { title: "Field Enablement", url: "/enablement", icon: Target, description: "Generate battle cards, emails, and sales decks" },
  { title: "Knowledge Base", url: "/db-pov", icon: Database, description: "Approved Demandbase product knowledge (DB POV)" },
  { title: "Research", url: "/research", icon: Search, description: "Crawl competitor sites and extract intel" },
  { title: "Sources", url: "/sources", icon: BookOpen, description: "Manage feeds, competitors, and uploads" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { toast } = useToast();

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fetch-feeds");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fetch-feeds/status"] });
      toast({
        title: data.total > 0 ? "Feeds refreshed" : "Feeds up to date",
        description: data.total > 0 ? `${data.total} new article${data.total === 1 ? "" : "s"} found.` : "No new articles found.",
      });
    },
    onError: () => {
      toast({
        title: "Refresh failed",
        description: "Could not fetch latest news. Try again later.",
        variant: "destructive",
      });
    },
  });

  return (
    <Sidebar>
      <SidebarHeader className="p-4 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary">
            <TrendingUp className="h-[18px] w-[18px] text-sidebar-primary-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight" data-testid="text-app-title">B2B MarTech Intel</h2>
            <p className="text-[11px] text-sidebar-foreground/70">Demandbase market intelligence</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/70 font-semibold px-3">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Primary">
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url} className="rounded-lg transition-colors duration-150">
                    <Link href={item.url} title={item.description} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="h-4 w-4" />
                      <span className="text-[13px] font-medium">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <Button
          variant="secondary"
          className="w-full rounded-lg text-xs font-medium"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-sidebar-refresh-feeds"
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          {refreshMutation.isPending ? "Refreshing..." : "Refresh Feeds"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
