import { PROVIDER_LABELS } from "../model-ref.ts";
import { assertModelIdentity, publicOrigin, resolveEndpoint } from "./endpoint.server.ts";
import type { CompletionRequest, DiscoveredModel, ModelCompletion, ProviderAdapter } from "./types.ts";

// Anthropic's Messages API differs from the OpenAI dialect: the system prompt
// is a top-level field, max_tokens is required, and content comes back as a
// list of typed blocks.

const API_VERSION = "2023-06-01";

function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  return key;
}

function endpoint(): URL {
  return resolveEndpoint("ANTHROPIC_BASE_URL", "https://api.anthropic.com");
}

function headers(): Record<string, string> {
  return {
    accept: "application/json",
    "x-api-key": apiKey(),
    "anthropic-version": API_VERSION,
  };
}

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: PROVIDER_LABELS.anthropic,

  configured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  },

  endpoint(): string | null {
    try {
      return publicOrigin(endpoint());
    } catch {
      return null;
    }
  },

  async listModels(): Promise<DiscoveredModel[]> {
    const response = await fetch(new URL("/v1/models?limit=100", endpoint()), {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Anthropic discovery returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models: DiscoveredModel[] = [];
    for (const item of body.data ?? []) {
      if (typeof item.id !== "string" || !item.id) continue;
      models.push({ model: item.id, digest: "unverified", locality: "cloud" });
    }
    return models;
  },

  async complete(opts: CompletionRequest): Promise<ModelCompletion> {
    const response = await fetch(new URL("/v1/messages", endpoint()), {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`Anthropic returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      model?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    const runtimeModel = typeof body.model === "string" ? body.model : "";
    assertModelIdentity(opts.model, runtimeModel);
    const text = (body.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    if (!text.trim()) throw new Error("Anthropic returned an empty response");
    const prompt = typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : 0;
    const completion =
      typeof body.usage?.output_tokens === "number" ? body.usage.output_tokens : 0;
    return {
      text,
      model: runtimeModel,
      digest: opts.expectedDigest,
      usage: { prompt, completion, total: prompt + completion },
    };
  },
};
