#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { GROK_EXTENSIONS_SCRIPT_SRC } from "./grok-pwa-shared.mjs";
import { allConfiguredModels, defaultModelSettings } from "../src/lib/harness/spec.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_DIR = process.env.USER_READINESS_ARTIFACT_DIR?.trim()
  ? join(ROOT, process.env.USER_READINESS_ARTIFACT_DIR.trim())
  : join(ROOT, "artifacts", "user-readiness");
const APP_PORT = Number(process.env.USER_READINESS_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const CASE_TIMEOUT_MS = Number(process.env.USER_READINESS_CASE_TIMEOUT_MS || 30_000);
const START_TIMEOUT_MS = Number(process.env.USER_READINESS_START_TIMEOUT_MS || 90_000);

const ROUTES = [
  ["home", "/", "Ask once. NeuralLoom handles the safety checks."],
  ["dispatch", "/dispatch", "What would you like help with?"],
  ["roles", "/roles", "Six threads, one loom."],
  ["safety", "/policy", "Safety is the default."],
  ["checks", "/pipeline", "Nothing lands unreviewed."],
  ["models", "/models", "Choose the AI for each job"],
  ["audit", "/audit", "Every selection is on the record."],
] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

type ReadinessCase = {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
};

type BrowserObservations = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: string[];
};

export type DomAudit = {
  title: string;
  h1Count: number;
  hasMain: boolean;
  duplicateIds: string[];
  unnamedControls: string[];
  imagesWithoutAlt: number;
  horizontalOverflow: boolean;
};

export function domAuditIssues(audit: DomAudit): string[] {
  const issues: string[] = [];
  if (!audit.title.trim()) issues.push("document title is empty");
  if (audit.h1Count !== 1) issues.push(`expected one h1, found ${audit.h1Count}`);
  if (!audit.hasMain) issues.push("main landmark is missing");
  if (audit.duplicateIds.length) issues.push(`duplicate ids: ${audit.duplicateIds.join(", ")}`);
  if (audit.unnamedControls.length) {
    issues.push(`controls without accessible names: ${audit.unnamedControls.join(", ")}`);
  }
  if (audit.imagesWithoutAlt) issues.push(`${audit.imagesWithoutAlt} image(s) have no alt text`);
  if (audit.horizontalOverflow) issues.push("page has horizontal overflow");
  return issues;
}

export function isIgnorableRequestFailure(resourceType: string, message: string): boolean {
  return resourceType === "websocket" || /ERR_ABORTED|NS_BINDING_ABORTED/i.test(message);
}

