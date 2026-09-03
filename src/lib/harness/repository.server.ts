import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, opendir, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, delimiter, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { devNull, tmpdir } from "node:os";
import type { ContextInclude, RepositorySource, RepositorySummary } from "./types.ts";

const DEFAULT_MAX_FILES = 80;
const DEFAULT_MAX_BYTES = 96_000;
const DEFAULT_MAX_FILE_BYTES = 128_000;
const ALWAYS_IGNORED = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".tanstack",
  ".vercel",
  "coverage",
]);
const SECRET_BASENAME_RE = /^(?:\.env(?:\..*)?|\.git-credentials|\.netrc|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\..*)?|gradle\.properties|kubeconfig|secrets?\..*)$/i;
const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".dll",
  ".doc",
  ".docx",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".obj",
  ".pdf",
  ".pem",
  ".pfx",
  ".png",
  ".pyc",
  ".so",
  ".tar",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

export type RepositoryConfig = {
  enabled: boolean;
  roots: string[];
  hosts: string[];
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  tempRoot: string;
};

export type PreparedRepository = {
  root: string;
  source: RepositorySource;
  summary: RepositorySummary;
  context: string;
  cleanup: () => Promise<void>;
};

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

export function loadRepositoryConfig(env: NodeJS.ProcessEnv = process.env): RepositoryConfig {
  return {
    enabled: env.NEURALLOOM_REPOSITORY_ENABLED === "true",
    roots: (env.NEURALLOOM_REPOSITORY_ROOTS || process.cwd())
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => resolve(entry)),
    hosts: (env.NEURALLOOM_REPOSITORY_HOSTS || "github.com")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    maxFiles: boundedNumber(env.NEURALLOOM_REPOSITORY_MAX_FILES, DEFAULT_MAX_FILES, 1, 500),
    maxBytes: boundedNumber(env.NEURALLOOM_REPOSITORY_MAX_BYTES, DEFAULT_MAX_BYTES, 4_096, 500_000),
    maxFileBytes: boundedNumber(
      env.NEURALLOOM_REPOSITORY_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES,
      1_024,
      1_000_000,
    ),
    tempRoot: resolve(env.NEURALLOOM_REPOSITORY_TEMP_ROOT || tmpdir()),
  };
}

