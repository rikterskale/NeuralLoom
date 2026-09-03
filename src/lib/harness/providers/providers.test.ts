import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { modelLocality, parseModelRef } from "../model-ref.ts";
import { anthropicAdapter } from "./anthropic.server.ts";
import { resolveEndpoint } from "./endpoint.server.ts";
import { createOpenAiCompatAdapter } from "./openai-compat.server.ts";
import { activeAdapters, adapterFor } from "./registry.server.ts";

type CapturedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

async function withMockServer(
  respond: (request: CapturedRequest) => { status: number; body: unknown },
  run: (baseUrl: string, requests: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw = `${raw}${chunk}`;
    });
    request.on("end", () => {
      const captured: CapturedRequest = {
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      requests.push(captured);
      const reply = respond(captured);
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withEnv(vars: Record<string, string>, run: () => Promise<void>): Promise<void> {
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function testAdapter() {
  return createOpenAiCompatAdapter({
    id: "openai",
    apiKeyEnv: "TEST_COMPAT_KEY",
    baseUrlEnv: "TEST_COMPAT_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
    maxTokensParam: "max_completion_tokens",
    excludeModels: /embed|whisper/i,
  });
}

test("registry serves an adapter for every provider id", () => {
  const adapters = activeAdapters();
  assert.deepEqual(
    adapters.map((adapter) => adapter.id).sort(),
    ["anthropic", "ollama", "openai", "xai"],
  );
  assert.equal(adapterFor("openai").label, "OpenAI");
  assert.equal(adapterFor("xai").label, "xAI");
});

test("hosted provider refs parse and always count as cloud", () => {
  assert.deepEqual(parseModelRef("anthropic/claude-sonnet-5"), {
    provider: "anthropic",
    model: "claude-sonnet-5",
  });
  assert.equal(modelLocality("anthropic/claude-sonnet-5"), "cloud");
  assert.equal(modelLocality("openai/gpt-5"), "cloud");
  assert.equal(modelLocality("xai/grok-4"), "cloud");
  assert.equal(modelLocality("ollama/llama3.1:8b"), "local");
});

test("an unconfigured hosted provider reports itself and refuses calls", async () => {
  await withEnv({ TEST_COMPAT_KEY: "" }, async () => {
    const adapter = testAdapter();
    assert.equal(adapter.configured(), false);
    await assert.rejects(() => adapter.listModels(), /TEST_COMPAT_KEY is not configured/);
  });
});

test("non-loopback base URLs must use https", async () => {
  await withEnv({ TEST_BASE: "http://api.example.com/v1" }, async () => {
    assert.throws(
      () => resolveEndpoint("TEST_BASE", "https://api.openai.com/v1"),
      /must use https/,
    );
  });
});

test("openai-compat adapter lists models with auth and filters non-chat models", async () => {
  await withMockServer(
    () => ({
      status: 200,
      body: { data: [{ id: "gpt-5" }, { id: "text-embed-4" }, { id: "whisper-2" }] },
    }),
    async (baseUrl, requests) => {
      await withEnv({ TEST_COMPAT_KEY: "test-key", TEST_COMPAT_BASE_URL: `${baseUrl}/v1` }, async () => {
        const models = await testAdapter().listModels();
        assert.deepEqual(
          models.map((model) => model.model),
          ["gpt-5"],
        );
        assert.equal(models[0].locality, "cloud");
        assert.equal(requests[0].path, "/v1/models");
        assert.equal(requests[0].headers.authorization, "Bearer test-key");
      });
    },
  );
});

test("openai-compat adapter sends the configured token parameter and maps usage", async () => {
  await withMockServer(
    () => ({
      status: 200,
      body: {
        model: "gpt-5-2026-01-15",
        choices: [{ message: { content: "hello from the mock" } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      },
    }),
    async (baseUrl, requests) => {
      await withEnv({ TEST_COMPAT_KEY: "test-key", TEST_COMPAT_BASE_URL: `${baseUrl}/v1` }, async () => {
        const completion = await testAdapter().complete({
          model: "gpt-5",
          system: "be brief",
          user: "say hello",
          temperature: 0.1,
          maxTokens: 400,
          expectedDigest: "unverified",
        });
        assert.equal(completion.text, "hello from the mock");
        assert.deepEqual(completion.usage, { prompt: 11, completion: 7, total: 18 });
        const body = requests[0].body as Record<string, unknown>;
        assert.equal(requests[0].path, "/v1/chat/completions");
        assert.equal(body.max_completion_tokens, 400);
        assert.equal(body.max_tokens, undefined);
        assert.equal((body.messages as Array<{ role: string }>)[0].role, "system");
      });
    },
  );
});

test("openai-compat adapter rejects a runtime model that is not the requested one", async () => {
  await withMockServer(
    () => ({
      status: 200,
      body: { model: "gpt-4o-mini", choices: [{ message: { content: "hi" } }] },
    }),
    async (baseUrl) => {
      await withEnv({ TEST_COMPAT_KEY: "test-key", TEST_COMPAT_BASE_URL: `${baseUrl}/v1` }, async () => {
        await assert.rejects(
          () =>
            testAdapter().complete({
              model: "gpt-5",
              system: "s",
              user: "u",
              temperature: 0,
              maxTokens: 10,
              expectedDigest: "unverified",
            }),
          /Model identity mismatch/,
        );
      });
    },
  );
});

test("anthropic adapter speaks the Messages API and maps content blocks", async () => {
  await withMockServer(
    (request) =>
      request.path === "/v1/models?limit=100"
        ? { status: 200, body: { data: [{ id: "claude-sonnet-5" }] } }
        : {
            status: 200,
            body: {
              model: "claude-sonnet-5",
              content: [
                { type: "text", text: "part one " },
                { type: "text", text: "part two" },
              ],
              usage: { input_tokens: 9, output_tokens: 4 },
            },
          },
    async (baseUrl, requests) => {
      await withEnv(
        { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: baseUrl },
        async () => {
          const models = await anthropicAdapter.listModels();
          assert.deepEqual(models.map((model) => model.model), ["claude-sonnet-5"]);

          const completion = await anthropicAdapter.complete({
            model: "claude-sonnet-5",
            system: "be brief",
            user: "say hello",
            temperature: 0.1,
            maxTokens: 400,
            expectedDigest: "unverified",
          });
          assert.equal(completion.text, "part one part two");
          assert.deepEqual(completion.usage, { prompt: 9, completion: 4, total: 13 });

          const call = requests[1];
          const body = call.body as Record<string, unknown>;
          assert.equal(call.path, "/v1/messages");
          assert.equal(call.headers["x-api-key"], "test-key");
          assert.equal(call.headers["anthropic-version"], "2023-06-01");
          assert.equal(body.system, "be brief");
          assert.equal(body.max_tokens, 400);
        },
      );
    },
  );
});
