import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Cpu,
  GitMerge,
  LayoutGrid,
  ListChecks,
  Menu,
  ScrollText,
  Shield,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { WeaveMark } from "@/components/weave-mark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useHarness } from "@/lib/harness/store";
import { getModelDiscovery, listHarnessRuns } from "@/lib/harness/api";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home", icon: LayoutGrid },
  { to: "/dispatch", label: "New task", icon: GitMerge },
  { to: "/roles", label: "AI roles", icon: Users },
  { to: "/policy", label: "Safety", icon: Shield },
  { to: "/pipeline", label: "Checks", icon: ListChecks },
  { to: "/models", label: "Models", icon: Cpu },
  { to: "/audit", label: "Audit", icon: ScrollText },
] as const;

const MOBILE_PRIMARY = ["/", "/dispatch", "/policy", "/audit"] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const setDiscovery = useHarness((s) => s.setDiscovery);
  const setRuns = useHarness((s) => s.setRuns);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([getModelDiscovery(), listHarnessRuns()])
      .then(([discovery, runs]) => {
        if (!live) return;
        setDiscovery(discovery);
        setRuns(runs);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [setDiscovery, setRuns]);

  return (
    <div className="weave-bg min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-background/90 px-4 py-6 backdrop-blur-sm lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-2.5 px-2">
          <WeaveMark className="size-7 text-primary" />
          <span className="font-display text-2xl leading-none tracking-tight">NeuralLoom</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} {...item} active={pathname === item.to} />
          ))}
        </nav>
        <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
          Sensitive material stays local. Every decision is checked on the server.
        </p>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur-sm lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <WeaveMark className="size-6 text-primary" />
          <span className="font-display text-xl leading-none">NeuralLoom</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label="Open menu"
          onClick={() => setMoreOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
      </header>

      <main id="main" className="px-4 pt-6 pb-28 lg:ml-56 lg:px-10 lg:pt-10 lg:pb-16">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-border bg-background/95 px-1 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden">
        {NAV.filter((n) => (MOBILE_PRIMARY as readonly string[]).includes(n.to)).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium",
              pathname === item.to ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium text-muted-foreground"
          onClick={() => setMoreOpen(true)}
        >
          <Activity className="size-4" />
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="lg:hidden">
          <SheetHeader>
            <SheetTitle>Navigate</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-2 pb-4">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex min-h-12 items-center gap-2 rounded-xl bg-secondary px-3 text-sm",
                  pathname === item.to ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-150",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