export async function prepareRepository(
  source: RepositorySource,
  objective: string,
  includes: ContextInclude[],
  taggedPublic: boolean,
  config: RepositoryConfig = loadRepositoryConfig(),
): Promise<PreparedRepository | null> {
  if (source.kind === "none") return null;
  assertLocalAutomationMode();
  if (!config.enabled) {
    throw new Error("Repository automation is disabled. Set NEURALLOOM_REPOSITORY_ENABLED=true deliberately.");
  }

  let root: string;
  let cleanup = async () => {};
  if (source.kind === "local") {
    root = await resolveAllowedLocalRoot(source.location, config);
  } else {
    if (!taggedPublic) {
      throw new Error("Repository URL fetching is limited to tasks classified as public repositories.");
    }
    const url = validateRepositoryUrl(source.location, config.hosts);
    const clonePlan = repositoryClonePlan(url);
    const temp = await mkdtemp(join(config.tempRoot, "neuralloom-repo-"));
    cleanup = async () => rm(temp, { recursive: true, force: true });
    try {
      const clone = await runGit(
        [
          "-c",
          "credential.helper=",
          "-c",
          "http.followRedirects=false",
          "-c",
          "protocol.file.allow=never",
          "clone",
          "--depth",
          "1",
          "--no-tags",
          "--single-branch",
          "--",
          clonePlan.url,
          temp,
        ],
        process.cwd(),
        60_000,
      );
      if (clone.code !== 0) throw new Error(`Repository fetch failed: ${clone.stderr || "git clone failed"}`);
      if (clonePlan.ref) {
        const fetched = await runGit(
          ["-c", "credential.helper=", "fetch", "--depth", "1", "origin", clonePlan.ref],
          temp,
          60_000,
        );
        if (fetched.code !== 0) throw new Error(`Pull request fetch failed: ${fetched.stderr || "git fetch failed"}`);
        const checkedOut = await runGit(["checkout", "--detach", "FETCH_HEAD"], temp, 15_000);
        if (checkedOut.code !== 0) throw new Error("Fetched pull request revision could not be checked out.");
      }
      root = temp;
    } catch (cause) {
      await cleanup().catch(() => {});
      throw cause;
    }
  }

  try {
    const indexed = await indexRepository(root, objective, includes, config);
    const revisionResult = await runGit(["rev-parse", "HEAD"], root, 10_000);
    const revision = revisionResult.code === 0 ? revisionResult.stdout.trim() : null;
    return {
      root,
      source,
      context: indexed.context,
      summary: {
        kind: source.kind,
        display: source.kind === "local" ? basename(root) : new URL(source.location).pathname.replace(/^\//, ""),
        revision,
        indexedFiles: indexed.files,
        indexedBytes: indexed.bytes,
        truncated: indexed.truncated,
        mutable: source.kind === "local",
      },
      cleanup,
    };
  } catch (cause) {
    await cleanup().catch(() => {});
    throw cause;
  }
}

export async function resolveAllowedLocalRoot(
  location: string,
  config: RepositoryConfig = loadRepositoryConfig(),
): Promise<string> {
  if (!isAbsolute(location)) throw new Error("Local repository paths must be absolute.");
  const candidate = await realpath(location);
  const info = await stat(candidate);
  if (!info.isDirectory()) throw new Error("Local repository source must be a directory.");
  const allowed = await Promise.all(
    config.roots.map(async (root) => realpath(root).catch(() => resolve(root))),
  );
  if (!allowed.some((root) => isWithin(root, candidate))) {
    throw new Error("Local repository is outside NEURALLOOM_REPOSITORY_ROOTS.");
  }
  return candidate;
}

export function validateRepositoryUrl(location: string, allowedHosts: string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    throw new Error("Repository URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    throw new Error("Repository URLs must use HTTPS without embedded credentials or a custom port.");
  }
  if (parsed.search || parsed.hash) throw new Error("Repository URLs cannot contain a query or fragment.");
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error("Repository URL host is not in NEURALLOOM_REPOSITORY_HOSTS.");
  }
  return parsed.toString();
}

export function repositoryClonePlan(location: string): { url: string; ref: string | null } {
  const parsed = new URL(location);
  if (parsed.hostname.toLowerCase() !== "github.com") return { url: location, ref: null };
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (
    parts[2] === "pull" &&
    /^\d+$/.test(parts[3] || "") &&
    /^[A-Za-z0-9_.-]+$/.test(parts[0] || "") &&
    /^[A-Za-z0-9_.-]+$/.test(parts[1] || "")
  ) {
    const repository = parts[1].replace(/\.git$/i, "");
    return {
      url: `https://github.com/${parts[0]}/${repository}.git`,
      ref: `refs/pull/${parts[3]}/head`,
    };
  }
  return { url: location, ref: null };
}

export async function createDisposableCopy(
  root: string,
  tempRoot = tmpdir(),
  ignore: string[] = [".git", "dist", "build", ".next", ".tanstack", ".vercel", "coverage"],
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const destination = await mkdtemp(join(resolve(tempRoot), "neuralloom-work-"));
  const ignored = new Set(ignore);
  try {
    await cp(root, destination, {
      recursive: true,
      filter: (source) => {
        const rel = relative(root, source);
        return !rel.split(/[\\/]/).some((part) => ignored.has(part));
      },
    });
    return { root: destination, cleanup: async () => rm(destination, { recursive: true, force: true }) };
  } catch (cause) {
    await rm(destination, { recursive: true, force: true }).catch(() => {});
    throw cause;
  }
}

