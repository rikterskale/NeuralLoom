import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { detectSecrets } from "./classify";
import { deleteRuns, readRuns, saveRun } from "./audit.server";
import { parseCriticVerdict } from "./critic";
import { evaluateDispatch, materializeRun } from "./engine";
import { readModelSettings, writeModelSettings } from "./model-settings.server";
import { criticSystemPrompt, roleSystemPrompt } from "./prompts";
import { callOllama, discoverModels, type ModelCompletion } from "./provider.server";
import { catalogForModelSettings, parseModelSettings, ROLE_CATALOG } from "./spec";
import type {
  AuditEvent,
  DispatchInput,
  DispatchResult,
  HarnessRun,
  ModelDiscovery,
  ModelRecord,
  ModelSettingsResult,
  RoleConfig,
  RoleId,
} from "./types";
import { ROLE_IDS } from "./types";
import { validateDispatchInput } from "./validation";
import { assembleVerification, parseStructured } from "./verify";
import { verifyArtifact } from "./workspace-checks.server";

export const getModelDiscovery = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ModelDiscovery> => {
    const settings = await readModelSettings(context.userId);
    return discoverModels(false, catalogForModelSettings(settings));
  });

export const refreshModelDiscovery = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ModelDiscovery> => {
    const settings = await readModelSettings(context.userId);
    return discoverModels(true, catalogForModelSettings(settings));
  });

export const saveAndTestModelSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((value: unknown) => parseModelSettings(value))
  .handler(async ({ data, context }): Promise<ModelSettingsResult> => {
    const settings = await writeModelSettings(context.userId, data);
    const discovery = await discoverModels(true, catalogForModelSettings(settings));
    const available = new Set(
      discovery.inventory.filter((model) => model.available).map((model) => model.name),
    );
    return {
      settings,
      discovery,
      savedAt: new Date().toISOString(),
      checks: ROLE_IDS.map((role) => ({
        role,
        model: settings[role],
        compatible: true,
        available: available.has(settings[role]),
        message: available.has(settings[role])
          ? "Ready to use"
          : discovery.error
            ? "NeuralLoom cannot reach Ollama yet"
            : "This model still needs to be added in Ollama",
      })),
    };
  });

export const listHarnessRuns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<HarnessRun[]> => readRuns(context.userId));

export const clearHarnessRuns = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    await deleteRuns(context.userId);
    return { ok: true };
  });

export const dispatchHarnessRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((value: unknown) => validateDispatchInput(value))
  .handler(async ({ data, context }): Promise<DispatchResult> => {
    const settings = await readModelSettings(context.userId);
    const catalog = catalogForModelSettings(settings);
    const discovery = await discoverModels(false, catalog);
    const snapshot = evaluateDispatch(data, discovery.inventory, catalog);
    let run = materializeRun(snapshot);
    run = setDiscoveredDigest(run, discovery.inventory);

    // Audit persistence is part of the safety boundary. If it is unavailable,
    // do not make a model call that cannot be put on the record.
    await saveRun(context.userId, run);
    if (!snapshot.canCallModel) return { run };

    try {
      const primary = await completeRoleWithFallback({
        role: run.role,
        inventory: discovery.inventory,
        firstModel: run.route.selectedModel,
        simulatePrimaryFailure: data.simulatePrimaryFailure,
        system: roleSystemPrompt(run.role),
        user: buildUserPrompt(run, data),
        maxTokens: run.role === "fast_triage" ? 500 : 900,
        catalog,
      });
      run = applyActualRoute(run, primary);

      const parsed = parseStructured(primary.completion.text);
      const outputSecrets = detectSecrets(primary.completion.text);
      if (outputSecrets.length) {
        throw new Error(
          `Generated output matched local-only data classes: ${outputSecrets.join(", ")}`,
        );
      }

      const critic = await completeRoleWithFallback({
        role: "critic",
        inventory: discovery.inventory,
        firstModel: catalog.critic.primary,
        simulatePrimaryFailure: false,
        system: criticSystemPrompt(),
        user: `Review this ${run.role} artifact.\n\n${primary.completion.text}`,
        maxTokens: 500,
        catalog,
      });
      const verdict = parseCriticVerdict(critic.completion.text);
      const checks = await verifyArtifact({
        plan: parsed.plan,
        patch: parsed.patch,
        output: primary.completion.text,
      });
      const verification = assembleVerification({
        plan: parsed.plan,
        patch: parsed.patch,
        output: primary.completion.text,
        critic: critic.completion.text,
        criticAccepted: verdict.accepted,
        checks,
        offensiveRequested: data.requestedActions.some((action) =>
          [
            "exploit_execution",
            "credential_operations",
            "authentication_testing",
            "persistence_testing",
            "lateral_movement_testing",
          ].includes(action),
        ),
        targetAllowlisted: data.targetAllowlisted,
        operatorAcceptedLab: data.operatorAcceptedLab,
      });
      const hasFailedCheck = checks.some((check) => check.status === "fail");
      const status = verification.accepted
        ? "accepted"
        : verdict.accepted && !hasFailedCheck
          ? "needs_acceptance"
          : "rejected";
      const usage = addUsage(primary.completion, critic.completion);
      run = {
        ...run,
        status,
        runtimeModel: primary.completion.model,
        modelDigest: primary.completion.digest,
        tokenUsage: usage,
        plan: parsed.plan,
        patch: parsed.patch,
        output: primary.completion.text,
        critic: critic.completion.text,
        verification,
        operatorAccepted: data.operatorAcceptedLab,
        events: [
          ...run.events,
          audit("model_call", `Called verified model ${primary.completion.model}`, {
            promptTokens: primary.completion.usage.prompt,
            completionTokens: primary.completion.usage.completion,
          }),
          audit(
            "critic",
            verdict.accepted ? "Structured critic accepted" : "Structured critic rejected",
            { parsed: verdict.parsed, findings: verdict.findings.length },
          ),
          audit(
            "verify",
            verification.accepted
              ? "All required checks passed"
              : verification.notes.join("; ") || "Verification incomplete",
          ),
        ],
      };
    } catch (cause) {
      const message = safeError(cause);
      run = {
        ...run,
        status: "failed",
        events: [...run.events, audit("model_call", message)],
      };
    }

    await saveRun(context.userId, run);
    return { run };
  });

