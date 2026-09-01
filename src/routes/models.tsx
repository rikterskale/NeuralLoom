import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ROLE_CATALOG } from "@/lib/harness/spec";
import { useHarness } from "@/lib/harness/store";
import { buildInventory } from "@/lib/harness/spec";

export const Route = createFileRoute("/models")({ component: ModelsPage });

function ModelsPage() {
  const unavailable = useHarness((s) => s.unavailable);
  const setUnavailable = useHarness((s) => s.setUnavailable);
  const lastDiscoveryAt = useHarness((s) => s.lastDiscoveryAt);
  const inventory = useMemo(() => buildInventory(unavailable), [unavailable]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="Model discovery"
        title="Approved inventory only."
        description="Discovery runs against the local Ollama daemon. If a role's primary is missing, the harness fails closed instead of substituting an unapproved model."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Badge variant="ok">Provider ollama_cloud</Badge>
        <Badge variant="muted">Transport local_ollama_daemon</Badge>
        <span>
          Last probe{" "}
          {lastDiscoveryAt ? new Date(lastDiscoveryAt).toLocaleString() : "pending"}
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
                <p className="mt-1 text-xs text-muted-foreground md:hidden">
                  {model.digest}
                </p>
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
                <span className="text-sm text-muted-foreground md:hidden">
                  In inventory
                </span>
                <Switch
                  checked={model.available}
                  onCheckedChange={(on) => setUnavailable(model.name, on)}
                  aria-label={`Toggle ${model.name}`}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Toggle a primary off to watch fail-closed routing on Dispatch. Preview
        generation still executes through a gated xAI runtime; the intended tag and
        digest stay on the audit record.
      </p>
    </div>
  );
}
