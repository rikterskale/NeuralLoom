import { ROLE_CATALOG } from "./spec.ts";
import type {
  Classification,
  ModelRecord,
  RoleConfig,
  RoleId,
  RouteDecision,
  TaskRoleId,
} from "./types.ts";

const ROLE_HINTS: { role: TaskRoleId; re: RegExp }[] = [
  {
    role: "security_specialist",
    re: /\b(cve|vulnerab|exploit|poc|payload|threat model|attack path|mitre|red team|offensive)\b/i,
  },
  {
    role: "repo_agent",
    re: /\b(map (the )?repo|symbol|dependenc|cross-file|impact analysis|large.?scale refactor)\b/i,
  },
  {
    role: "planner",
    re: /\b(architect|requirements|implementation plan|system design|threat.?model)\b/i,
  },
  {
    role: "fast_triage",
    re: /\b(triage|summarize (the )?log|which files?|classify this|route this)\b/i,
  },
  {
    role: "coder",
    re: /\b(implement|patch|refactor|write tests?|generate code|cli|api)\b/i,
  },
];

export function autoRole(objective: string): TaskRoleId {
  for (const hint of ROLE_HINTS) {
    if (hint.re.test(objective)) return hint.role;
  }
  return "coder";
}

export function routeRole(opts: {
  requested: TaskRoleId | "auto";
  objective: string;
  classification: Classification;
  inventory: ModelRecord[];
  simulatePrimaryFailure: boolean;
  failClosedWhenPrimaryMissing: boolean;
  preventUnapprovedSubstitution: boolean;
  catalog?: Record<RoleId, RoleConfig>;
}): RouteDecision {
  const role = opts.requested === "auto" ? autoRole(opts.objective) : opts.requested;
  const config = (opts.catalog ?? ROLE_CATALOG)[role];
  const available = new Map(opts.inventory.map((m) => [m.name, m]));
  const localOnly = opts.classification.lane === "local_only";

  if (opts.classification.lane === "unknown") {
    return {
      role,
      selectedModel: null,
      selectedProvider: null,
      candidate: config.primary,
      usedFallback: false,
      fallbackReason: null,
      denied: true,
      denyReason: "block_unknown_data_class — classify before any model call",
    };
  }

  const primary = available.get(config.primary);
  if ((!primary || !primary.available) && !localOnly) {
    if (opts.failClosedWhenPrimaryMissing) {
      return {
        role,
        selectedModel: null,
        selectedProvider: null,
        candidate: config.primary,
        usedFallback: false,
        fallbackReason: null,
        denied: true,
        denyReason: `fail_closed_when_primary_missing — ${config.primary} is not in the discovered inventory`,
      };
    }
  }

  const chain = [config.primary, ...config.fallbacks];
  const startAt = opts.simulatePrimaryFailure || !primary?.available ? 1 : 0;

  for (let i = startAt; i < chain.length; i++) {
    const name = chain[i];
    const rec = available.get(name);
    if (!rec?.available) continue;
    if (localOnly && rec.provider !== "ollama_local") continue;
    if (opts.preventUnapprovedSubstitution && !chain.includes(name)) {
      continue;
    }
    return {
      role,
      selectedModel: name,
      selectedProvider: rec.provider,
      candidate: config.primary,
      usedFallback: i > 0,
      fallbackReason:
        i > 0
          ? opts.simulatePrimaryFailure
            ? `Primary ${config.primary} call failed; approved fallback ${name}`
            : `Primary ${config.primary} unavailable; approved fallback ${name}`
          : null,
      denied: false,
      denyReason: null,
    };
  }

  return {
    role,
    selectedModel: null,
    selectedProvider: null,
    candidate: config.primary,
    usedFallback: startAt > 0,
    fallbackReason: opts.simulatePrimaryFailure ? `Primary ${config.primary} call failed` : null,
    denied: true,
    denyReason:
      localOnly
        ? "Local-only data requires an available local Ollama model for this role."
        : "No approved model in the role chain is available. Unapproved substitution is forbidden.",
  };
}
