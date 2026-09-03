import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("../src/lib/harness/api.ts", import.meta.url), "utf8");
const provider = readFileSync(
  new URL("../src/lib/harness/providers/ollama.server.ts", import.meta.url),
  "utf8",
);

test("every harness server function uses verified auth middleware", () => {
  const declarations = api.match(/createServerFn\(\{ method: "(?:GET|POST)" \}\)/g) ?? [];
  const middleware = api.match(/\.middleware\(\[authMiddleware\]\)/g) ?? [];
  assert.ok(declarations.length >= 4);
  assert.equal(middleware.length, declarations.length);
});

test("dispatch validates input and persists before checking call permission", () => {
  assert.match(api, /validator\(\(value: unknown\) => validateDispatchInput\(value\)\)/);
  assert.ok(
    api.indexOf("await saveRun(context.userId, run)") < api.indexOf("if (!snapshot.canCallModel)"),
  );
});

test("provider sends the routed model and rejects a runtime mismatch", () => {
  assert.match(provider, /model: opts\.model/);
  assert.match(provider, /runtimeModel !== opts\.model/);
  assert.match(provider, /Remote Ollama endpoints require OLLAMA_ALLOW_REMOTE=true/);
});

test("hosted provider adapters verify model identity and refuse plaintext keys off-box", () => {
  const endpointHelper = readFileSync(
    new URL("../src/lib/harness/providers/endpoint.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(endpointHelper, /must use https for non-loopback endpoints/);
  assert.match(endpointHelper, /Model identity mismatch/);
  for (const file of ["anthropic.server.ts", "openai-compat.server.ts"]) {
    const source = readFileSync(
      new URL(`../src/lib/harness/providers/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /assertModelIdentity\(opts\.model, runtimeModel\)/);
    assert.match(source, /resolveEndpoint\(/);
  }
});

test("the old raw completion endpoint is absent", () => {
  assert.throws(() => readFileSync(new URL("../src/lib/ai/complete.ts", import.meta.url), "utf8"));
});
