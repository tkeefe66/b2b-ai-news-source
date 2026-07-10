import { useEffect, useState } from "react";
import { Moon, RefreshCw, Sun } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { navItems } from "@/components/app-sidebar";
import { useTheme } from "@/components/theme-provider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Module-level opener so other components (e.g. the sidebar ⌘K chip) can open
// the palette without prop drilling or extra context.
let openPalette: (() => void) | null = null;
export function openCommandPalette() {
  openPalette?.();
}

function slugify(title: string) {
  return title.toLowerCase().replace(/\s+/g, "-");
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();
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

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    openPalette = () => setOpen(true);
    return () => {
      openPalette = null;
    };
  }, []);

  const runAndClose = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 shadow-lg" data-testid="command-palette">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          <CommandInput placeholder="Search pages and actions…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Go to">
              {navItems.map((item) => (
                <CommandItem
                  key={item.url}
                  value={`${item.title} ${item.description}`}
                  onSelect={() => runAndClose(() => setLocation(item.url))}
                  data-testid={`command-item-${slugify(item.title)}`}
                >
                  <item.icon className="text-muted-foreground" />
                  <div className="flex flex-col">
                    <span>{item.title}</span>
                    <span className="text-xs text-muted-foreground">{item.description}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem
                value="Toggle dark mode Switch between light and dark theme"
                onSelect={() => runAndClose(toggleTheme)}
                data-testid="command-item-toggle-dark-mode"
              >
                {theme === "light" ? <Moon className="text-muted-foreground" /> : <Sun className="text-muted-foreground" />}
                <div className="flex flex-col">
                  <span>Toggle dark mode</span>
                  <span className="text-xs text-muted-foreground">Switch between light and dark theme</span>
                </div>
              </CommandItem>
              <CommandItem
                value="Refresh news feeds Fetch the latest articles from your sources"
                onSelect={() => runAndClose(() => refreshMutation.mutate())}
                data-testid="command-item-refresh-news-feeds"
              >
                <RefreshCw className="text-muted-foreground" />
                <div className="flex flex-col">
                  <span>Refresh news feeds</span>
                  <span className="text-xs text-muted-foreground">Fetch the latest articles from your sources</span>
                </div>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
