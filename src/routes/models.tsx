import { createFileRoute } from "@tanstack/react-router";
import { ReadinessAlert } from "@/components/readiness-alert";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { ROLE_CATALOG } from "@/lib/harness/spec";
import { useHarness } from "@/lib/harness/store";

export const Route = createFileRoute("/models")({ component: ModelsPage });

function ModelsPage() {
  const discovery = useHarness((s) => s.discovery);
  const inventory = discovery?.inventory ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="AI setup"
        title="Model readiness"
        description="NeuralLoom uses Ollama and only sends work to approved models. This page shows exactly what is ready and what needs attention."
      />

      <div className="mb-6">
        <ReadinessAlert />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Badge variant={!discovery ? "muted" : discovery.error ? "deny" : "ok"}>Ollama</Badge>
        <Badge variant="muted">Local connection</Badge>
        <span>
          Last probe {discovery ? new Date(discovery.discoveredAt).toLocaleString() : "pending"}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-border)]">
        <div className="hidden grid-cols-12 gap-3 border-b border-border px-5 py-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:grid">
          <span className="col-span-4">Model</span>
          <span className="col-span-3">Digest</span>
          <span className="col-span-3">Roles</span>
          <span className="col-span-2 text-right">Available</span>
        </div>
        <ul>
          {inventory.map((model) => (
            <li
              key={model.name}
              className="grid grid-cols-1 gap-2 border-t border-border px-5 py-4 md:grid-cols-12 md:items-center md:gap-3"
            >
              <div className="md:col-span-4">
                <p className="font-mono text-sm leading-snug">{model.name}</p>
                <p className="mt-1 text-xs text-muted-foreground md:hidden">{model.digest}</p>
              </div>
              <p className="hidden font-mono text-xs text-muted-foreground md:col-span-3 md:block">
                {model.digest}
              </p>
              <div className="flex flex-wrap gap-1 md:col-span-3">
                {model.usedBy.map((id) => (
                  <Badge key={id} variant="outline">
                    {ROLE_CATALOG[id].label}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 md:col-span-2 md:justify-end">
                <span className="text-sm text-muted-foreground md:hidden">Discovered</span>
                <Badge variant={model.available ? "ok" : "deny"}>
                  {model.available ? "Available" : "Missing"}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
        {!inventory.length ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            Model information is still loading. If this persists, run{" "}
            <code className="font-mono">npm run doctor</code>.
          </div>
        ) : null}
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        This is live data from {discovery?.endpoint ?? "the configured Ollama endpoint"}. NeuralLoom
        sends a task only to the exact model and digest shown here.
        {discovery?.error ? ` Discovery error: ${discovery.error}` : ""}
      </p>
    </div>
  );
}
