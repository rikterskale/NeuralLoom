import { PROVIDER_IDS } from "./types.ts";
import type { ModelLocality, ProviderId } from "./types.ts";

// A qualified model reference is "<provider>/<model>", e.g.
// "ollama/kimi-k2.7-code:cloud". Only a registered provider id counts as a
// prefix, so Ollama names that themselves contain slashes (hf.co/user/repo)
// are never mis-split. A bare name is a legacy reference and belongs to Ollama.

export type ModelRef = { provider: ProviderId; model: string };

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  ollama: "Ollama",
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI",
};

export function parseModelRef(ref: string): ModelRef {
  const split = ref.indexOf("/");
  if (split > 0) {
    const prefix = ref.slice(0, split);
    if ((PROVIDER_IDS as readonly string[]).includes(prefix)) {
      return { provider: prefix as ProviderId, model: ref.slice(split + 1) };
    }
  }
  return { provider: "ollama", model: ref };
}

export function formatModelRef(provider: ProviderId, model: string): string {
  return `${provider}/${model}`;
}

export function normalizeModelRef(ref: string): string {
  const parsed = parseModelRef(ref);
  return formatModelRef(parsed.provider, parsed.model);
}

export function providerModelName(ref: string): string {
  return parseModelRef(ref).model;
}

// The Ollama daemon serves cloud models under names tagged :cloud/-cloud; the
// suffix is the only signal /api/tags exposes, so this is the one place that
// interprets it. Every other provider will be unconditionally "cloud".
export function ollamaModelLocality(model: string): ModelLocality {
  return model.endsWith(":cloud") || model.endsWith("-cloud") ? "cloud" : "local";
}

export function modelLocality(ref: string): ModelLocality {
  const parsed = parseModelRef(ref);
  // Every non-Ollama provider is a hosted API: unconditionally cloud, even
  // when a base-URL override points somewhere local. Treating an unknown
  // destination as cloud fails closed for local-only data.
  return parsed.provider === "ollama" ? ollamaModelLocality(parsed.model) : "cloud";
}
