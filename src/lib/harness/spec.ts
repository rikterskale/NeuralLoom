import { modelLocality, normalizeModelRef, parseModelRef } from "./model-ref.ts";
import type {
  ModelRecord,
  ModelSettings,
  RoleConfig,
  RoleId,
  TaskRoleId,
} from "./types.ts";
import { ROLE_IDS, TASK_ROLE_IDS } from "./types.ts";

export const PROMPT_TEMPLATE_VERSION = "neuralloom.role.v2";

export const HARNESS_SPEC = {
  cloud_primary: {
    provider: "ollama_cloud",
    transport: "local_ollama_daemon",
    endpoint: "http://127.0.0.1:11434",
    model_discovery: {
      enabled: true,
      check_at_startup: true,
      refresh_interval_minutes: 60,
      fail_closed_when_primary_missing: true,
      prevent_unapproved_model_substitution: true,
    },
  },
  data_policy: {
    default_action: "deny_by_default" as const,
    routing_guards: {
      classify_before_model_call: true,
      preserve_data_class_across_fallbacks: true,
      never_fallback_local_only_data_to_cloud: true,
      block_unknown_data_class: true,
      require_redaction_verification: true,
    },
  },
  execution_policy: {
    model_may_generate_code: true,
    model_may_generate_patch: true,
    command_execution: {
      default: "deny_by_default" as const,
      sandbox_required: true,
      network_access: "deny_by_default" as const,
      filesystem_access: "workspace_only" as const,
      secrets_access: "deny_by_default" as const,
      privileged_execution: "deny_by_default" as const,
    },
    target_controls: {
      authorization_record_required: true,
      allowlist_required: true,
      denylist_enforced: true,
      scope_expiration_enforced: true,
      private_and_reserved_ranges_denied_unless_allowlisted: true,
    },
  },
  verification_pipeline: {
    require_structured_plan: true,
    require_patch_not_full_overwrite: true,
    require_critic_review: true,
    offensive_validation: {
      environment: "isolated_authorized_lab" as const,
      prohibit_unapproved_external_targets: true,
      capture_commands_and_outputs: true,
      preserve_evidence: true,
      require_operator_acceptance: true,
    },
  },
  repository_context: {
    strategy: "indexed_selective_context" as const,
  },
} as const;

export const ROLE_CATALOG: Record<RoleId, RoleConfig> = {
  planner: {
    id: "planner",
    label: "Planner",
    primary: "ollama/deepseek-v4-pro:0813-cloud",
    fallbacks: ["ollama/deepseek-v4-flash:0731-cloud", "ollama/qwen3.5:397b-cloud"],
    think: "high",
    temperature: 0.15,
    responsibilities: [
      "requirements_analysis",
      "system_architecture",
      "implementation_planning",
      "threat_modeling",
      "attack_path_reasoning",
      "cross_component_debugging",
    ],
  },
  coder: {
    id: "coder",
    label: "Coder",
    primary: "ollama/kimi-k2.7-code:cloud",
    fallbacks: ["ollama/glm-5.3:cloud", "ollama/qwen3.5:397b-cloud"],
    think: "high",
    temperature: 0.15,
    responsibilities: [
      "code_generation",
      "multi_file_edits",
      "refactoring",
      "test_generation",
      "cli_and_api_implementation",
      "infrastructure_code",
      "security_tooling",
    ],
  },
  repo_agent: {
    id: "repo_agent",
    label: "Repo agent",
    primary: "ollama/glm-5.3:cloud",
    fallbacks: ["ollama/kimi-k3:cloud", "ollama/mistral-large-3:675b-cloud", "ollama/qwen3.5:397b-cloud"],
    think: "max",
    temperature: 0.1,
    responsibilities: [
      "repository_mapping",
      "symbol_and_dependency_analysis",
      "cross_file_impact_analysis",
      "large_scale_refactoring",
      "issue_resolution",
      "documentation_traceability",
      "integration_validation",
    ],
  },
  security_specialist: {
    id: "security_specialist",
    label: "Security specialist",
    primary: "ollama/glm-5.3:cloud",
    fallbacks: ["ollama/kimi-k2.7-code:cloud", "ollama/qwen3.5:397b-cloud"],
    think: "max",
    temperature: 0.1,
    responsibilities: [
      "vulnerability_research",
      "secure_and_offensive_code_review",
      "exploitability_analysis",
      "prerequisite_validation",
      "synthetic_lab_poc_development",
      "detection_and_mitigation_review",
    ],
  },
  critic: {
    id: "critic",
    label: "Critic",
    primary: "ollama/gemma4:31b-cloud",
    fallbacks: ["ollama/qwen3.5:397b-cloud", "ollama/mistral-large-3:675b-cloud"],
    think: "high",
    temperature: 0.1,
    responsibilities: [
      "independent_diff_review",
      "correctness_review",
      "security_review",
      "architecture_review",
      "documentation_review",
      "hallucination_detection",
      "test_gap_analysis",
    ],
  },
  fast_triage: {
    id: "fast_triage",
    label: "Fast triage",
    primary: "ollama/deepseek-v4-flash:0731-cloud",
    fallbacks: ["ollama/qwen3.5:397b-cloud"],
    think: "low",
    temperature: 0.1,
    responsibilities: [
      "issue_classification",
      "log_summarization",
      "file_selection",
      "simple_code_questions",
      "routing_decisions",
    ],
  },
};

