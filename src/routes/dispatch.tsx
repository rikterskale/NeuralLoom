import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { completeRole } from "@/lib/ai/complete";
import { PageHeader } from "@/components/page-header";
import { LaneChip, RunStatusChip } from "@/components/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CLASS_LABELS } from "@/lib/harness/classify";
import { evaluateDispatch, materializeRun } from "@/lib/harness/engine";
import { ACTION_LABELS, formatClass } from "@/lib/harness/labels";
import { PRESETS } from "@/lib/harness/presets";
import { criticSystemPrompt, roleSystemPrompt } from "@/lib/harness/prompts";
import { ROLE_CATALOG, buildInventory } from "@/lib/harness/spec";
import { useHarness } from "@/lib/harness/store";
import { assembleVerification, parseStructured } from "@/lib/harness/verify";
import {
  CLOUD_PERMITTED,
  CONTEXT_INCLUDE,
  EXPLICIT_AUTH_REQUIRED,
  HUMAN_APPROVAL_ACTIONS,
  LOCAL_ONLY,
  ROLE_IDS,
  type ContextInclude,
  type DispatchInput,
  type HarnessRun,
  type HumanApprovalAction,
  type KnownDataClass,
  type RoleId,
} from "@/lib/harness/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dispatch")({ component: DispatchPage });

const EMPTY: DispatchInput = {
  title: "",
  objective: "",
  role: "auto",
  taggedClasses: [],
  redactionVerified: false,
  authorizationGranted: false,
  requestedActions: [],
  approvedActions: [],
  contextIncludes: ["relevant_source_files", "relevant_tests"],
  targetAllowlisted: false,
  authorizationRecord: false,
  simulatePrimaryFailure: false,
  operatorAcceptedLab: false,
};

