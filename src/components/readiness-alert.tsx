import { Link } from "@tanstack/react-router";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { refreshModelDiscovery } from "@/lib/harness/api";
import { readyTaskRoles } from "@/lib/harness/spec";
import { useHarness } from "@/lib/harness/store";

export function ReadinessAlert({ compact = false }: { compact?: boolean }) {
  const discovery = useHarness((state) => state.discovery);
  const loading = useHarness((state) => state.loading);
  const loadError = useHarness((state) => state.loadError);
  const setDiscovery = useHarness((state) => state.setDiscovery);
  const [refreshing, setRefreshing] = useState(false);

  if (loading && !discovery) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="size-4 animate-spin" />
        Checking AI model availability…
      </div>
    );
  }

  const error = loadError ?? discovery?.error;
  const readyRoles = discovery ? readyTaskRoles(discovery.inventory, discovery.roleModels) : [];
  if (!error && readyRoles.length > 0) return null;

  async function retry() {
    setRefreshing(true);
    try {
      const result = await refreshModelDiscovery();
      setDiscovery(result);
      if (result.error) toast.error("Ollama is still unavailable.");
      else toast.success("Model availability refreshed.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not refresh model availability.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-warn/30 bg-warn/10 p-4"
      aria-labelledby="readiness-title"
    >
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <h2 id="readiness-title" className="font-medium">
            A complete AI review path is not ready yet
          </h2>
          {!compact ? (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Open Ollama, sign in, and add the recommended task and critic models. Run
              <code className="mx-1 rounded bg-background/60 px-1.5 py-0.5 font-mono text-xs">
                npm run doctor
              </code>
              for exact setup guidance.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void retry()}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Checking…" : "Check again"}
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/models">View setup details</Link>
            </Button>
            {!compact ? (
              <Button asChild size="sm" variant="ghost">
                <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
                  Download Ollama
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