export async function fileDigest(root: string, paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [...new Set(paths)].sort()) {
    const absolute = resolve(root, path);
    if (!isWithin(root, absolute)) throw new Error("Patch contains a path outside the repository.");
    await assertNoSymlinkParents(root, path);
    hash.update(path);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || !info.isFile()) {
        hash.update("non-regular");
      } else {
        hash.update(await readFile(absolute));
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") hash.update("missing");
      else throw cause;
    }
  }
  return hash.digest("hex");
}

export function patchPaths(patch: string): string[] {
  if (/^(?:GIT binary patch|Binary files )/m.test(patch)) {
    throw new Error("Binary patches are not applied automatically.");
  }
  if (/^(?:rename|copy) (?:from|to) /m.test(patch) || /^(?:old|new) mode /m.test(patch)) {
    throw new Error("Rename, copy, and mode-only patches are not applied automatically.");
  }
  if (/^(?:new file|deleted file) mode (?:120000|160000)$/m.test(patch)) {
    throw new Error("Symlink and submodule patches are not applied automatically.");
  }
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("diff --git ")) continue;
    const match = /^diff --git a\/([^\s"]+) b\/([^\s"]+)$/.exec(line);
    if (!match) {
      throw new Error("Quoted or ambiguous diff paths are not applied automatically.");
    }
    addPatchPath(paths, match[1]);
    addPatchPath(paths, match[2]);
  }
  for (const match of patch.matchAll(/^(?:---|\+\+\+)\s+(?:[ab]\/)?([^\t\r\n]+)$/gm)) {
    addPatchPath(paths, match[1]);
  }
  if (paths.size === 0) throw new Error("Patch does not contain any target paths.");
  return [...paths];
}

export async function validatePatchTargets(root: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    const absolute = resolve(root, path);
    if (!isWithin(root, absolute)) throw new Error("Patch contains a path outside the repository.");
    await assertNoSymlinkParents(root, path);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error("Patch targets must be regular files or new files.");
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
}

function addPatchPath(paths: Set<string>, path: string): void {
  if (path === "/dev/null") return;
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith('"')) throw new Error("Quoted patch paths are not applied automatically.");
  if (normalized.includes(":")) {
    throw new Error("Patch paths containing alternate-stream or drive syntax are not applied automatically.");
  }
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("Patch contains an unsafe path.");
  }
  if (shouldExclude(normalized) || normalized.split("/").includes(".git")) {
    throw new Error("Patch targets a protected or excluded path.");
  }
  paths.add(normalized);
}

async function assertNoSymlinkParents(root: string, path: string): Promise<void> {
  const parts = path.replaceAll("\\", "/").split("/").slice(0, -1);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error("Patch paths cannot traverse symlinks or non-directory parents.");
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
  }
}

