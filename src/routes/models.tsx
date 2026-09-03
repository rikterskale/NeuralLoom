import { createFileRoute } from "@tanstack/react-router";
import { Check, CircleAlert, LoaderCircle, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveAndTestModelSettings } from "@/lib/harness/api";
import {
  defaultModelSettings,
  MODEL_CHOICES,
  readyTaskRoles,
  ROLE_CATALOG,
} from "@/lib/harness/spec";
import { useHarness } from "@/lib/harness/store";
import type { ModelSettings, ModelSettingsCheck, RoleId } from "@/lib/harness/types";
import { ROLE_IDS } from "@/lib/harness/types";

export const Route = createFileRoute("/models")({ component: ModelsPage });

const ROLE_HELP: Record<RoleId, string> = {
  planner: "Plans the work before anything is changed.",
  coder: "Writes code and fixes problems.",
  repo_agent: "Understands large projects and how their parts connect.",
  security_specialist: "Looks for security risks and safer approaches.",
  critic: "Checks every answer independently before you see it.",
  fast_triage: "Quickly sorts, summarizes, and routes simple work.",
};

function ModelsPage() {
  const discovery = useHarness((state) => state.discovery);
  const setDiscovery = useHarness((state) => state.setDiscovery);
  const [selections, setSelections] = useState<ModelSettings>(defaultModelSettings);
  const [checks, setChecks] = useState<ModelSettingsCheck[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (discovery) setSelections(discovery.roleModels);
  }, [discovery]);

  const savedSettings = discovery?.roleModels ?? defaultModelSettings();
  const changed = ROLE_IDS.some((role) => selections[role] !== savedSettings[role]);
  const readyRoles = discovery ? readyTaskRoles(discovery.inventory, selections) : [];
  const reviewerReady = Boolean(
    discovery?.inventory.some((model) => model.name === selections.critic && model.available),
  );
  const allReady = readyRoles.length === 5 && reviewerReady;
  const localChoices = useMemo(
    () =>
      (discovery?.inventory ?? [])
        .filter((model) => model.available && model.provider === "ollama_local")
        .map((model) => ({
          name: model.name,
          label: "Installed locally",
          description: "Runs on this computer through Ollama.",
        })),
    [discovery],
  );
  const checkByRole = useMemo(() => new Map(checks.map((check) => [check.role, check])), [checks]);

  function choose(role: RoleId, model: string) {
    setSelections((current) => ({ ...current, [role]: model }));
    setChecks((current) => current.filter((check) => check.role !== role));
  }

  function useRecommended() {
    setSelections(defaultModelSettings());
    setChecks([]);
  }

  async function saveAndTest() {
    setSaving(true);
    try {
      const result = await saveAndTestModelSettings({ data: selections });
      setDiscovery(result.discovery);
      setSelections(result.settings);
      setChecks(result.checks);
      const ready = result.checks.filter((check) => check.available).length;
      if (ready === ROLE_IDS.length) {
        toast.success("Your AI choices are saved and ready.");
      } else {
        toast.warning("Choices saved. Some models still need attention.");
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Your choices could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="AI settings"
        title="Choose the AI for each job"
        description="You do not need to know anything about AI models. Keep the recommended choices unless you want faster or more thorough results."
      />

      <Card className="mb-6 overflow-hidden">
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <SimpleStep number="1" title="Choose">
            Pick a plain-language option for each job.
          </SimpleStep>
          <SimpleStep number="2" title="Save and test">
            NeuralLoom checks that every choice is safe and available.
          </SimpleStep>
          <SimpleStep number="3" title="Done">
            A green Ready label means you can start using it.
          </SimpleStep>
        </CardContent>
      </Card>

      <section
        className={`mb-6 rounded-2xl border p-4 ${
          allReady
            ? "border-ok/30 bg-ok/10"
            : discovery?.error
              ? "border-warn/30 bg-warn/10"
              : "border-border bg-card"
        }`}
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          {allReady ? (
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" />
          ) : (
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-warn" />
          )}
          <div>
            <p className="font-medium">
              {allReady
                ? "Everything is ready"
                : discovery?.error
                  ? "Ollama is not connected yet"
                  : "Save and test your choices"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {allReady
                ? "All five work roles and the independent reviewer are available."
                : discovery?.error
                  ? "Open the Ollama app on this computer, then use Save choices and test below. Your choices can still be saved now."
                  : "NeuralLoom will check all six choices together. The test does not send a task or any of your information to an AI."}
            </p>
          </div>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-tight">Your choices</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each choice is approved for its job.</p>
        </div>
        <Button type="button" variant="ghost" onClick={useRecommended} disabled={saving}>
          <RotateCcw />
          Use recommended setup
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {ROLE_IDS.map((role) => {
          const choices = [
            ...MODEL_CHOICES[role],
            ...localChoices.filter(
              (choice) => !MODEL_CHOICES[role].some((approved) => approved.name === choice.name),
            ),
          ];
          const selected = choices.find((choice) => choice.name === selections[role]) ?? {
            name: selections[role],
            label: "Saved selection",
            description: "This model is no longer in the current Ollama inventory.",
          };
          const record = discovery?.inventory.find((model) => model.name === selections[role]);
          const latestCheck = checkByRole.get(role);
          const available = latestCheck?.available ?? record?.available ?? false;
          const status = latestCheck?.message ?? readinessMessage(discovery?.error, available);

          return (
            <Card key={role}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{friendlyRoleName(role)}</CardTitle>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {ROLE_HELP[role]}
                    </p>
                  </div>
                  <Badge variant={available ? "ok" : discovery?.error ? "warn" : "muted"}>
                    {available ? "Ready" : discovery?.error ? "Not checked" : "Needs setup"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="block text-sm font-medium" htmlFor={`model-${role}`}>
                  Which option do you prefer?
                </label>
                <select
                  id={`model-${role}`}
                  className="h-12 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                  value={selections[role]}
                  onChange={(event) => choose(role, event.target.value)}
                  disabled={saving}
                >
                  {choices.map((choice) => (
                    <option key={choice.name} value={choice.name}>
                      {choice.label} — {plainModelName(choice.name)}
                    </option>
                  ))}
                </select>
                <div className="rounded-xl bg-secondary px-3 py-3">
                  <p className="text-sm font-medium">{selected.label}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{selected.description}</p>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    {selected.name}
                  </p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">
                    {selected.name.endsWith(":cloud") || selected.name.endsWith("-cloud")
                      ? "Ollama Cloud"
                      : "Runs locally"}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {available ? (
                    <Check className="size-4 text-ok" />
                  ) : (
                    <CircleAlert className="size-4 text-warn" />
                  )}
                  <span>{status}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 border-primary/20">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">
              {changed ? "You have unsaved choices" : "Your choices are saved"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Saving also checks compatibility and whether Ollama can use each model. No AI task is
              sent during this test.
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            className="shrink-0"
            onClick={() => void saveAndTest()}
            disabled={saving}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {saving ? "Saving and testing…" : "Save choices and test"}
          </Button>
        </CardContent>
      </Card>

      <details className="mt-6 rounded-2xl bg-card px-5 py-4 shadow-[var(--shadow-border)]">
        <summary className="cursor-pointer text-sm font-medium">Technical details</summary>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          NeuralLoom connects through {discovery?.endpoint ?? "the configured Ollama connection"}.
          It verifies the exact model name before every task and never substitutes an unapproved
          model.
        </p>
        {discovery?.error ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Connection detail: {discovery.error}
          </p>
        ) : null}
      </details>
    </div>
  );
}

function SimpleStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function friendlyRoleName(role: RoleId): string {
  if (role === "repo_agent") return "Project guide";
  if (role === "security_specialist") return "Safety specialist";
  if (role === "critic") return "Independent reviewer";
  if (role === "fast_triage") return "Quick helper";
  return ROLE_CATALOG[role].label;
}

function plainModelName(name: string): string {
  return name.replace(":cloud", "").replaceAll("-", " ");
}

function readinessMessage(error: string | null | undefined, available: boolean): string {
  if (available) return "Compatible and available in Ollama";
  if (error) return "Open Ollama, then save and test again";
  return "Compatible, but this model still needs to be added in Ollama";
}
