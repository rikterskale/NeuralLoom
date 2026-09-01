import type { HarnessRun } from "./types.ts";

const SECRET_VALUE_RE =
  /(-----BEGIN[\s\S]{0,80}?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:sk|xai)-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~+/-]+=*|(?:password|passwd|pwd)\s*[:=]\s*\S+)/gi;

function redactText(value: string | null): string | null {
  return value?.replace(SECRET_VALUE_RE, "[redacted]") ?? null;
}

export function redactRunForAudit(run: HarnessRun): HarnessRun {
  const restricted = run.classification.lane !== "cloud_permitted";
  return {
    ...run,
    title: restricted ? `Restricted ${run.role.replaceAll("_", " ")} run` : redactText(run.title)!,
    objective: restricted
      ? `[content withheld from audit: ${run.classification.lane}]`
      : redactText(run.objective)!,
    plan: restricted ? null : redactText(run.plan),
    patch: restricted ? null : redactText(run.patch),
    output: restricted ? null : redactText(run.output),
    critic: restricted ? null : redactText(run.critic),
  };
}