function assertLocalAutomationMode() {
  if (process.env.VITE_AUTH_ENABLED === "true") {
    throw new Error("Repository automation is disabled in shared deployments until per-user workspace isolation is configured.");
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function indexRepository(
  root: string,
  objective: string,
  includes: ContextInclude[],
  config: RepositoryConfig,
): Promise<{ context: string; files: number; bytes: number; truncated: boolean }> {
  const all = await listFiles(root, config.maxFiles * 50);
  const candidates = all
    .filter((path) => !shouldExclude(path))
    .map((path) => ({ path, score: scorePath(path, objective, includes) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const sections: string[] = [];
  let bytes = 0;
  let files = 0;
  let truncated = candidates.length > config.maxFiles;
  for (const { path } of candidates) {
    if (files >= config.maxFiles || bytes >= config.maxBytes) {
      truncated = true;
      break;
    }
    const absolute = resolve(root, path);
    if (!isWithin(root, absolute)) continue;
    const info = await lstat(absolute).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size > config.maxFileBytes) {
      truncated ||= Boolean(info && info.size > config.maxFileBytes);
      continue;
    }
    const buffer = await readFile(absolute);
    if (buffer.includes(0)) continue;
    const remaining = config.maxBytes - bytes;
    const content = buffer.toString("utf8", 0, Math.min(buffer.length, remaining));
    if (content.length < buffer.length) truncated = true;
    sections.push(`--- ${path} ---\n${content}`);
    bytes += Buffer.byteLength(content);
    files += 1;
  }

  if (includes.includes("repository_manifest")) {
    const manifest = all.filter((path) => !shouldExclude(path)).slice(0, 300).join("\n");
    const available = Math.max(0, config.maxBytes - bytes);
    if (available > 0) {
      const text = `--- repository manifest ---\n${manifest}`.slice(0, available);
      sections.unshift(text);
      bytes += Buffer.byteLength(text);
      if (text.length < manifest.length) truncated = true;
    }
  }

  if (includes.includes("recent_diffs")) {
    const diff = await runGit(["diff", "--no-ext-diff", "--", "."], root, 10_000);
    if (diff.code === 0 && diff.stdout) {
      const available = Math.max(0, config.maxBytes - bytes);
      const text = `--- recent diff ---\n${diff.stdout}`.slice(0, available);
      sections.push(text);
      bytes += Buffer.byteLength(text);
      if (text.length < diff.stdout.length) truncated = true;
    }
  }

  return { context: sections.join("\n\n"), files, bytes, truncated };
}

async function listFiles(root: string, limit: number): Promise<string[]> {
  const git = await runGit(["ls-files", "-co", "--exclude-standard", "-z"], root, 15_000);
  if (git.code === 0) return git.stdout.split("\0").filter(Boolean).slice(0, limit);
  const gitMetadata = await lstat(join(root, ".git")).catch(() => null);
  if (gitMetadata) {
    throw new Error("Git repository could not be enumerated safely; refusing a filesystem fallback that could include ignored files.");
  }
  const out: string[] = [];
  await walk(root, "", out, limit);
  return out;
}

async function walk(root: string, rel: string, out: string[], limit: number): Promise<void> {
  const directory = await opendir(join(root, rel));
  for await (const entry of directory) {
    if (out.length >= limit) break;
    if (ALWAYS_IGNORED.has(entry.name)) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, child, out, limit);
    else if (entry.isFile()) out.push(child);
  }
}

function shouldExclude(path: string): boolean {
  const parts = path.replaceAll("\\", "/").split("/");
  const name = parts.at(-1) || "";
  return (
    parts.some((part) => ALWAYS_IGNORED.has(part)) ||
    SECRET_BASENAME_RE.test(name) ||
    BINARY_EXTENSIONS.has(extname(name).toLowerCase())
  );
}

function scorePath(path: string, objective: string, includes: ContextInclude[]): number {
  const normalized = path.toLowerCase();
  const name = basename(normalized);
  let score = 0;
  if (includes.includes("repository_manifest") && /^(package|cargo|go|pyproject|requirements|pom|build\.gradle)/.test(name)) score += 90;
  if (includes.includes("dependency_graph") && /(?:lock|package\.json|requirements|pyproject|cargo\.toml|go\.mod)/.test(name)) score += 100;
  if (includes.includes("relevant_tests") && /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(normalized)) score += 80;
  if (includes.includes("configuration_files") && /(?:config|\.json$|\.ya?ml$|\.toml$|\.ini$)/.test(normalized)) score += 55;
  if (includes.includes("applicable_documentation") && /(?:^|\/)(?:readme|docs?\/)|\.md$/.test(normalized)) score += 60;
  if (includes.includes("symbol_index") && /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift)$/.test(normalized)) score += 45;
  if (includes.includes("relevant_source_files") && /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift|vue|svelte|css|html)$/.test(normalized)) score += 50;
  const tokens = objective.toLowerCase().match(/[a-z0-9_.-]{4,}/g) ?? [];
  if (tokens.some((token) => normalized.includes(token))) score += 120;
  return score;
}

type CommandResult = { code: number; stdout: string; stderr: string };

async function runGit(args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: gitEnvironment(),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 600_000) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({ code: code ?? 1, stdout, stderr: stderr.trim() });
    });
  });
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const names = ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"];
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_ASKPASS: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : devNull,
  };
  for (const name of names) if (process.env[name]) env[name] = process.env[name];
  return env;
}
