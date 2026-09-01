import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Lock, ShieldBan, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ReadinessAlert } from "@/components/readiness-alert";
import { LaneChip, RunStatusChip } from "@/components/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_BLURBS, ROLE_CATALOG, HARNESS_SPEC } from "@/lib/harness/spec";
import { relativeTime } from "@/lib/harness/labels";
import { useHarness } from "@/lib/harness/store";
import { ROLE_IDS } from "@/lib/harness/types";

export const Route = createFileRoute("/")({ component: CommandCenter });

function CommandCenter() {
  const runs = useHarness((s) => s.runs);
  const lastDiscoveryAt = useHarness((s) => s.lastDiscoveryAt);
  const unavailable = useHarness((s) => s.unavailable);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const visibleRuns = mounted ? runs.slice(0, 5) : [];
  const blocked = mounted ? runs.filter((r) => r.status === "blocked").length : 0;
  const accepted = mounted ? runs.filter((r) => r.status === "accepted").length : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="Safe AI assistance"
        title="Ask once. NeuralLoom handles the safety checks."
        description="Describe your task in ordinary language. NeuralLoom checks what can be shared, chooses an approved AI model, reviews the response, and keeps a privacy-aware record."
      />

      <div className="-mt-3 mb-6 flex flex-wrap gap-2">
        <Button asChild size="lg">
          <Link to="/dispatch">
            Start a new task
            <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link to="/policy">How your data is protected</Link>
        </Button>
      </div>

      <div className="mb-6">
        <ReadinessAlert />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Connection"
          value="Ollama"
          detail={HARNESS_SPEC.cloud_primary.endpoint.replace("http://", "")}
        />
        <Stat
          label="Model status"
          value={unavailable.length ? `${unavailable.length} down` : "Inventory live"}
          detail={
            mounted && lastDiscoveryAt ? `Checked ${relativeTime(lastDiscoveryAt)}` : "Checking now"
          }
        />
        <Stat label="Data safety" value="Private by default" detail="Unknown information blocked" />
        <Stat
          label="Generated commands"
          value="Not executed"
          detail="A workspace runner must be connected"
        />
      </div>

      <section className="mb-10">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="font-display text-2xl tracking-tight">AI specialists</h2>
          <Link to="/roles" className="text-sm text-muted-foreground hover:text-foreground">
            View roles
          </Link>
        </div>
        <div className="stagger-in space-y-2">
          {ROLE_IDS.map((id) => {
            const role = ROLE_CATALOG[id];
            return (
              <Link
                key={id}
                to="/roles"
                className="group flex min-h-14 items-center gap-4 rounded-2xl bg-card px-4 py-3 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
              >
                <span className="hidden w-28 shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:block">
                  {role.label}
                </span>
                <span className="relative h-px min-w-8 flex-1 bg-border">
                  <span className="absolute top-1/2 left-[12%] size-1.5 -translate-y-1/2 rounded-full bg-primary" />
                  <span className="absolute top-1/2 left-[48%] size-1.5 -translate-y-1/2 rounded-full bg-primary/50" />
                  <span className="absolute top-1/2 left-[82%] size-1.5 -translate-y-1/2 rounded-full bg-primary/30" />
                </span>
                <span className="min-w-0 flex-1 sm:flex-[2]">
                  <span className="block font-medium sm:hidden">{role.label}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {role.primary}
                  </span>
                </span>
                <Badge variant="outline" className="hidden md:inline-flex">
                  think {role.think}
                </Badge>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            );
          })}
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {ROLE_BLURBS.planner} Every environment uses the configured Ollama daemon, and the runtime
          model must match the discovered model exactly.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent tasks</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/audit">Audit log</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {visibleRuns.length === 0 ? (
              <EmptyRuns />
            ) : (
              <ul className="divide-y divide-border">
                {visibleRuns.map((run) => (
                  <li key={run.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{run.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {ROLE_CATALOG[run.role].label}
                        {run.intendedModel ? ` · ${run.intendedModel}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <RunStatusChip status={run.status} />
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {relativeTime(run.createdAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Posture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PostureRow
              icon={ShieldBan}
              label="Blocked tasks"
              value={String(blocked)}
              detail="Refused before a model call"
            />
            <PostureRow
              icon={Lock}
              label="Accepted tasks"
              value={String(accepted)}
              detail="Plan, patch, critic, and checks"
            />
            <PostureRow
              icon={Waypoints}
              label="Routing guards"
              value="5 / 5"
              detail="Classify, fail closed, no silent substitution"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <LaneChip lane="cloud_permitted" />
              <LaneChip lane="explicit_authorization" />
              <LaneChip lane="local_only" />
            </div>
            <Button asChild className="w-full">
              <Link to="/dispatch">
                Open dispatch
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 font-medium">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function PostureRow({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Lock;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">{label}</p>
          <p className="font-mono text-sm tabular-nums">{value}</p>
        </div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function EmptyRuns() {
  return (
    <div className="rounded-xl bg-secondary px-4 py-8 text-center">
      <p className="font-medium">No tasks yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Dispatch a public-repo refactor or watch an unredacted log get refused.
      </p>
      <Button asChild className="mt-4">
        <Link to="/dispatch">Start a task</Link>
      </Button>
    </div>
  );
}