export function readinessExitCode(cases: ReadinessCase[]): number {
  return cases.length > 0 && cases.every((item) => item.status === "passed") ? 0 : 1;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const startedAt = new Date();
  const cases: ReadinessCase[] = [];
  const mockStats = { tagRequests: 0, chatCalls: [] as Array<{ model: string; critic: boolean }> };
  let mockServer: Server | null = null;
  let appProcess: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let appLog = "";

  const runCase = async (name: string, fn: () => Promise<void>) => {
    const start = Date.now();
    try {
      await fn();
      cases.push({ name, status: "passed", durationMs: Date.now() - start });
      console.log(`✓ ${name}`);
    } catch (cause) {
      const error = safeError(cause);
      cases.push({ name, status: "failed", durationMs: Date.now() - start, error });
      console.error(`✗ ${name}: ${error}`);
    }
  };

  try {
    const mock = await startMockOllama(mockStats);
    mockServer = mock.server;
    const app = startApp(mock.url, (chunk) => {
      appLog = `${appLog}${chunk}`.slice(-20_000);
    });
    appProcess = app;
    await waitForApp(BASE_URL, app, START_TIMEOUT_MS, () => appLog);

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    await context.route(GROK_EXTENSIONS_SCRIPT_SRC, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "/* Platform banner stubbed by the deterministic readiness harness. */",
      });
    });
    context.setDefaultTimeout(Math.min(CASE_TIMEOUT_MS, 15_000));
    context.setDefaultNavigationTimeout(Math.min(CASE_TIMEOUT_MS, 20_000));

    await runCase("all routes render cleanly on desktop and mobile", async () => {
      for (const viewport of VIEWPORTS) {
        const page = await context.newPage();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const observations = monitorPage(page);
        try {
          for (const [slug, path, heading] of ROUTES) {
            const response = await page.goto(`${BASE_URL}${path}`, {
              waitUntil: "domcontentloaded",
            });
            assert.ok(response, `${path} returned no response`);
            assert.ok(response.status() < 400, `${path} returned HTTP ${response.status()}`);
            await page.getByRole("heading", { level: 1, name: heading }).waitFor();
            // SSR headings appear before React finishes hydrating. Waiting here
            // prevents Playwright's screenshot caret-hiding style from racing
            // hydration and creating a false mismatch warning.
            await page.waitForTimeout(500);
            const audit = await collectDomAudit(page);
            assert.deepEqual(domAuditIssues(audit), [], `${path} failed DOM readiness checks`);
            await page.screenshot({
              path: join(ARTIFACT_DIR, `${viewport.name}-${slug}.png`),
              fullPage: false,
            });
          }
          assertBrowserHealth(observations);
        } catch (cause) {
          await safeScreenshot(page, `${viewport.name}-route-failure.png`);
          throw cause;
        } finally {
          await page.close();
        }
      }
    });

    await runCase("PWA install surface and environment contract are healthy", async () => {
      const manifestResponse = await fetch(`${BASE_URL}/__grok/manifest.webmanifest`);
      assert.equal(manifestResponse.status, 200);
      const manifest = (await manifestResponse.json()) as {
        name?: string;
        short_name?: string;
        icons?: unknown[];
      };
      assert.ok(manifest.name);
      assert.ok(manifest.short_name);
      assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);

      const envResponse = await fetch(`${BASE_URL}/__app-env`);
      assert.equal(envResponse.status, 200);
      const env = (await envResponse.json()) as { VITE_AUTH_ENABLED?: string };
      assert.equal(env.VITE_AUTH_ENABLED, "false");

      await withPage(context, "install-surface", async (page) => {
        const response = await page.goto(`${BASE_URL}/?install=1&platform=ios`, {
          waitUntil: "domcontentloaded",
        });
        assert.ok(response && response.status() < 400);
        await page
          .getByRole("heading", { name: "Open this link on your iPhone or iPad" })
          .waitFor();
        await page.getByRole("link", { name: /Open .*App/ }).waitFor();
      });
    });

    await runCase("mobile navigation and keyboard entry points work", async () => {
      await withPage(context, "mobile-navigation", async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
        await waitForInteractive(page);
        await page.keyboard.press("Tab");
        assert.equal(await page.locator(":focus").innerText(), "Skip to content");
        await page.getByRole("button", { name: "Open menu" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await dialog.getByText("Navigate", { exact: true }).waitFor();
        await dialog.getByRole("link", { name: "Models" }).click();
        await page.getByRole("heading", { level: 1, name: "Choose the AI for each job" }).waitFor();
        await page.getByRole("button", { name: "More" }).waitFor();
      });
    });

    await runCase("model choices validate, save, test, and persist", async () => {
      await withPage(context, "model-settings", async (page) => {
        const chatsBefore = mockStats.chatCalls.length;
        await page.goto(`${BASE_URL}/models`, { waitUntil: "domcontentloaded" });
        await page.getByText("Everything is ready", { exact: true }).waitFor();
        await waitForInteractive(page);

        const selected = new Map<string, string>();
        for (const role of [
          "planner",
          "coder",
          "repo_agent",
          "security_specialist",
          "critic",
          "fast_triage",
        ]) {
          const select = page.locator(`#model-${role}`);
          assert.ok((await select.locator("option").count()) >= 2, `${role} has no alternatives`);
          await select.selectOption({ index: 1 });
          selected.set(role, await select.inputValue());
        }
        await page.getByText("You have unsaved choices", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Save choices and test" }).click();
        await page.getByText("Your AI choices are saved and ready.", { exact: true }).waitFor();
        assert.equal(
          mockStats.chatCalls.length,
          chatsBefore,
          "readiness test made an AI chat call",
        );

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByText("Everything is ready", { exact: true }).waitFor();
        for (const [role, value] of selected) {
          assert.equal(await page.locator(`#model-${role}`).inputValue(), value);
        }

        await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
        await page
          .getByRole("link", { name: new RegExp(`Coder ${escapeRegex(selected.get("coder")!)}`) })
          .waitFor();
        await page.goto(`${BASE_URL}/roles`, { waitUntil: "domcontentloaded" });
        assert.ok(
          await page.getByText(selected.get("critic")!, { exact: true }).first().isVisible(),
        );

        await page.goto(`${BASE_URL}/models`, { waitUntil: "domcontentloaded" });
        await page.getByText("Everything is ready", { exact: true }).waitFor();
        await waitForInteractive(page);
        await page.getByRole("button", { name: "Use recommended setup" }).click();
        await page.getByText("You have unsaved choices", { exact: true }).waitFor();
        const defaults = defaultModelSettings();
        for (const [role, value] of Object.entries(defaults)) {
          assert.equal(await page.locator(`#model-${role}`).inputValue(), value);
        }
        await page.getByRole("button", { name: "Save choices and test" }).click();
        await page
          .getByText("You have unsaved choices", { exact: true })
          .waitFor({ state: "hidden" });
        for (const [role, value] of Object.entries(defaults)) {
          assert.equal(await page.locator(`#model-${role}`).inputValue(), value);
        }
      });
    });

    await runCase("reviewed public task completes through author and critic", async () => {
      await withPage(context, "public-task", async (page) => {
        const chatsBefore = mockStats.chatCalls.length;
        await page.goto(`${BASE_URL}/dispatch`, { waitUntil: "domcontentloaded" });
        await page.getByText("Review path ready", { exact: true }).waitFor();
        const review = page.getByRole("button", { name: "Review this task" });
        assert.equal(await review.isDisabled(), true);
        await page
          .getByLabel("What should the AI do?")
          .fill(
            "Review this public example repository and suggest one maintainability improvement.",
          );
        await page.getByLabel(/Short name/).fill("CI public review");
        await page.getByRole("button", { name: /Public or example material/ }).click();
        assert.equal(await review.isEnabled(), true);
        await review.click();
        await page.getByRole("heading", { name: "Result" }).waitFor();
        await page.getByText("Needs acceptance", { exact: true }).waitFor();
        await page.getByText("Plan", { exact: true }).waitFor();
        await page.getByText("Critic", { exact: true }).waitFor();
        assert.equal(mockStats.chatCalls.length, chatsBefore + 2);
        assert.deepEqual(
          mockStats.chatCalls.slice(-2).map((call) => call.critic),
          [false, true],
        );
      });
    });

    await runCase("authorization, approval, and local-only refusal gates work", async () => {
      await withPage(context, "safety-gates", async (page) => {
        await page.goto(`${BASE_URL}/dispatch`, { waitUntil: "domcontentloaded" });
        await page.getByText("Review path ready", { exact: true }).waitFor();
        await page
          .getByLabel("What should the AI do?")
          .fill("Review this synthetic company example for maintainability.");
        await page.getByRole("button", { name: /Company or client material/ }).click();
        const review = page.getByRole("button", { name: "Review this task" });
        assert.equal(await review.isDisabled(), true);
        await page
          .getByRole("checkbox", {
            name: "I am authorized to send this material to the configured AI provider.",
          })
          .check();
        assert.equal(await review.isEnabled(), true);

        await page.locator("summary", { hasText: "Advanced options" }).click();
        await page.getByRole("checkbox", { name: "Outbound network" }).check();
        await page.getByRole("checkbox", { name: "I approve this action" }).check();
        await page.getByRole("switch", { name: "Target is on the allowlist" }).check();
        await page.getByRole("switch", { name: "Authorization record is on file" }).check();

        const chatsBefore = mockStats.chatCalls.length;
        await page.goto(`${BASE_URL}/dispatch`, { waitUntil: "domcontentloaded" });
        await page.getByText("Review path ready", { exact: true }).waitFor();
        await page
          .getByLabel("What should the AI do?")
          .fill("Explain why this made-up credential example must stay local.");
        await page.getByRole("button", { name: /Credentials or live evidence/ }).click();
        const refusal = page.getByRole("button", { name: "Record a safe refusal" });
        assert.equal(await refusal.isEnabled(), true);
        await refusal.click();
        await page.getByRole("heading", { name: "Result" }).waitFor();
        await page.getByText("Blocked", { exact: true }).waitFor();
        assert.equal(
          mockStats.chatCalls.length,
          chatsBefore,
          "local-only task reached the AI mock",
        );
      });
    });

    await runCase("audit records, filters, details, and deletion work", async () => {
      await withPage(context, "audit-lifecycle", async (page) => {
        await page.goto(`${BASE_URL}/audit`, { waitUntil: "domcontentloaded" });
        await page.getByText("CI public review", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Blocked", exact: true }).click();
        const restricted = page.getByText("Restricted coder run", { exact: true });
        await restricted.waitFor();
        await restricted.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("Local only", { exact: true }).waitFor();
        assert.equal(await dialog.locator("pre").count(), 0, "restricted audit exposed content");
        await dialog.getByRole("button", { name: "Close" }).click();

        for (const filter of ["All", "Accepted", "Blocked", "Approval", "Failed"]) {
          await page.getByRole("button", { name: filter, exact: true }).click();
        }
        await page.getByRole("button", { name: "All", exact: true }).click();
        await page.getByRole("button", { name: "Clear log", exact: true }).click();
        const confirm = page.getByRole("dialog", { name: "Clear the audit log?" });
        await confirm.getByRole("button", { name: "Clear log" }).click();
        await page.getByText("Audit log cleared.", { exact: true }).waitFor();
        await page.getByText("No tasks match this filter yet.", { exact: true }).waitFor();
      });
    });

    await context.close();
  } catch (cause) {
    cases.push({
      name: "readiness harness bootstrap",
      status: "failed",
      durationMs: 0,
      error: safeError(cause),
    });
    console.error(`✗ readiness harness bootstrap: ${safeError(cause)}`);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopChild(appProcess);
    await closeServer(mockServer);

    const finishedAt = new Date();
    const report = {
      ok: readinessExitCode(cases) === 0,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      baseUrl: BASE_URL,
      cases,
      mockOllama: {
        tagRequests: mockStats.tagRequests,
        chatCalls: mockStats.chatCalls,
      },
      appLogTail: appLog.slice(-4_000),
    };
    writeFileSync(join(ARTIFACT_DIR, "report.json"), JSON.stringify(report, null, 2));
    writeGitHubSummary(report);
    console.log(
      `User readiness: ${cases.filter((item) => item.status === "passed").length}/${cases.length} checks passed`,
    );
    process.exitCode = readinessExitCode(cases);
  }
}

async function withPage(
  context: BrowserContext,
  artifactName: string,
  action: (page: Page) => Promise<void>,
) {
  const page = await context.newPage();
  const observations = monitorPage(page);
  try {
    await action(page);
    assertBrowserHealth(observations);
  } catch (cause) {
    await safeScreenshot(page, `${artifactName}-failure.png`);
    throw cause;
  } finally {
    await page.close();
  }
}

function monitorPage(page: Page): BrowserObservations {
  const observations: BrowserObservations = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") observations.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => observations.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const message = request.failure()?.errorText ?? "request failed";
    if (!isIgnorableRequestFailure(request.resourceType(), message)) {
      observations.failedRequests.push(`${request.method()} ${request.url()}: ${message}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      observations.badResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  return observations;
}

function assertBrowserHealth(observations: BrowserObservations) {
  assert.deepEqual(observations.consoleErrors, [], "browser console errors detected");
  assert.deepEqual(observations.pageErrors, [], "uncaught page errors detected");
  assert.deepEqual(observations.failedRequests, [], "browser requests failed");
  assert.deepEqual(observations.badResponses, [], "browser received HTTP error responses");
}

async function collectDomAudit(page: Page): Promise<DomAudit> {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id);
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const accessibleName = (element: HTMLElement) => {
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel) return ariaLabel;
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }
      if (element.id) {
        const label = document.querySelector<HTMLLabelElement>(
          `label[for="${CSS.escape(element.id)}"]`,
        );
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const parentLabel = element.closest("label")?.textContent?.trim();
      if (parentLabel) return parentLabel;
      return element.textContent?.trim() || element.getAttribute("title")?.trim() || "";
    };
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="switch"], [role="checkbox"]',
      ),
    ];
    const unnamedControls = controls
      .filter(visible)
      .filter((element) => !accessibleName(element))
      .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`);
    const root = document.documentElement;
    return {
      title: document.title,
      h1Count: document.querySelectorAll("h1").length,
      hasMain: Boolean(document.querySelector("main")),
      duplicateIds: duplicates,
      unnamedControls,
      imagesWithoutAlt: document.querySelectorAll("img:not([alt])").length,
      horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
    };
  });
}

