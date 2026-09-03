import type { ModelLocality, ProviderId } from "../types.ts";

// Adapters speak provider-native model names; qualified "<provider>/<model>"
// references exist only above this layer.

export type DiscoveredModel = {
  model: string;
  digest: string;
  locality: ModelLocality;
};

export type CompletionRequest = {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  expectedDigest: string;
};

export type ModelCompletion = {
  text: string;
  model: string;
  digest: string;
  usage: { prompt: number; completion: number; total: number };
};

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  // Whether the provider has what it needs to accept calls (endpoint, API
  // key). Reachability is reported separately, as a listModels failure.
  configured(): boolean;
  // Public origin for display; null when the configured endpoint is invalid.
  endpoint(): string | null;
  listModels(): Promise<DiscoveredModel[]>;
  complete(request: CompletionRequest): Promise<ModelCompletion>;
};
