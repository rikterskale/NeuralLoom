import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLASS_LABELS } from "@/lib/harness/classify";
import { ACTION_LABELS } from "@/lib/harness/labels";
import { HARNESS_SPEC } from "@/lib/harness/spec";
import {
  CLOUD_PERMITTED,
  EXPLICIT_AUTH_REQUIRED,
  HUMAN_APPROVAL_ACTIONS,
  LOCAL_ONLY,
} from "@/lib/harness/types";

export const Route = createFileRoute("/policy")({ component: PolicyPage });

function PolicyPage() {
  const guards = HARNESS_SPEC.data_policy.routing_guards;
  const exec = HARNESS_SPEC.execution_policy;
  const targets = exec.target_controls;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="Data and execution"
        title="Deny is the default weave."
        description="Every payload is classified before a model is selected. Local-only data cannot fall back onto cloud. Commands do not run unless the sandbox, allowlist, and a human agree."
      />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <LaneColumn
          title="Cloud permitted"
          tone="ok"
          items={CLOUD_PERMITTED.map((id) => CLASS_LABELS[id])}
        />
        <LaneColumn
          title="Explicit authorization"
          tone="warn"
          items={EXPLICIT_AUTH_REQUIRED.map((id) => CLASS_LABELS[id])}
        />
        <LaneColumn
          title="Local only"
          tone="deny"
          items={LOCAL_ONLY.map((id) => CLASS_LABELS[id])}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Routing guards</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(guards).map(([key, on]) => (
              <GuardRow key={key} label={key.replaceAll("_", " ")} on={Boolean(on)} />
            ))}
            <p className="pt-2 text-sm text-muted-foreground">
              Default action: {HARNESS_SPEC.data_policy.default_action}. Unknown
              classes never ride a fallback.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execution policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <GuardRow label="Model may generate code" on={exec.model_may_generate_code} />
            <GuardRow label="Model may generate patch" on={exec.model_may_generate_patch} />
            <GuardRow label="Command execution deny by default" on />
            <GuardRow label="Sandbox required" on={exec.command_execution.sandbox_required} />
            <GuardRow label="Network deny by default" on />
            <GuardRow label="Filesystem workspace only" on />
            <GuardRow label="Secrets access deny by default" on />
            <GuardRow label="Privileged execution deny by default" on />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Human approval</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {HUMAN_APPROVAL_ACTIONS.map((id) => (
              <Badge key={id} variant="outline">
                {ACTION_LABELS[id]}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Target controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(targets).map(([key, on]) => (
              <GuardRow key={key} label={key.replaceAll("_", " ")} on={Boolean(on)} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LaneColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "ok" | "warn" | "deny";
  items: string[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-lg">{title}</CardTitle>
        <Badge variant={tone}>{items.length}</Badge>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item} className="text-sm leading-snug text-muted-foreground">
              {item}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function GuardRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm capitalize">{label}</p>
      <Badge variant={on ? "ok" : "deny"}>{on ? "enforced" : "off"}</Badge>
    </div>
  );
}
