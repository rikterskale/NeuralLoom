import {
  allConfiguredModels,
  modelProvider,
  modelUsage,
  roleModelsFromCatalog,
  ROLE_CATALOG,
} from "./spec";
import type { ModelDiscovery, ModelRecord, RoleConfig, RoleId } from "./types";

const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

type OllamaTag = { name?: unknown; model?: unknown; digest?: unknown };
type DiscoveryCache = {
  at: number;
  found: Map<string, { digest: string }>;
  error: string | null;
  endpoint: string;
};

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

export async function discoverModels(
  force = false,
  catalog: Record<RoleId, RoleConfig> = ROLE_CATALOG,
): Promise<ModelDiscovery> {
  const cached = globalProvider.__neuralLoomDiscovery__;
  if (!force && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) {
    return buildDiscovery(catalog, cached.found, cached.error, cached.endpoint, cached.at);
  }

  const url = endpoint();
  let found = new Map<string, { digest: string }>();
  let error: string | null = null;

  try {
    const response = await fetch(new URL("/api/tags", url), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Ollama discovery returned HTTP ${response.status}`);
    const body = (await response.json()) as { models?: OllamaTag[] };
    found = new Map<string, { digest: string }>();
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
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Model discovery failed";
  }

  const publicUrl = publicEndpoint(url);
  globalProvider.__neuralLoomDiscovery__ = {
    at: Date.now(),
    found,
    error,
    endpoint: publicUrl,
  };
  return buildDiscovery(catalog, found, error, publicUrl, Date.now());
}

function buildDiscovery(
  catalog: Record<RoleId, RoleConfig>,
  found: Map<string, { digest: string }>,
  error: string | null,
  endpointUrl: string,
  discoveredAt: number,
): ModelDiscovery {
  const usage = modelUsage(catalog);
  const names = [...new Set([...allConfiguredModels(catalog), ...found.keys()])];
  const inventory: ModelRecord[] = names.map((name) => ({
    name,
    digest: found.get(name)?.digest ?? "unavailable",
    available: found.has(name),
    provider: modelProvider(name),
    source: found.has(name) ? "discovered" : "configured",
    usedBy: usage[name] ?? [],
  }));
  return {
    inventory,
    roleModels: roleModelsFromCatalog(catalog),
    discoveredAt: new Date(discoveredAt).toISOString(),
    provider: "ollama",
    endpoint: endpointUrl,
    error,
  };
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
