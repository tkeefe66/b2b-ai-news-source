import { Newspaper, Brain, BookOpen, RefreshCw, TrendingUp, Target, Database, BarChart3, Building2, Lightbulb, Search, Mail } from "lucide-react";
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
import { openCommandPalette } from "@/components/command-palette";

export interface NavItem {
  title: string;
  url: string;
  icon: typeof Newspaper;
  description: string;
}

// Single source of truth for primary navigation. Grouped by task: Scan (find
// what's new), Create (turn news into content), Manage (configure sources and data).
export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Scan",
    items: [
      { title: "News Feed", url: "/", icon: Newspaper, description: "Latest articles from your sources" },
      { title: "Briefings", url: "/briefings", icon: Mail, description: "Morning email digest and deep AI reports" },
      { title: "Trends", url: "/trends", icon: BarChart3, description: "AI trend snapshots, watchlist, and competitive intelligence" },
    ],
  },
  {
    label: "Create",
    items: [
      { title: "Thought Leadership", url: "/thought-leadership", icon: Lightbulb, description: "Turn news into content ideas, blogs, and decks" },
      { title: "Field Enablement", url: "/enablement", icon: Target, description: "Generate battle cards, emails, and sales decks" },
      { title: "AI Analyst", url: "/analyst", icon: Brain, description: "Chat with an analyst grounded in your news and briefings" },
    ],
  },
  {
    label: "Manage",
    items: [
      { title: "Public Company Analysis", url: "/company-analysis", icon: Building2, description: "AI reports on public companies" },
      { title: "Knowledge Base", url: "/db-pov", icon: Database, description: "Approved Demandbase product knowledge (DB POV)" },
      { title: "Research", url: "/research", icon: Search, description: "Crawl competitor sites and extract intel" },
      { title: "Sources", url: "/sources", icon: BookOpen, description: "Manage feeds, competitors, and uploads" },
    ],
  },
];

// Flat list derived from navGroups — used by the command palette.
export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);

// Briefings absorbed two former routes (/briefing and /morning-brief) that now
// redirect into /briefings?tab=..., so its active state must match by prefix.
function isNavItemActive(item: NavItem, location: string): boolean {
  if (item.url === "/briefings") return location.startsWith("/briefings");
  return location === item.url;
}

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
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold tracking-tight" data-testid="text-app-title">B2B MarTech Intel</h2>
            <p className="text-[11px] text-sidebar-foreground/70">Demandbase market intelligence</p>
          </div>
          <button
            type="button"
            onClick={openCommandPalette}
            title="Open command palette"
            aria-label="Open command palette"
            className="self-start"
            data-testid="button-command-palette-hint"
          >
            <kbd className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-sidebar-foreground/70">⌘K</kbd>
          </button>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2">
        <nav aria-label="Primary">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/70 font-semibold px-3">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild data-active={isNavItemActive(item, location)} className="rounded-lg transition-colors duration-150">
                        <Link href={item.url} title={item.description} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                          <item.icon className="h-4 w-4" />
                          <span className="text-[13px] font-medium">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
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
