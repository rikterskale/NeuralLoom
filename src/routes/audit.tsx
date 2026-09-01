import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { LaneChip, RunStatusChip } from "@/components/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ROLE_CATALOG } from "@/lib/harness/spec";
import { relativeTime } from "@/lib/harness/labels";
import { useHarness } from "@/lib/harness/store";
import { clearHarnessRuns } from "@/lib/harness/api";
import type { HarnessRun, RunStatus } from "@/lib/harness/types";

export const Route = createFileRoute("/audit")({ component: AuditPage });

const FILTERS: { id: "all" | RunStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "accepted", label: "Accepted" },
  { id: "blocked", label: "Blocked" },
  { id: "pending_approval", label: "Approval" },
  { id: "failed", label: "Failed" },
];

function AuditPage() {
  const runs = useHarness((s) => s.runs);
  const clearRuns = useHarness((s) => s.clearRuns);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = useMemo(
    () => (filter === "all" ? runs : runs.filter((r) => r.status === filter)),
    [runs, filter],
  );
  const selected = runs.find((r) => r.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="Observability"
        title="Every selection is on the record."
        description="Server-verified model identity, decisions, and checks are stored. Private task content is withheld and secret patterns are redacted."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "default" : "secondary"}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void clearHarnessRuns().then(clearRuns)}
          disabled={!runs.length}
        >
          Clear log
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No audit events in this filter. Dispatch a weave to seed the log.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => setOpenId(run.id)}
                className="flex w-full min-h-14 items-start justify-between gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-[var(--shadow-border)]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{run.title}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {ROLE_CATALOG[run.role].label}
                    {run.intendedModel ? ` · ${run.intendedModel}` : ""}
                    {run.fallbackReason ? " · fallback" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <RunStatusChip status={run.status} />
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {relativeTime(run.createdAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          {selected ? <RunDetail run={selected} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RunDetail({ run }: { run: HarnessRun }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{run.title}</DialogTitle>
      </DialogHeader>
      <div className="mt-4 space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <RunStatusChip status={run.status} />
          <LaneChip lane={run.classification.lane} />
          <Badge variant="outline">{run.promptTemplateVersion}</Badge>
        </div>
        <Field label="Intended model" value={run.intendedModel ?? "—"} />
        <Field label="Runtime model" value={run.runtimeModel ?? "—"} />
        <Field label="Digest" value={run.modelDigest ?? "—"} />
        <Field label="Fallback" value={run.fallbackReason ?? "none"} />
        <Field
          label="Tokens"
          value={
            run.tokenUsage
              ? `${run.tokenUsage.prompt} + ${run.tokenUsage.completion} = ${run.tokenUsage.total}`
              : "—"
          }
        />
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Events
          </p>
          <ul className="mt-2 space-y-2">
            {run.events.map((ev, i) => (
              <li key={`${ev.at}-${i}`} className="rounded-lg bg-secondary px-3 py-2">
                <p className="font-medium">{ev.kind}</p>
                <p className="text-muted-foreground">{ev.summary}</p>
              </li>
            ))}
          </ul>
        </div>
        {run.plan ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Plan</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                {run.plan}
              </pre>
            </CardContent>
          </Card>
        ) : null}
        {run.patch ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Patch</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                {run.patch}
              </pre>
            </CardContent>
          </Card>
        ) : null}
        {run.critic ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Critic</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                {run.critic}
              </pre>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-mono text-xs leading-relaxed break-all">{value}</p>
    </div>
  );
}
