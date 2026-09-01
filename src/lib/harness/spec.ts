import type { ModelRecord, RoleConfig, RoleId } from "./types.ts";
import { ROLE_IDS } from "./types.ts";

export const PROMPT_TEMPLATE_VERSION = "neuralloom.role.v1";

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
    primary: "deepseek-v4-pro:0813-cloud",
    fallbacks: ["deepseek-v4-flash:0731-cloud", "qwen3.5:397b-cloud"],
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
    primary: "kimi-k2.7-code:cloud",
    fallbacks: ["glm-5.3:cloud", "qwen3.5:397b-cloud"],
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
    primary: "glm-5.3:cloud",
    fallbacks: ["kimi-k3:cloud", "mistral-large-3:675b-cloud", "qwen3.5:397b-cloud"],
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
    primary: "glm-5.3:cloud",
    fallbacks: ["kimi-k2.7-code:cloud", "qwen3.5:397b-cloud"],
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
    primary: "gemma4:31b-cloud",
    fallbacks: ["qwen3.5:397b-cloud", "mistral-large-3:675b-cloud"],
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
    primary: "deepseek-v4-flash:0731-cloud",
    fallbacks: ["qwen3.5:397b-cloud"],
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

export function allConfiguredModels(): string[] {
  const set = new Set<string>();
  for (const id of ROLE_IDS) {
    const role = ROLE_CATALOG[id];
    set.add(role.primary);
    for (const fb of role.fallbacks) set.add(fb);
  }
  return [...set];
}

export function modelUsage(): Record<string, RoleId[]> {
  const usage: Record<string, RoleId[]> = {};
  for (const id of ROLE_IDS) {
    const role = ROLE_CATALOG[id];
    const names = [role.primary, ...role.fallbacks];
    for (const name of names) {
      usage[name] ??= [];
      if (!usage[name].includes(id)) usage[name].push(id);
    }
  }
  return usage;
}

export function buildInventory(unavailable: string[] = []): ModelRecord[] {
  const usage = modelUsage();
  return allConfiguredModels().map((name) => ({
    name,
    digest: "unverified",
    available: !unavailable.includes(name),
    source: "configured" as const,
    usedBy: usage[name] ?? [],
  }));
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
