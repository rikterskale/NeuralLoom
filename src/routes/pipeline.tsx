import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatClass } from "@/lib/harness/labels";
import { HARNESS_SPEC } from "@/lib/harness/spec";
import {
  CONTEXT_EXCLUDE,
  CONTEXT_INCLUDE,
  DETERMINISTIC_CHECKS,
} from "@/lib/harness/types";

export const Route = createFileRoute("/pipeline")({ component: PipelinePage });

const STAGES = [
  {
    title: "Structured plan",
    body: "The selected role must return a plan before a patch. Free-form dumps fail the gate.",
  },
  {
    title: "Patch, not overwrite",
    body: "Unified diffs only. A full-file dump is treated as unsafe and rejected.",
  },
  {
    title: "Critic review",
    body: "An independent critic model reviews correctness, security, architecture, hallucination, and test gaps.",
  },
  {
    title: "Deterministic checks",
    body: "Formatter, linter, types, tests, coverage, static security, dependency audit, secret scan, license.",
  },
  {
    title: "Offensive validation",
    body: "Isolated authorized lab only. Unapproved external targets are prohibited. Evidence is preserved.",
  },
  {
    title: "Operator acceptance",
    body: "Lab proofs do not land without an operator signature on the captured commands and output.",
  },
];

function PipelinePage() {
  const offensive = HARNESS_SPEC.verification_pipeline.offensive_validation;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="Verification"
        title="Nothing lands unreviewed."
        description="A weave is only accepted when the plan, patch, critic, and deterministic gates all pass. Offensive work stays in an isolated lab."
      />

      <ol className="mb-10 space-y-3">
        {STAGES.map((stage, i) => (
          <li
            key={stage.title}
            className="flex gap-4 rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]"
          >
            <span className="font-display text-3xl leading-none text-muted-foreground tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 className="font-medium">{stage.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {stage.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Deterministic checks</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {DETERMINISTIC_CHECKS.map((id) => (
              <Badge key={id} variant="outline">
                {formatClass(id)}
              </Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Offensive validation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Environment: {formatClass(offensive.environment)}</p>
            <p>Unapproved external targets: prohibited</p>
            <p>Capture commands and outputs: required</p>
            <p>Preserve evidence: required</p>
            <p>Operator acceptance: required</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Context include</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {CONTEXT_INCLUDE.map((id) => (
              <Badge key={id} variant="muted">
                {formatClass(id)}
              </Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Exclude by default</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {CONTEXT_EXCLUDE.map((id) => (
              <Badge key={id} variant="deny">
                {formatClass(id)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
