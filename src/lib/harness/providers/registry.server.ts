import type { ProviderId } from "../types.ts";
import { ollamaAdapter } from "./ollama.server.ts";
import type { ProviderAdapter } from "./types.ts";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  ollama: ollamaAdapter,
};

export function activeAdapters(): ProviderAdapter[] {
  return Object.values(ADAPTERS);
}

export function adapterFor(id: ProviderId): ProviderAdapter {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error(`No provider adapter is registered for ${id}`);
  return adapter;
}