type CompletionRoute = {
  completion: ModelCompletion;
  selectedModel: string;
  fallbackReason: string | null;
};

async function completeRoleWithFallback(opts: {
  role: RoleId;
  inventory: ModelRecord[];
  firstModel: string | null;
  simulatePrimaryFailure: boolean;
  system: string;
  user: string;
  maxTokens: number;
  catalog?: Record<RoleId, RoleConfig>;
}): Promise<CompletionRoute> {
  const config = (opts.catalog ?? ROLE_CATALOG)[opts.role];
  const records = new Map(opts.inventory.map((model) => [model.name, model]));
  if (!records.get(config.primary)?.available) {
    throw new Error(`Required primary model ${config.primary} was not discovered`);
  }
  const approved = [config.primary, ...config.fallbacks];
  const initial =
    opts.firstModel && approved.includes(opts.firstModel) ? approved.indexOf(opts.firstModel) : 0;
  let lastError = "model call failed";
  for (let index = initial; index < approved.length; index += 1) {
    const model = approved[index];
    const record = records.get(model);
    if (!record?.available) continue;
    if (opts.simulatePrimaryFailure && index === 0) {
      lastError = `Primary ${model} failure simulated`;
      continue;
    }
    try {
      const completion = await callOllama({
        model,
        expectedDigest: record.digest,
        system: opts.system,
        user: opts.user,
        temperature: config.temperature,
        maxTokens: opts.maxTokens,
      });
      return {
        completion,
        selectedModel: model,
        fallbackReason: index > 0 ? `${lastError}; used approved fallback ${model}` : null,
      };
    } catch (cause) {
      lastError = safeError(cause);
    }
  }
  throw new Error(`No approved ${config.label} model completed the request: ${lastError}`);
}

function buildUserPrompt(run: HarnessRun, input: DispatchInput): string {
  return [
    `Title: ${run.title}`,
    `Objective:\n${input.objective}`,
    `Context slices: ${input.contextIncludes.join(", ") || "none"}`,
    `Data classes: ${run.classification.classes.join(", ")}`,
  ].join("\n\n");
}

function setDiscoveredDigest(run: HarnessRun, inventory: ModelRecord[]): HarnessRun {
  const record = inventory.find((model) => model.name === run.route.selectedModel);
  return { ...run, modelDigest: record?.digest ?? null };
}

function applyActualRoute(run: HarnessRun, result: CompletionRoute): HarnessRun {
  if (!result.fallbackReason) return run;
  return {
    ...run,
    intendedModel: result.selectedModel,
    modelTag: result.selectedModel,
    fallbackReason: result.fallbackReason,
    route: {
      ...run.route,
      selectedModel: result.selectedModel,
      usedFallback: true,
      fallbackReason: result.fallbackReason,
    },
    events: [
      ...run.events,
      audit("fallback", result.fallbackReason, { model: result.selectedModel }),
    ],
  };
}

function addUsage(first: ModelCompletion, second: ModelCompletion) {
  const prompt = first.usage.prompt + second.usage.prompt;
  const completion = first.usage.completion + second.usage.completion;
  return { prompt, completion, total: prompt + completion };
}

function audit(
  kind: AuditEvent["kind"],
  summary: string,
  fields?: AuditEvent["fields"],
): AuditEvent {
  return { at: new Date().toISOString(), kind, summary, fields };
}

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Operation failed";
  return message.replace(/https?:\/\/[^\s]+/g, "configured endpoint").slice(0, 400);
}
