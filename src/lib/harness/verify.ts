import { DETERMINISTIC_CHECKS, type CheckResult, type VerificationResult } from "./types.ts";

const SECRET_RE =
  /\b(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)\b/;

const DANGEROUS_RE =
  /\b(eval\(|new Function\(|child_process|rm -rf \/|Invoke-Mimikatz|dangerouslySetInnerHTML)\b/;

export function parseStructured(text: string): {
  plan: string | null;
  patch: string | null;
  notes: string | null;
  raw: string;
} {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const blob = fence?.[1] ?? text.match(/\{[\s\S]*"plan"[\s\S]*\}/)?.[0];
  if (!blob) {
    const patch = extractPatch(text);
    return { plan: null, patch, notes: null, raw: text };
  }
  try {
    const parsed = JSON.parse(blob) as {
      plan?: unknown;
      patch?: unknown;
      notes?: unknown;
    };
    const plan =
      typeof parsed.plan === "string"
        ? parsed.plan
        : Array.isArray(parsed.plan)
          ? parsed.plan.map(String).join("\n")
          : null;
    const patch = typeof parsed.patch === "string" ? parsed.patch : extractPatch(text);
    const notes = typeof parsed.notes === "string" ? parsed.notes : null;
    return { plan, patch, notes, raw: text };
  } catch {
    return { plan: null, patch: extractPatch(text), notes: null, raw: text };
  }
}

export function extractPatch(text: string): string | null {
  const unified = text.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
  if (unified?.[1]?.includes("@@") || unified?.[1]?.startsWith("diff ")) {
    return unified[1].trim();
  }
  if (text.includes("\n@@ ") || text.startsWith("diff --git")) {
    const start = text.indexOf("diff --git");
    return text.slice(start === -1 ? text.indexOf("@@") : start).trim();
  }
  return null;
}

export function looksLikeFullOverwrite(patch: string | null, output: string): boolean {
  if (!patch) {
    const lines = output.split("\n").length;
    return lines > 80 && !output.includes("@@");
  }
  if (patch.includes("*** Add File:") && !patch.includes("@@")) return true;
  const plus = patch.split("\n").filter((l) => l.startsWith("+")).length;
  const minus = patch.split("\n").filter((l) => l.startsWith("-")).length;
  return plus > 200 && minus < 5;
}

export function runDeterministicChecks(opts: {
  output: string;
  patch: string | null;
  plan: string | null;
}): CheckResult[] {
  const body = `${opts.plan ?? ""}\n${opts.patch ?? ""}\n${opts.output}`;
  return DETERMINISTIC_CHECKS.map((id) => checkOne(id, body, opts));
}

function checkOne(
  id: CheckResult["id"],
  body: string,
  opts: { output: string; patch: string | null; plan: string | null },
): CheckResult {
  switch (id) {
    case "secret_scan":
      return SECRET_RE.test(body)
        ? fail(id, "Secret-like material in model output")
        : pass(id, "No secret patterns in output");
    case "static_security_analysis":
      return DANGEROUS_RE.test(body)
        ? fail(id, "Dangerous primitive or destructive command in output")
        : pass(id, "No high-risk primitives detected");
    case "formatter": {
      const mixed = /^\t/m.test(opts.output) && /^ {2}/m.test(opts.output);
      return mixed ? fail(id, "Mixed tabs and spaces") : pass(id, "Indentation consistent");
    }
    case "linter": {
      const unbalanced =
        (opts.output.match(/\{/g)?.length ?? 0) - (opts.output.match(/\}/g)?.length ?? 0);
      return Math.abs(unbalanced) > 3
        ? fail(id, "Unbalanced braces in generated text")
        : pass(id, "No obvious syntax imbalance");
    }
    case "license_check":
      return /\b(gpl-3|agpl|commons clause)\b/i.test(body)
        ? fail(id, "Copyleft or restricted license marker in output")
        : pass(id, "No restricted license markers");
    case "type_checker":
      return skip(id, "No workspace typecheck attached to this run");
    case "unit_tests":
      return skip(id, "No unit test runner attached to this run");
    case "integration_tests":
      return skip(id, "No integration runner attached to this run");
    case "coverage_gate":
      return skip(id, "No coverage artifact attached to this run");
    case "dependency_audit":
      return skip(id, "No lockfile attached to this run");
  }
}

export function assembleVerification(opts: {
  plan: string | null;
  patch: string | null;
  output: string;
  critic: string | null;
  criticAccepted?: boolean;
  checks?: CheckResult[];
  offensiveRequested: boolean;
  targetAllowlisted: boolean;
  operatorAcceptedLab: boolean;
}): VerificationResult {
  const structuredPlan = Boolean(opts.plan && opts.plan.trim().length > 12);
  const patchNotFullOverwrite = !looksLikeFullOverwrite(opts.patch, opts.output);
  const criticReview = Boolean(opts.critic && opts.critic.trim().length > 12);
  const criticAccepted = criticReview && opts.criticAccepted === true;
  const checks = opts.checks ?? runDeterministicChecks(opts);
  const blockedExternalTarget = opts.offensiveRequested && !opts.targetAllowlisted;
  const checkFails = checks.some((c) => c.status === "fail");
  const requiredChecksPassed = checks.every((c) => c.status === "pass");
  const notes: string[] = [];
  if (!structuredPlan) notes.push("require_structured_plan — no usable plan");
  if (!patchNotFullOverwrite) {
    notes.push("require_patch_not_full_overwrite — output looks like a full dump");
  }
  if (!criticReview) notes.push("require_critic_review — critic produced no review");
  else if (!criticAccepted) notes.push("critic rejected the artifact");
  if (!requiredChecksPassed) {
    notes.push("required deterministic checks did not all pass");
  }
  if (blockedExternalTarget) {
    notes.push("prohibit_unapproved_external_targets");
  }
  if (opts.offensiveRequested && !opts.operatorAcceptedLab) {
    notes.push("require_operator_acceptance — lab validation not accepted");
  }

  const accepted =
    structuredPlan &&
    patchNotFullOverwrite &&
    criticReview &&
    criticAccepted &&
    requiredChecksPassed &&
    !checkFails &&
    !blockedExternalTarget &&
    (!opts.offensiveRequested || opts.operatorAcceptedLab);

  return {
    structuredPlan,
    patchNotFullOverwrite,
    criticReview,
    criticAccepted,
    requiredChecksPassed,
    checks,
    offensive: {
      environment: "isolated_authorized_lab",
      blockedExternalTarget,
    },
    accepted,
    notes,
  };
}

function pass(id: CheckResult["id"], detail: string): CheckResult {
  return { id, status: "pass", detail };
}
function fail(id: CheckResult["id"], detail: string): CheckResult {
  return { id, status: "fail", detail };
}
function skip(id: CheckResult["id"], detail: string): CheckResult {
  return { id, status: "skip", detail };
}
