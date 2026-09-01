# User-readiness CI gate

The **Production user readiness** check is the release-facing confidence gate for NeuralLoom. It
must pass before a change is considered safe for nontechnical users.

## What it verifies

The gate runs the full static and unit suite, creates a production build, and then exercises the
application in Chromium with a deterministic local Ollama simulator. No credentials, paid model
calls, customer data, or external AI services are used.

The browser phase verifies:

- every user-facing route on desktop and mobile;
- HTTP, browser console, page-runtime, request, and horizontal-overflow health;
- basic accessibility structure and accessible names;
- keyboard entry and mobile navigation;
- PWA manifest, install surface, and local authentication contract;
- every model dropdown, compatibility enforcement, readiness testing, persistence, and reset;
- a complete public task through the author model and independent critic;
- company-data authorization and advanced human-approval controls;
- local-only refusal without a model call;
- audit persistence, filters, restricted-detail redaction, and confirmed deletion.

The simulator returns every approved model during discovery and records each synthetic model call.
The final report proves that model-readiness checks did not accidentally send prompts and that a
reviewed task used separate author and critic calls.

## Run it locally

```bash
npm run readiness:ci
```

For faster browser-only iteration after the regular checks and build already pass:

```bash
npm run readiness:e2e
```

The harness starts its own app server on `127.0.0.1:4173` and its own Ollama simulator on an
ephemeral loopback port, then shuts both down. Override the app port with
`USER_READINESS_PORT` when necessary.

## Evidence and failure handling

Every run writes `artifacts/user-readiness/report.json` plus desktop and mobile screenshots. A
failing browser case also captures a full-page failure screenshot. GitHub Actions uploads the
directory for 14 days and renders a concise pass/fail table in the job summary.

The check fails closed: an empty check list, a failed route, an unnamed control, a browser error, a
failed request, a persistence mismatch, an unexpected model call, or a missing safety/audit result
all produce a nonzero exit code.
