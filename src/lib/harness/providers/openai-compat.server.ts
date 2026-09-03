import { PROVIDER_LABELS } from "../model-ref.ts";
import type { ProviderId } from "../types.ts";
import { assertModelIdentity, publicOrigin, resolveEndpoint } from "./endpoint.server.ts";
import type { CompletionRequest, DiscoveredModel, ModelCompletion, ProviderAdapter } from "./types.ts";

// One adapter covers every service that speaks the OpenAI chat-completions
// dialect: OpenAI itself, xAI (Grok), and any compatible server reached
// through a base-URL override.

export type OpenAiCompatConfig = {
  id: ProviderId;
  apiKeyEnv: string;
  baseUrlEnv: string;
  defaultBaseUrl: string;
  // OpenAI's newer models accept only max_completion_tokens; most compatible
  // servers still speak max_tokens.
  maxTokensParam: "max_tokens" | "max_completion_tokens";
  // /models mixes chat models with embeddings, audio, and image models that
  // can never complete a role task; keep those out of the inventory.
  excludeModels?: RegExp;
};

export function createOpenAiCompatAdapter(config: OpenAiCompatConfig): ProviderAdapter {
  function apiKey(): string {
    const key = process.env[config.apiKeyEnv]?.trim();
    if (!key) throw new Error(`${config.apiKeyEnv} is not configured`);
    return key;
  }

  function endpoint(): URL {
    return resolveEndpoint(config.baseUrlEnv, config.defaultBaseUrl);
  }

  function apiUrl(path: string): URL {
    const base = endpoint();
    return new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base);
  }

  return {
    id: config.id,
    label: PROVIDER_LABELS[config.id],

    configured(): boolean {
      return Boolean(process.env[config.apiKeyEnv]?.trim());
    },

    endpoint(): string | null {
      try {
        return publicOrigin(endpoint());
      } catch {
        return null;
      }
    },

    async listModels(): Promise<DiscoveredModel[]> {
      const response = await fetch(apiUrl("/models"), {
        headers: { accept: "application/json", authorization: `Bearer ${apiKey()}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`${PROVIDER_LABELS[config.id]} discovery returned HTTP ${response.status}`);
      }
      const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
      const models: DiscoveredModel[] = [];
      for (const item of body.data ?? []) {
        if (typeof item.id !== "string" || !item.id) continue;
        if (config.excludeModels?.test(item.id)) continue;
        models.push({ model: item.id, digest: "unverified", locality: "cloud" });
      }
      return models;
    },

    async complete(opts: CompletionRequest): Promise<ModelCompletion> {
      const response = await fetch(apiUrl("/chat/completions"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          temperature: opts.temperature,
          [config.maxTokensParam]: opts.maxTokens,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        throw new Error(`${PROVIDER_LABELS[config.id]} returned HTTP ${response.status}`);
      }
      const body = (await response.json()) as {
        model?: unknown;
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const runtimeModel = typeof body.model === "string" ? body.model : "";
      assertModelIdentity(opts.model, runtimeModel);
      const content = body.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : "";
      if (!text.trim()) {
        throw new Error(`${PROVIDER_LABELS[config.id]} returned an empty response`);
      }
      const prompt = typeof body.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : 0;
      const completion =
        typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : 0;
      return {
        text,
        model: runtimeModel,
        digest: opts.expectedDigest,
        usage: { prompt, completion, total: prompt + completion },
      };
    },
  };
}
