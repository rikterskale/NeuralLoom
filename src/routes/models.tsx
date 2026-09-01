import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ReadinessAlert } from "@/components/readiness-alert";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_CATALOG } from "@/lib/harness/spec";
import { useHarness } from "@/lib/harness/store";

export const Route = createFileRoute("/models")({ component: ModelsPage });

function ModelsPage() {
  const discovery = useHarness((s) => s.discovery);
  const inventory = discovery?.inventory ?? [];
  const available = inventory.some((model) => model.available);

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

      {!available ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Finish setup in three steps</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4 text-sm">
              <SetupStep number="1" title="Install and open Ollama">
                Download it from{" "}
                <a
                  className="underline underline-offset-4 hover:text-foreground"
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer"
                >
                  ollama.com/download
                </a>
                . On Linux, start the Ollama service.
              </SetupStep>
              <SetupStep number="2" title="Sign in and add a model">
                <Command>ollama signin</Command>
                <Command>ollama pull deepseek-v4-flash:0731-cloud</Command>
                <p className="mt-2 text-xs text-muted-foreground">
                  Approved models run through Ollama Cloud and require an Ollama account and an
                  internet connection.
                </p>
              </SetupStep>
              <SetupStep number="3" title="Check the connection">
                <Command>npm run doctor</Command>
                <p className="mt-2 text-xs text-muted-foreground">
                  Return here and choose <strong className="text-foreground">Check again</strong>.
                </p>
              </SetupStep>
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Badge variant={!discovery ? "muted" : discovery.error ? "deny" : "ok"}>Ollama</Badge>
        <Badge variant="muted">Configured connection</Badge>
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
            {discovery?.error
              ? "Model information could not be loaded. Follow the setup steps above, then check again."
              : "Model information is still loading. If this persists, run npm run doctor."}
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

function SetupStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1 font-medium">{title}</p>
        <div className="leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function Command({ children }: { children: string }) {
  return (
    <code className="mt-2 block overflow-x-auto rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}
