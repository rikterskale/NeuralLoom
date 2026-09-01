import { allConfiguredModels, modelUsage } from "./spec";
import type { ModelDiscovery, ModelRecord } from "./types";

const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

type OllamaTag = { name?: unknown; model?: unknown; digest?: unknown };
type DiscoveryCache = { at: number; value: ModelDiscovery };

const globalProvider = globalThis as typeof globalThis & {
  __neuralLoomDiscovery__?: DiscoveryCache;
};

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

function publicEndpoint(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

export async function discoverModels(force = false): Promise<ModelDiscovery> {
  const cached = globalProvider.__neuralLoomDiscovery__;
  if (!force && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;

  const url = endpoint();
  const usage = modelUsage();
  const configured = allConfiguredModels();
  let inventory: ModelRecord[] = configured.map((name) => ({
    name,
    digest: "unavailable",
    available: false,
    source: "configured",
    usedBy: usage[name] ?? [],
  }));
  let error: string | null = null;

  try {
    const response = await fetch(new URL("/api/tags", url), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Ollama discovery returned HTTP ${response.status}`);
    const body = (await response.json()) as { models?: OllamaTag[] };
    const found = new Map<string, { digest: string }>();
    for (const item of body.models ?? []) {
      const name =
        typeof item.name === "string"
          ? item.name
          : typeof item.model === "string"
            ? item.model
            : null;
      if (!name) continue;
      found.set(name, {
        digest: typeof item.digest === "string" && item.digest ? item.digest : "unverified",
      });
    }
    inventory = configured.map((name) => ({
      name,
      digest: found.get(name)?.digest ?? "unavailable",
      available: found.has(name),
      source: found.has(name) ? "discovered" : "configured",
      usedBy: usage[name] ?? [],
    }));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Model discovery failed";
  }

  const value: ModelDiscovery = {
    inventory,
    discoveredAt: new Date().toISOString(),
    provider: "ollama",
    endpoint: publicEndpoint(url),
    error,
  };
  globalProvider.__neuralLoomDiscovery__ = { at: Date.now(), value };
  return value;
}

export type ModelCompletion = {
  text: string;
  model: string;
  digest: string;
  usage: { prompt: number; completion: number; total: number };
};

export async function callOllama(opts: {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  expectedDigest: string;
}): Promise<ModelCompletion> {
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
}