export type ModelChoice = {
  name: string;
  label: string;
  description: string;
};


export const MODEL_CHOICES: Record<RoleId, ModelChoice[]> = {
  planner: [
    {
      name: "ollama/deepseek-v4-pro:0813-cloud",
      label: "Recommended",
      description: "Best for careful plans and difficult decisions.",
    },
    {
      name: "ollama/deepseek-v4-flash:0731-cloud",
      label: "Faster",
      description: "Quicker answers for everyday planning.",
    },
    {
      name: "ollama/qwen3.5:397b-cloud",
      label: "Alternative",
      description: "A strong general-purpose backup.",
    },
  ],
  coder: [
    {
      name: "ollama/kimi-k2.7-code:cloud",
      label: "Recommended",
      description: "Best balance for writing and reviewing code.",
    },
    {
      name: "ollama/glm-5.3:cloud",
      label: "More thorough",
      description: "Useful for larger or more complex changes.",
    },
    {
      name: "ollama/qwen3.5:397b-cloud",
      label: "Alternative",
      description: "A strong general-purpose backup.",
    },
  ],
  repo_agent: [
    {
      name: "ollama/glm-5.3:cloud",
      label: "Recommended",
      description: "Best for understanding a whole project.",
    },
    {
      name: "ollama/kimi-k3:cloud",
      label: "Faster",
      description: "Good for quicker project-wide questions.",
    },
    {
      name: "ollama/mistral-large-3:675b-cloud",
      label: "More thorough",
      description: "Good for deep project analysis.",
    },
    {
      name: "ollama/qwen3.5:397b-cloud",
      label: "Alternative",
      description: "A strong general-purpose backup.",
    },
  ],
  security_specialist: [
    {
      name: "ollama/glm-5.3:cloud",
      label: "Recommended",
      description: "Best for careful security review.",
    },
    {
      name: "ollama/kimi-k2.7-code:cloud",
      label: "Code focused",
      description: "Best when the security task is mostly code.",
    },
    {
      name: "ollama/qwen3.5:397b-cloud",
      label: "Alternative",
      description: "A strong general-purpose backup.",
    },
  ],
  critic: [
    {
      name: "ollama/gemma4:31b-cloud",
      label: "Recommended",
      description: "Independent second opinion for every task.",
    },
    {
      name: "ollama/qwen3.5:397b-cloud",
      label: "Faster",
      description: "A quicker independent review.",
    },
    {
      name: "ollama/mistral-large-3:675b-cloud",
      label: "More thorough",
      description: "A deeper independent review.",
    },
  ],
  fast_triage: [
    {
      name: "ollama/deepseek-v4-flash:0731-cloud",
      label: "Recommended",
      description: "Fastest choice for sorting and summarizing.",
    },
    {
      name: "ollama/qwen3.5:397b-cloud",
      label: "Alternative",
      description: "A strong general-purpose backup.",
    },
  ],
};

export function defaultModelSettings(): ModelSettings {
  return Object.fromEntries(ROLE_IDS.map((id) => [id, ROLE_CATALOG[id].primary])) as ModelSettings;
}

