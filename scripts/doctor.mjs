#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const pass = (message) => console.log(`✓ ${message}`);
const fail = (message) => console.error(`✗ ${message}`);
const note = (message) => console.log(`  ${message}`);

export function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split).trim(), line.slice(split + 1).trim()];
      }),
  );
}

function readLocalEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return {};
  return parseEnv(readFileSync(file, "utf8"));
}

export function modelNamesFromSpec(source) {
  return [...new Set(source.match(/[a-z0-9.-]+:[a-z0-9.-]*cloud/g) ?? [])];
}

export function isLoopbackEndpoint(endpoint) {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

export function recommendedModel(models) {
  return models.find((model) => model.includes("flash")) ?? models[0];
}

export function rolePrimaryModelsFromSpec(source) {
  const roles = ["planner", "coder", "repo_agent", "security_specialist", "critic", "fast_triage"];
  const result = {};
  for (const role of roles) {
    const block = source.match(new RegExp(`${role}:\\s*\\{[\\s\\S]*?primary:\\s*"([^"]+)"`));
    // The spec stores qualified "ollama/<model>" references; the daemon and
    // `ollama pull` use the bare name.
    if (block) result[role] = block[1].replace(/^ollama\//, "");
  }
  return result;
}

export function usableTaskRoles(primaryModels, installed) {
  const available = new Set(installed);
  if (!primaryModels.critic || !available.has(primaryModels.critic)) return [];
  return Object.entries(primaryModels)
    .filter(([role, model]) => role !== "critic" && available.has(model))
    .map(([role]) => role);
}

export function hasLocalReviewPath(installed) {
  const localModels = installed.filter(
    (model) => !model.endsWith(":cloud") && !model.endsWith("-cloud"),
  );
  return localModels.length > 0;
}

export const HOSTED_PROVIDERS = [
  ["Anthropic (Claude)", "ANTHROPIC_API_KEY"],
  ["OpenAI (ChatGPT)", "OPENAI_API_KEY"],
  ["xAI (Grok)", "XAI_API_KEY"],
];

export function configuredHostedProviders(env) {
  return HOSTED_PROVIDERS.filter(([, name]) => (env[name] ?? "").trim()).map(([label]) => label);
}

function configuredModels() {
  const source = readFileSync(join(root, "src", "lib", "harness", "spec.ts"), "utf8");
  return modelNamesFromSpec(source);
}

function configuredPrimaryModels() {
  const source = readFileSync(join(root, "src", "lib", "harness", "spec.ts"), "utf8");
  return rolePrimaryModelsFromSpec(source);
}

async function main() {
  console.log("NeuralLoom setup check\n");
  let healthy = true;
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) pass(`Node.js ${process.versions.node}`);
  else {
    fail(`Node.js ${process.versions.node} is too old (22 or newer is required)`);
    healthy = false;
  }

  if (existsSync(join(root, "node_modules"))) pass("Dependencies are installed");
  else {
    fail("Dependencies are not installed");
    note("Run: npm ci");
    healthy = false;
  }

  const localEnv = readLocalEnv();
  const endpoint =
    process.env.OLLAMA_BASE_URL || localEnv.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const localEndpoint = isLoopbackEndpoint(endpoint);
  const ollamaCli = localEndpoint
    ? spawnSync("ollama", ["--version"], { encoding: "utf8", timeout: 2_000 })
    : null;
  let installed = [];
  let ollamaReachable = false;
  try {
    const response = await fetch(new URL("/api/tags", endpoint), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    installed = (body.models ?? []).map((model) => model.name ?? model.model).filter(Boolean);
    ollamaReachable = true;
    pass(`Ollama is reachable at ${new URL(endpoint).origin}`);
  } catch (error) {
    fail(`Ollama is not reachable at ${endpoint}`);
    if (!localEndpoint) {
      note("Check the remote URL, network access, and the Ollama service on that host.");
    } else if (ollamaCli?.error?.code === "ENOENT" || ollamaCli?.status === 127) {
      note("1. Install Ollama: https://ollama.com/download");
      note("2. Open the Ollama app, then run: npm run doctor");
    } else {
      note("Open the Ollama app, or start it with: ollama serve");
      note("Then run: npm run doctor");
    }
    note(`Details: ${error instanceof Error ? error.message : "connection failed"}`);
    healthy = false;
  }

  if (ollamaReachable) {
    const approved = configuredModels().filter((model) => installed.includes(model));
    const primaries = configuredPrimaryModels();
    const usableRoles = usableTaskRoles(primaries, installed);
    const localPath = hasLocalReviewPath(installed);
    if (usableRoles.length || localPath) {
      pass(
        localPath
          ? "At least one local Ollama model is available; a local task-and-critic path can be selected in Models"
          : `${approved.length} approved model${approved.length === 1 ? " is" : "s are"} available; ` +
              `${usableRoles.length} complete task review path${usableRoles.length === 1 ? " is" : "s are"} ready`,
      );
    } else {
      fail("Ollama is running, but no complete task-and-critic review path is available");
      const starter = [primaries.coder, primaries.critic].filter(Boolean);
      note("Choose an installed local model in Models, or configure the recommended Ollama Cloud models.");
      note("1. Sign in or create an account: ollama signin");
      starter.forEach((model, index) =>
        note(`${index + 2}. Add a starter model: ollama pull ${model}`),
      );
      note(`${starter.length + 2}. Run this check again: npm run doctor`);
      healthy = false;
    }
  }

  const hosted = configuredHostedProviders({ ...localEnv, ...process.env });
  if (hosted.length) {
    pass(`Optional AI services with an API key: ${hosted.join(", ")}`);
    note("Their models appear in the Models page after the app starts.");
  }

  console.log(
    healthy
      ? "\nReady. Run: npm run dev"
      : "\nSetup needs attention. Fix the items above and rerun: npm run doctor",
  );
  process.exitCode = healthy ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