async function startMockOllama(stats: {
  tagRequests: number;
  chatCalls: Array<{ model: string; critic: boolean }>;
}) {
  const models = allConfiguredModels();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/tags") {
      stats.tagRequests += 1;
      json(response, 200, {
        models: models.map((name, index) => ({
          name,
          model: name,
          digest: `sha256:user-readiness-${String(index).padStart(2, "0")}`,
        })),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body = `${body}${chunk}`.slice(0, 100_000);
      });
      request.on("end", () => {
        try {
          const payload = JSON.parse(body) as {
            model?: unknown;
            messages?: Array<{ role?: unknown; content?: unknown }>;
          };
          assert.equal(typeof payload.model, "string");
          assert.ok(models.includes(payload.model));
          const system = String(payload.messages?.[0]?.content ?? "");
          const critic = /did not write the artifact|independent/i.test(system);
          stats.chatCalls.push({ model: payload.model, critic });
          const content = critic
            ? JSON.stringify({ findings: [], accept: true, notes: "Synthetic CI review passed." })
            : JSON.stringify({
                plan: [
                  "Inspect the synthetic example and identify one maintainability improvement.",
                  "Explain the change without modifying the repository.",
                ],
                patch: null,
                notes: "Synthetic readiness response; no patch required.",
              });
          json(response, 200, {
            model: payload.model,
            message: { role: "assistant", content },
            prompt_eval_count: 24,
            eval_count: 32,
          });
        } catch (cause) {
          json(response, 400, { error: safeError(cause) });
        }
      });
      return;
    }
    json(response, 404, { error: "not found" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function startApp(mockUrl: string, onOutput: (text: string) => void): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(APP_PORT),
      "--strictPort",
    ],
    {
      cwd: ROOT,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        VITE_AUTH_ENABLED: "false",
        OLLAMA_BASE_URL: mockUrl,
        OLLAMA_ALLOW_REMOTE: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", onOutput);
  child.stderr?.on("data", onOutput);
  return child;
}

async function waitForApp(url: string, child: ChildProcess, timeoutMs: number, log: () => string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`app server exited with ${child.exitCode}\n${log().slice(-2_000)}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
    } catch {
      // Keep polling while Vite and the embedded database start.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`app server did not become ready within ${timeoutMs}ms\n${log().slice(-2_000)}`);
}

async function safeScreenshot(page: Page, name: string) {
  try {
    await page.screenshot({ path: join(ARTIFACT_DIR, name), fullPage: true });
  } catch {
    // Preserve the original failure when the page itself is already gone.
  }
}

async function stopChild(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function closeServer(server: Server | null) {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function safeError(cause: unknown): string {
  return (cause instanceof Error ? cause.stack || cause.message : String(cause)).slice(0, 4_000);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForInteractive(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

function writeGitHubSummary(report: {
  ok: boolean;
  durationMs: number;
  cases: ReadinessCase[];
  mockOllama: { tagRequests: number; chatCalls: Array<unknown> };
}) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const rows = report.cases
    .map(
      (item) =>
        `| ${item.status === "passed" ? "✅" : "❌"} | ${item.name} | ${(item.durationMs / 1000).toFixed(1)}s | ${item.error ? item.error.split("\n")[0].replaceAll("|", "\\|") : ""} |`,
    )
    .join("\n");
  appendFileSync(
    path,
    [
      "## NeuralLoom user readiness",
      "",
      report.ok ? "**Ready for users.**" : "**User readiness failed.**",
      "",
      "| Result | Check | Time | Detail |",
      "|---|---|---:|---|",
      rows,
      "",
      `Synthetic Ollama checks: ${report.mockOllama.tagRequests} readiness probe(s), ${report.mockOllama.chatCalls.length} reviewed model call(s).`,
      `Total time: ${(report.durationMs / 1000).toFixed(1)}s.`,
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