// A role may use a curated choice or any model the configured providers
// actually discovered — local or cloud. Anything else stays rejected, so the
// approved set is always something the user explicitly picked from inventory.
export function parseModelSettings(
  value: unknown,
  discoveredModels: Iterable<string> = [],
): ModelSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Choose one model for every role.");
  }
  const raw = value as Record<string, unknown>;
  const discovered = new Set(discoveredModels);
  const settings = {} as ModelSettings;
  for (const id of ROLE_IDS) {
    const model = raw[id];
    if (
      typeof model !== "string" ||
      (!MODEL_CHOICES[id].some((choice) => choice.name === model) && !discovered.has(model))
    ) {
      throw new Error(`The selected model does not work with ${ROLE_CATALOG[id].label}.`);
    }
    settings[id] = model;
  }
  return settings;
}

export function parsePersistedModelSettings(value: unknown): ModelSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Saved model settings are invalid.");
  }
  const raw = value as Record<string, unknown>;
  const settings = {} as ModelSettings;
  for (const id of ROLE_IDS) {
    const model = raw[id];
    if (typeof model !== "string" || !model.trim()) {
      throw new Error("Saved model settings are invalid.");
    }
    // Settings saved before qualified references used bare Ollama names.
    settings[id] = normalizeModelRef(model);
  }
  return settings;
}

export function catalogForModelSettings(settings: ModelSettings): Record<RoleId, RoleConfig> {
  return Object.fromEntries(
    ROLE_IDS.map((id) => {
      const primary = settings[id];
      const fallbacks = MODEL_CHOICES[id]
        .map((choice) => choice.name)
        .filter((name) => name !== primary);
      return [id, { ...ROLE_CATALOG[id], primary, fallbacks }];
    }),
  ) as Record<RoleId, RoleConfig>;
}

export function roleModelsFromCatalog(catalog: Record<RoleId, RoleConfig>): ModelSettings {
  return Object.fromEntries(ROLE_IDS.map((id) => [id, catalog[id].primary])) as ModelSettings;
}

export function allConfiguredModels(catalog: Record<RoleId, RoleConfig> = ROLE_CATALOG): string[] {
  const set = new Set<string>();
  for (const id of ROLE_IDS) {
    const role = catalog[id];
    set.add(role.primary);
    for (const fb of role.fallbacks) set.add(fb);
  }
  return [...set];
}

export function modelUsage(
  catalog: Record<RoleId, RoleConfig> = ROLE_CATALOG,
): Record<string, RoleId[]> {
  const usage: Record<string, RoleId[]> = {};
  for (const id of ROLE_IDS) {
    const role = catalog[id];
    const names = [role.primary, ...role.fallbacks];
    for (const name of names) {
      usage[name] ??= [];
      if (!usage[name].includes(id)) usage[name].push(id);
    }
  }
  return usage;
}

export function buildInventory(
  unavailable: string[] = [],
  catalog: Record<RoleId, RoleConfig> = ROLE_CATALOG,
): ModelRecord[] {
  const usage = modelUsage(catalog);
  return allConfiguredModels(catalog).map((name) => ({
    name,
    digest: "unverified",
    available: !unavailable.includes(name),
    provider: parseModelRef(name).provider,
    locality: modelLocality(name),
    source: "configured" as const,
    usedBy: usage[name] ?? [],
  }));
}

export function readyTaskRoles(
  inventory: ModelRecord[],
  settings: ModelSettings = defaultModelSettings(),
): TaskRoleId[] {
  const available = new Set(
    inventory.filter((model) => model.available).map((model) => model.name),
  );
  if (!available.has(settings.critic)) return [];
  return TASK_ROLE_IDS.filter((id) => available.has(settings[id]));
}

export function roleReadiness(
  role: TaskRoleId,
  inventory: ModelRecord[],
  settings: ModelSettings = defaultModelSettings(),
) {
  const available = new Set(
    inventory.filter((model) => model.available).map((model) => model.name),
  );
  return {
    roleReady: available.has(settings[role]),
    criticReady: available.has(settings.critic),
  };
}

export function digestFor(_name: string): string {
  return "unverified";
}

export const ROLE_BLURBS: Record<RoleId, string> = {
  planner:
    "Holds the architecture thread. Plans, threat-models, and traces failure across components before anyone writes code.",
  coder: "Weaves patches. Multi-file edits, tests, CLIs, and security tooling at low temperature.",
  repo_agent:
    "Maps the mill. Symbols, dependencies, impact, and large refactors with max thinking.",
  security_specialist:
    "Tests the cloth. Vulnerability research, exploitability, and lab-only proof work.",
  critic: "Independent review. Correctness, security, architecture, hallucination, and test gaps.",
  fast_triage:
    "The first pass. Classify, summarize, pick files, and route without burning the heavy models.",
};
