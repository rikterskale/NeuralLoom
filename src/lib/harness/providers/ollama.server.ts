import { ollamaModelLocality } from "../model-ref.ts";
import type { CompletionRequest, DiscoveredModel, ModelCompletion, ProviderAdapter } from "./types.ts";

const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";

type OllamaTag = { name?: unknown; model?: unknown; digest?: unknown };

function endpoint(): URL {
  const raw = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_ENDPOINT;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("OLLAMA_BASE_URL must use http or https");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (!loopback && process.env.OLLAMA_ALLOW_REMOTE !== "true") {
    throw new Error("Remote Ollama endpoints require OLLAMA_ALLOW_REMOTE=true");
  }
  return url;
}

export const ollamaAdapter: ProviderAdapter = {
  id: "ollama",
  label: "Ollama",

  configured(): boolean {
    // The local daemon needs no credentials; a bad OLLAMA_BASE_URL surfaces
    // through endpoint()/listModels instead.
    return true;
  },

  endpoint(): string | null {
    try {
      const url = endpoint();
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  },

  async listModels(): Promise<DiscoveredModel[]> {
    const url = endpoint();
    const response = await fetch(new URL("/api/tags", url), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Ollama discovery returned HTTP ${response.status}`);
    const body = (await response.json()) as { models?: OllamaTag[] };
    const models: DiscoveredModel[] = [];
    for (const item of body.models ?? []) {
      const name =
        typeof item.name === "string"
          ? item.name
          : typeof item.model === "string"
            ? item.model
            : null;
      if (!name) continue;
      models.push({
        model: name,
        digest: typeof item.digest === "string" && item.digest ? item.digest : "unverified",
        locality: ollamaModelLocality(name),
      });
    }
    return models;
  },

  async complete(opts: CompletionRequest): Promise<ModelCompletion> {
    const url = endpoint();
    const response = await fetch(new URL("/api/chat", url), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        options: { temperature: opts.temperature, num_predict: opts.maxTokens },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const body = (await response.json()) as {
      model?: unknown;
      message?: { content?: unknown };
      prompt_eval_count?: unknown;
      eval_count?: unknown;
    };
    const runtimeModel = typeof body.model === "string" ? body.model : "";
    if (runtimeModel !== opts.model) {
      throw new Error(
        `Model identity mismatch: expected ${opts.model}, received ${runtimeModel || "unknown"}`,
      );
    }
    const text = typeof body.message?.content === "string" ? body.message.content : "";
    if (!text.trim()) throw new Error("Ollama returned an empty response");
    const prompt = typeof body.prompt_eval_count === "number" ? body.prompt_eval_count : 0;
    const completion = typeof body.eval_count === "number" ? body.eval_count : 0;
    return {
      text,
      model: runtimeModel,
      digest: opts.expectedDigest,
      usage: { prompt, completion, total: prompt + completion },
    };
  },
};
