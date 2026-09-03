import type { ProviderId } from "../types.ts";
import { anthropicAdapter } from "./anthropic.server.ts";
import { ollamaAdapter } from "./ollama.server.ts";
import { createOpenAiCompatAdapter } from "./openai-compat.server.ts";
import type { ProviderAdapter } from "./types.ts";

const openaiAdapter = createOpenAiCompatAdapter({
  id: "openai",
  apiKeyEnv: "OPENAI_API_KEY",
  baseUrlEnv: "OPENAI_BASE_URL",
  defaultBaseUrl: "https://api.openai.com/v1",
  maxTokensParam: "max_completion_tokens",
  excludeModels: /embed|whisper|tts|dall-e|moderation|audio|realtime|image|transcribe|babbage|davinci/i,
});

const xaiAdapter = createOpenAiCompatAdapter({
  id: "xai",
  apiKeyEnv: "XAI_API_KEY",
  baseUrlEnv: "XAI_BASE_URL",
  defaultBaseUrl: "https://api.x.ai/v1",
  maxTokensParam: "max_tokens",
  excludeModels: /image/i,
});

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  ollama: ollamaAdapter,
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  xai: xaiAdapter,
};

export function activeAdapters(): ProviderAdapter[] {
  return Object.values(ADAPTERS);
}

export function adapterFor(id: ProviderId): ProviderAdapter {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error(`No provider adapter is registered for ${id}`);
  return adapter;
}