function DispatchPage() {
  const unavailable = useHarness((s) => s.unavailable);
  const pushRun = useHarness((s) => s.pushRun);
  const updateRun = useHarness((s) => s.updateRun);
  const inventory = useMemo(() => buildInventory(unavailable), [unavailable]);
  const [input, setInput] = useState<DispatchInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<HarnessRun | null>(null);

  const snapshot = useMemo(
    () => evaluateDispatch(input, inventory),
    [input, inventory],
  );

  function patch(partial: Partial<DispatchInput>) {
    setInput((s) => ({ ...s, ...partial }));
  }

  function toggleClass(cls: KnownDataClass) {
    patch({
      taggedClasses: input.taggedClasses.includes(cls)
        ? input.taggedClasses.filter((c) => c !== cls)
        : [...input.taggedClasses, cls],
    });
  }

  function toggleAction(
    action: HumanApprovalAction,
    field: "requestedActions" | "approvedActions",
  ) {
    const current = input[field];
    patch({
      [field]: current.includes(action)
        ? current.filter((a) => a !== action)
        : [...current, action],
    });
  }

  function applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setInput({ ...preset.input });
    setActive(null);
  }

  async function weave() {
    const snap = evaluateDispatch(input, inventory);
    const run = materializeRun(snap);
    pushRun(run);
    setActive(run);
    if (!snap.canCallModel) {
      toast.message(snap.blockReason ?? "Weave refused.");
      return;
    }

    setBusy(true);
    const role = run.role;
    try {
      const primary = await completeRole({
        data: {
          system: roleSystemPrompt(role),
          user: [
            `Title: ${run.title}`,
            `Objective:\n${input.objective}`,
            `Context slices: ${input.contextIncludes.join(", ") || "none"}`,
            `Data classes: ${run.classification.classes.join(", ")}`,
          ].join("\n\n"),
          temperature: ROLE_CATALOG[role].temperature,
          maxTokens: role === "fast_triage" ? 500 : 900,
        },
      });

      if (!primary.ok) {
        const failed: HarnessRun = {
          ...run,
          status: "failed",
          runtimeModel: null,
          events: [
            ...run.events,
            {
              at: new Date().toISOString(),
              kind: "model_call",
              summary: primary.error,
            },
          ],
        };
        updateRun(run.id, failed);
        setActive(failed);
        toast.error(primary.error);
        return;
      }

      const parsed = parseStructured(primary.text);
      const critic = await completeRole({
        data: {
          system: criticSystemPrompt(),
          user: `Review this ${role} artifact.\n\n${primary.text}`,
          temperature: ROLE_CATALOG.critic.temperature,
          maxTokens: 500,
        },
      });

      const criticText = critic.ok ? critic.text : `Critic unavailable: ${critic.error}`;
      const verification = assembleVerification({
        plan: parsed.plan,
        patch: parsed.patch,
        output: primary.text,
        critic: critic.ok ? critic.text : null,
        offensiveRequested: input.requestedActions.includes("exploit_execution"),
        targetAllowlisted: input.targetAllowlisted,
        operatorAcceptedLab: input.operatorAcceptedLab,
      });

      const usage = {
        prompt: primary.usage.prompt + (critic.ok ? critic.usage.prompt : 0),
        completion:
          primary.usage.completion + (critic.ok ? critic.usage.completion : 0),
        total: 0,
      };
      usage.total = usage.prompt + usage.completion;

      const finished: HarnessRun = {
        ...run,
        status: verification.accepted ? "accepted" : "rejected",
        runtimeModel: primary.model,
        tokenUsage: usage,
        plan: parsed.plan,
        patch: parsed.patch,
        output: primary.text,
        critic: criticText,
        verification,
        operatorAccepted: input.operatorAcceptedLab,
        events: [
          ...run.events,
          {
            at: new Date().toISOString(),
            kind: "model_call",
            summary: `Intended ${run.intendedModel}; runtime ${primary.model}`,
            fields: {
              promptTokens: primary.usage.prompt,
              completionTokens: primary.usage.completion,
            },
          },
          {
            at: new Date().toISOString(),
            kind: "critic",
            summary: critic.ok ? "Critic review captured" : critic.error,
          },
          {
            at: new Date().toISOString(),
            kind: "verify",
            summary: verification.accepted
              ? "Pipeline accepted"
              : verification.notes.join("; ") || "Pipeline rejected",
          },
        ],
      };
      updateRun(run.id, finished);
      setActive(finished);
      toast.success(
        verification.accepted ? "Weave accepted." : "Weave completed with findings.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Weave failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="Dispatch"
        title="Classify, then weave."
        description="Tag the data class before a model is selected. The live inspector on the right is the same engine that will refuse the call."
      />

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p.id)}
            className="min-h-11 shrink-0 rounded-full bg-secondary px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="order-2 space-y-5 lg:order-1 lg:col-span-3">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={input.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Short name for the audit record"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="objective">Objective</Label>
            <Textarea
              id="objective"
              value={input.objective}
              onChange={(e) => patch({ objective: e.target.value })}
              placeholder="What should the role do? Secrets in this box are detected and forced local-only."
            />
          </div>

          <fieldset>
            <Label>Role</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <RoleChip
                active={input.role === "auto"}
                onClick={() => patch({ role: "auto" })}
              >
                Auto
              </RoleChip>
              {ROLE_IDS.map((id) => (
                <RoleChip
                  key={id}
                  active={input.role === id}
                  onClick={() => patch({ role: id as RoleId })}
                >
                  {ROLE_CATALOG[id].label}
                </RoleChip>
              ))}
            </div>
          </fieldset>

          <ClassPicker selected={input.taggedClasses} onToggle={toggleClass} />

          {snapshot.classification.suggested.length > 0 ? (
            <div className="rounded-xl bg-secondary px-4 py-3 text-sm">
              <p className="text-muted-foreground">Suggested classes</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {snapshot.classification.suggested.map((cls) => (
                  <Button
                    key={cls}
                    size="sm"
                    variant="outline"
                    onClick={() => toggleClass(cls)}
                  >
                    {CLASS_LABELS[cls]}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <ToggleRow
              id="redaction"
              label="Redaction verified"
              checked={input.redactionVerified}
              onCheckedChange={(on) => patch({ redactionVerified: on })}
            />
            <ToggleRow
              id="authz"
              label="Explicit authorization granted"
              checked={input.authorizationGranted}
              onCheckedChange={(on) => patch({ authorizationGranted: on })}
            />
            <ToggleRow
              id="allowlist"
              label="Target allowlisted"
              checked={input.targetAllowlisted}
              onCheckedChange={(on) => patch({ targetAllowlisted: on })}
            />
            <ToggleRow
              id="record"
              label="Authorization record on file"
              checked={input.authorizationRecord}
              onCheckedChange={(on) => patch({ authorizationRecord: on })}
            />
            <ToggleRow
              id="lab"
              label="Operator accepts lab evidence"
              checked={input.operatorAcceptedLab}
              onCheckedChange={(on) => patch({ operatorAcceptedLab: on })}
            />
            <ToggleRow
              id="primary-fail"
              label="Simulate primary failure"
              checked={input.simulatePrimaryFailure}
              onCheckedChange={(on) => patch({ simulatePrimaryFailure: on })}
            />
          </div>

          <fieldset>
            <Label>Requested actions</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {HUMAN_APPROVAL_ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => toggleAction(action, "requestedActions")}
                  className={cn(
                    "min-h-9 rounded-full px-3 text-xs",
                    input.requestedActions.includes(action)
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {ACTION_LABELS[action]}
                </button>
              ))}
            </div>
          </fieldset>

          {input.requestedActions.length > 0 ? (
            <fieldset>
              <Label>Approve requested actions</Label>
              <div className="mt-2 space-y-2">
                {input.requestedActions.map((action) => (
                  <label key={action} className="flex min-h-11 items-center gap-3">
                    <Checkbox
                      checked={input.approvedActions.includes(action)}
                      onCheckedChange={() => toggleAction(action, "approvedActions")}
                    />
                    <span className="text-sm">{ACTION_LABELS[action]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <Label>Repository context</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CONTEXT_INCLUDE.map((id) => {
                const on = input.contextIncludes.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      patch({
                        contextIncludes: on
                          ? input.contextIncludes.filter((c) => c !== id)
                          : [...input.contextIncludes, id as ContextInclude],
                      })
                    }
                    className={cn(
                      "min-h-9 rounded-full px-3 text-xs",
                      on
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {formatClass(id)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Button
            className="w-full"
            size="lg"
            disabled={busy || input.objective.trim().length < 8}
            onClick={() => void weave()}
          >
            {busy ? "Weaving…" : snapshot.canCallModel ? "Weave run" : "Record refusal"}
          </Button>
        </div>

        <aside className="order-1 space-y-4 lg:order-2 lg:col-span-2 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Live inspector</CardTitle>
              <RunStatusChip status={snapshot.status} />
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <LaneChip lane={snapshot.classification.lane} />
                <Badge variant="outline">{ROLE_CATALOG[snapshot.route.role].label}</Badge>
              </div>
              <p className="leading-relaxed text-muted-foreground">
                {snapshot.blockReason ??
                  `Clear to call ${snapshot.route.selectedModel}. Critic will review before acceptance.`}
              </p>
              <dl className="space-y-2">
                <Row k="Primary" v={snapshot.route.candidate} />
                <Row k="Selected" v={snapshot.route.selectedModel ?? "none"} />
                <Row k="Fallback" v={snapshot.route.fallbackReason ?? "not used"} />
                <Row
                  k="Sandbox"
                  v={snapshot.execution.sandboxRequired ? "required" : "off"}
                />
                <Row k="Network" v={snapshot.execution.networkAccess} />
                <Row k="Secrets" v={snapshot.execution.secretsAccess} />
              </dl>
              {snapshot.classification.reasons.length > 0 ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {snapshot.classification.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          {active ? <RunResult run={active} /> : null}
        </aside>
      </div>
    </div>
  );
}

function RoleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full px-3 text-xs",
        active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ClassPicker({
  selected,
  onToggle,
}: {
  selected: KnownDataClass[];
  onToggle: (cls: KnownDataClass) => void;
}) {
  const groups = [
    { title: "Cloud permitted", items: CLOUD_PERMITTED },
    { title: "Explicit authorization", items: EXPLICIT_AUTH_REQUIRED },
    { title: "Local only", items: LOCAL_ONLY },
  ] as const;
  return (
    <fieldset className="space-y-3">
      <Label>Data classes</Label>
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.title}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((id) => {
              const on = selected.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onToggle(id)}
                  className={cn(
                    "min-h-9 rounded-full px-3 text-xs",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {CLASS_LABELS[id]}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-secondary px-3">
      <Label htmlFor={id} className="text-sm text-foreground">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="max-w-[60%] text-right font-mono text-xs leading-relaxed break-all">
        {v}
      </dd>
    </div>
  );
}

function RunResult({ run }: { run: HarnessRun }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Result</CardTitle>
        <RunStatusChip status={run.status} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {run.verification ? (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={run.verification.structuredPlan ? "ok" : "deny"}>Plan</Badge>
            <Badge variant={run.verification.patchNotFullOverwrite ? "ok" : "deny"}>
              Patch
            </Badge>
            <Badge variant={run.verification.criticReview ? "ok" : "deny"}>Critic</Badge>
            {run.verification.checks
              .filter((c) => c.status !== "skip")
              .map((c) => (
                <Badge key={c.id} variant={c.status === "pass" ? "ok" : "deny"}>
                  {formatClass(c.id)}
                </Badge>
              ))}
          </div>
        ) : null}
        {run.plan ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 font-mono text-xs leading-relaxed">
            {run.plan}
          </pre>
        ) : null}
        {run.patch ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 font-mono text-xs leading-relaxed">
            {run.patch}
          </pre>
        ) : run.output && run.status !== "blocked" ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 font-mono text-xs leading-relaxed">
            {run.output}
          </pre>
        ) : null}
        {run.tokenUsage ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            Tokens {run.tokenUsage.total} · runtime {run.runtimeModel ?? "—"}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
