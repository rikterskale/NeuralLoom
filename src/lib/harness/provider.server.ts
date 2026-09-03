import { formatModelRef, modelLocality, parseModelRef } from "./model-ref";
import { activeAdapters, adapterFor } from "./providers/registry.server";
import type { ModelCompletion } from "./providers/types";
import { allConfiguredModels, modelUsage, roleModelsFromCatalog, ROLE_CATALOG } from "./spec";
import type {
  ModelDiscovery,
  ModelLocality,
  ModelRecord,
  ProviderId,
  ProviderStatus,
  RoleConfig,
  RoleId,
} from "./types";

export type { ModelCompletion } from "./providers/types";

const DISCOVERY_TTL_MS = 60 * 60 * 1000;

type FoundModel = { digest: string; locality: ModelLocality };
type ProviderCacheEntry = {
  at: number;
  found: Map<string, FoundModel>;
  status: ProviderStatus;
};

const globalProvider = globalThis as typeof globalThis & {
  __neuralLoomProviderDiscovery__?: Map<ProviderId, ProviderCacheEntry>;
};

function cache(): Map<ProviderId, ProviderCacheEntry> {
  globalProvider.__neuralLoomProviderDiscovery__ ??= new Map();
  return globalProvider.__neuralLoomProviderDiscovery__;
}

// One provider being down or misconfigured must never block the others: each
// adapter is queried independently and failures land in its ProviderStatus.
async function discoverProvider(force: boolean, id: ProviderId): Promise<ProviderCacheEntry> {
  const cached = cache().get(id);
  if (!force && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached;

  const adapter = adapterFor(id);
  const found = new Map<string, FoundModel>();
  let error: string | null = null;
  // An unconfigured provider is a normal state (no API key), reported through
  // the configured flag; error is reserved for a configured provider failing.
  if (adapter.configured()) {
    try {
      for (const model of await adapter.listModels()) {
        found.set(formatModelRef(id, model.model), {
          digest: model.digest,
          locality: model.locality,
        });
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Model discovery failed";
    }
  }

  const entry: ProviderCacheEntry = {
    at: Date.now(),
    found,
    status: {
      id,
      label: adapter.label,
      configured: adapter.configured(),
      endpoint: adapter.endpoint(),
      error,
    },
  };
  cache().set(id, entry);
  return entry;
}

export async function discoverModels(
  force = false,
  catalog: Record<RoleId, RoleConfig> = ROLE_CATALOG,
): Promise<ModelDiscovery> {
  const entries = await Promise.all(
    activeAdapters().map((adapter) => discoverProvider(force, adapter.id)),
  );
  const providers = entries.map((entry) => entry.status);
  const found = new Map<string, FoundModel>();
  for (const entry of entries) {
    for (const [ref, model] of entry.found) found.set(ref, model);
  }

  const usage = modelUsage(catalog);
  const names = [...new Set([...allConfiguredModels(catalog), ...found.keys()])];
  const inventory: ModelRecord[] = names.map((name) => {
    const record = found.get(name);
    return {
      name,
      digest: record?.digest ?? "unavailable",
      available: Boolean(record),
      provider: parseModelRef(name).provider,
      locality: record?.locality ?? modelLocality(name),
      source: record ? ("discovered" as const) : ("configured" as const),
      usedBy: usage[name] ?? [],
    };
  });

  const ollama = providers.find((provider) => provider.id === "ollama");
  return {
    inventory,
    roleModels: roleModelsFromCatalog(catalog),
    discoveredAt: new Date().toISOString(),
    providers,
    endpoint: ollama?.endpoint ?? "",
    error: ollama?.error ?? null,
  };
}

export async function completeModel(opts: {
  ref: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  expectedDigest: string;
}): Promise<ModelCompletion> {
  const { provider, model } = parseModelRef(opts.ref);
  const completion = await adapterFor(provider).complete({
    model,
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    expectedDigest: opts.expectedDigest,
  });
  return { ...completion, model: formatModelRef(provider, completion.model) };
}
