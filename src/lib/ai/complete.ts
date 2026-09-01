import { createServerFn } from "@tanstack/react-start";
import { detectSecrets } from "@/lib/harness/classify";

type CompleteInput = {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
};

type CompleteOk = {
  ok: true;
  text: string;
  model: string;
  usage: { prompt: number; completion: number; total: number };
};

type CompleteErr = { ok: false; error: string };

export const completeRole = createServerFn({ method: "POST" })
  .validator((input: CompleteInput) => input)
  .handler(async ({ data }): Promise<CompleteOk | CompleteErr> => {
    const leaked = detectSecrets(`${data.system}\n${data.user}`);
    if (leaked.length) {
      return {
        ok: false,
        error: `Server gate refused the call — local-only class detected (${leaked.join(", ")}).`,
      };
    }

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "AI is not available in this environment." };
    }

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: data.temperature,
        max_tokens: data.maxTokens,
        messages: [
          { role: "system", content: data.system },
          { role: "user", content: data.user },
        ],
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `Model transport error ${res.status}` };
    }

    const body = (await res.json()) as {
      model?: string;
      choices: { message: { content: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const text = body.choices[0]?.message.content ?? "";
    const prompt = body.usage?.prompt_tokens ?? 0;
    const completion = body.usage?.completion_tokens ?? 0;
    return {
      ok: true,
      text,
      model: body.model ?? "grok-4.5",
      usage: {
        prompt,
        completion,
        total: body.usage?.total_tokens ?? prompt + completion,
      },
    };
  });
