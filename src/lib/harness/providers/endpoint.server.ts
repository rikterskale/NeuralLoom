// Base-URL resolution for hosted providers. Overrides exist for testing and
// for self-hosted OpenAI-compatible servers; plain http is only ever allowed
// to loopback so an API key cannot leave this machine unencrypted.

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

export function resolveEndpoint(envVar: string, fallback: string): URL {
  const raw = process.env[envVar]?.trim() || fallback;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${envVar} must use http or https`);
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.includes(url.hostname)) {
    throw new Error(`${envVar} must use https for non-loopback endpoints`);
  }
  return url;
}

export function publicOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

// Hosted APIs resolve aliases to dated snapshots (e.g. gpt-4o ->
// gpt-4o-2024-08-06), so the runtime name must match exactly or extend the
// requested one; anything else is an unapproved substitution.
export function assertModelIdentity(requested: string, runtime: string): void {
  if (runtime === requested || runtime.startsWith(requested)) return;
  throw new Error(
    `Model identity mismatch: expected ${requested}, received ${runtime || "unknown"}`,
  );
}
