import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ChevronDown, CircleCheck, LockKeyhole, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ReadinessAlert } from "@/components/readiness-alert";
import { RunStatusChip } from "@/components/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  applyHarnessPatch,
  dispatchHarnessRun,
  performHarnessRemoteAction,
  runHarnessCommands,
} from "@/lib/harness/api";
import { ACTION_LABELS, formatClass } from "@/lib/harness/labels";
import { autoRole } from "@/lib/harness/route";
import { roleReadiness, ROLE_CATALOG } from "@/lib/harness/spec";
import { useHarness } from "@/lib/harness/store";
import {
  CONTEXT_INCLUDE,
  HUMAN_APPROVAL_ACTIONS,
  TASK_ROLE_IDS,
  type DispatchInput,
  type HarnessRun,
  type HumanApprovalAction,
  type KnownDataClass,
  type TaskRoleId,
} from "@/lib/harness/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dispatch")({ component: DispatchPage });

const EMPTY: DispatchInput = {
  title: "",
  objective: "",
  role: "auto",
  taggedClasses: [],
  redactionVerified: false,
  authorizationGranted: false,
  requestedActions: [],
  approvedActions: [],
  contextIncludes: ["relevant_source_files", "relevant_tests"],
  repository: { kind: "none", location: "" },
  targetAllowlisted: false,
  authorizationRecord: false,
  simulatePrimaryFailure: false,
  operatorAcceptedLab: false,
};

const INFORMATION_CHOICES: Array<{
  id: KnownDataClass;
  title: string;
  description: string;
  icon: typeof CircleCheck;
}> = [
  {
    id: "public_repositories",
    title: "Public or example material",
    description: "Open-source code, public documentation, or made-up test data.",
    icon: CircleCheck,
  },
  {
    id: "user_owned_nonclient_repositories",
    title: "My own private project",
    description: "Private work that belongs to you and contains no client information.",
    icon: LockKeyhole,
  },
  {
    id: "internal_company_source_code",
    title: "Company or client material",
    description: "Private source, architecture, findings, or assessment information.",
    icon: ShieldAlert,
  },
  {
    id: "secrets_and_api_keys",
    title: "Credentials or live evidence",
    description: "Passwords, tokens, private keys, session data, or unredacted evidence.",
    icon: ShieldAlert,
  },
];

function DispatchPage() {
  const [input, setInput] = useState<DispatchInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<HarnessRun | null>(null);
  const pushRun = useHarness((state) => state.pushRun);
  const discovery = useHarness((state) => state.discovery);
  const loadError = useHarness((state) => state.loadError);

  const selectedInformation = input.taggedClasses[0] ?? null;
  const explicitAuthorization = selectedInformation === "internal_company_source_code";
  const localOnly = selectedInformation === "secrets_and_api_keys";
  const needsTarget =
    input.repository.kind === "url" ||
    input.requestedActions.some((action) =>
      [
        "outbound_network_access",
        "exploit_execution",
        "credential_operations",
        "authentication_testing",
        "persistence_testing",
        "lateral_movement_testing",
        "deployment_to_live_environment",
        "pull_request_merge",
        "release_publication",
        "generated_command_execution",
        "working_tree_patch",
      ].includes(action),
    );
  const objectiveReady = input.objective.trim().length >= 8;
  const authorizationReady = !explicitAuthorization || input.authorizationGranted;
  const resolvedRole = input.role === "auto" ? autoRole(input.objective) : input.role;
  const modelReadiness = discovery
    ? roleReadiness(resolvedRole, discovery.inventory, discovery.roleModels)
    : { roleReady: false, criticReady: false };
  const modelsReady = Boolean(
    discovery && !discovery.error && modelReadiness.roleReady && modelReadiness.criticReady,
  );
  const repositoryReady =
    input.repository.kind === "none" || Boolean(input.repository.location.trim());
  const urlNetworkReady =
    input.repository.kind !== "url" ||
    (input.requestedActions.includes("outbound_network_access") &&
      input.approvedActions.includes("outbound_network_access") &&
      input.targetAllowlisted &&
      input.authorizationRecord);
  const repositoryActions = input.requestedActions.filter((action) =>
    [
      "generated_command_execution",
      "working_tree_patch",
      "deployment_to_live_environment",
      "pull_request_merge",
      "release_publication",
    ].includes(action),
  );
  const automationRepositoryReady =
    repositoryActions.length === 0 ||
    (input.repository.kind !== "none" &&
      (!repositoryActions.includes("working_tree_patch") || input.repository.kind === "local") &&
      (!repositoryActions.some((action) =>
        ["pull_request_merge", "release_publication"].includes(action),
      ) ||
        input.repository.kind === "url"));
  const canSubmit =
    objectiveReady &&
    Boolean(selectedInformation) &&
    authorizationReady &&
    repositoryReady &&
    urlNetworkReady &&
    automationRepositoryReady &&
    (localOnly || modelsReady);

  function patch(value: Partial<DispatchInput>) {
    setInput((current) => ({ ...current, ...value }));
  }

  function selectRepository(kind: DispatchInput["repository"]["kind"]) {
    setInput((current) => {
      const requestedActions =
        kind === "url"
          ? [...new Set([...current.requestedActions, "outbound_network_access" as const])]
          : current.requestedActions;
      return {
        ...current,
        repository: { kind, location: "" },
        requestedActions,
        approvedActions:
          kind === "url"
            ? current.approvedActions.filter((action) => action !== "outbound_network_access")
            : current.approvedActions,
      };
    });
  }

  async function run() {
    setBusy(true);
    try {
      const result = await dispatchHarnessRun({ data: input });
      setActive(result.run);
      pushRun(result.run);
      if (result.run.status === "blocked" || result.run.status.startsWith("pending")) {
        toast.message(result.run.events.at(-1)?.summary ?? "The task was safely stopped.");
      } else if (result.run.status === "failed") {
        toast.error(result.run.events.at(-1)?.summary ?? "The run failed safely.");
      } else {
        toast.success("Review complete. See the result and checks.");
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        kicker="New task"
        title="What would you like help with?"
        description="Describe the work in plain language. NeuralLoom checks what may be shared, chooses an approved model, and reviews the answer before showing it to you."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <ReadinessAlert compact />
          <Card>
            <CardHeader>
              <CardTitle>1. Describe the task</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="objective">What should the AI do?</Label>
                <Textarea
                  id="objective"
                  value={input.objective}
                  onChange={(event) => patch({ objective: event.target.value })}
                  placeholder="For example: Review this public repository and suggest a safe refactoring plan."
                  className="min-h-32"
                  aria-describedby="objective-help"
                />
                <p id="objective-help" className="text-xs text-muted-foreground">
                  Do not paste passwords, tokens, private keys, or live customer evidence.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Repository source</Label>
                <div className="flex flex-wrap gap-2">
                  {(["none", "local", "url"] as const).map((kind) => (
                    <Choice
                      key={kind}
                      active={input.repository.kind === kind}
                      onClick={() => selectRepository(kind)}
                    >
                      {kind === "none" ? "No repository" : kind === "local" ? "Local folder" : "Public HTTPS URL"}
                    </Choice>
                  ))}
                </div>
                {input.repository.kind !== "none" ? (
                  <Input
                    aria-label={input.repository.kind === "local" ? "Absolute repository path" : "Public repository URL"}
                    value={input.repository.location}
                    onChange={(event) =>
                      patch({ repository: { ...input.repository, location: event.target.value } })
                    }
                    placeholder={
                      input.repository.kind === "local"
                        ? "C:\\absolute\\path\\to\\repository"
                        : "https://github.com/owner/repository"
                    }
                  />
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Local folders must be under a configured repository root. URLs are cloned into a disposable directory.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">
                  Short name <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="title"
                  value={input.title}
                  onChange={(event) => patch({ title: event.target.value })}
                  placeholder="Repository review"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. What kind of information is involved?</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {INFORMATION_CHOICES.map((choice) => {
                const selected = selectedInformation === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => patch({ taggedClasses: [choice.id] })}
                    aria-pressed={selected}
                    className={cn(
                      "min-h-28 rounded-xl border p-4 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-secondary/40 hover:bg-secondary",
                    )}
                  >
                    <choice.icon className="mb-2 size-5" />
                    <span className="block text-sm font-medium">{choice.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {choice.description}
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {explicitAuthorization ? (
            <Card>
              <CardHeader>
                <CardTitle>Permission confirmation</CardTitle>
              </CardHeader>
              <CardContent>
                <label className="flex items-start gap-3">
                  <Checkbox
                    checked={input.authorizationGranted}
                    onCheckedChange={(checked) => patch({ authorizationGranted: checked === true })}
                  />
                  <span className="text-sm leading-relaxed">
                    I am authorized to send this material to the configured AI provider.
                  </span>
                </label>
              </CardContent>
            </Card>
          ) : null}

          <details className="rounded-2xl bg-card shadow-[var(--shadow-border)]">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-5 font-medium">
              Advanced options
              <ChevronDown className="size-4 text-muted-foreground" />
            </summary>
            <div className="space-y-6 border-t border-border px-5 py-5">
              <div>
                <Label>Specialist role</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Choice active={input.role === "auto"} onClick={() => patch({ role: "auto" })}>
                    Automatic
                  </Choice>
                  {TASK_ROLE_IDS.map((id) => (
                    <Choice
                      key={id}
                      active={input.role === id}
                      onClick={() => patch({ role: id as TaskRoleId })}
                    >
                      {ROLE_CATALOG[id].label}
                    </Choice>
                  ))}
                </div>
              </div>
              <div>
                <Label>Actions to permit after independent review</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {HUMAN_APPROVAL_ACTIONS.map((action) => (
                    <ActionOption
                      key={action}
                      action={action}
                      requested={input.requestedActions.includes(action)}
                      approved={input.approvedActions.includes(action)}
                      onChange={(requested, approved) => {
                        patch({
                          requestedActions: requested
                            ? [...new Set([...input.requestedActions, action])]
                            : input.requestedActions.filter((item) => item !== action),
                          approvedActions: approved
                            ? [...new Set([...input.approvedActions, action])]
                            : input.approvedActions.filter((item) => item !== action),
                        });
                      }}
                    />
                  ))}
                </div>
              </div>
              {needsTarget ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle
                    label="Target is on the allowlist"
                    checked={input.targetAllowlisted}
                    onChange={(checked) => patch({ targetAllowlisted: checked })}
                  />
                  <Toggle
                    label="Authorization record is on file"
                    checked={input.authorizationRecord}
                    onChange={(checked) => patch({ authorizationRecord: checked })}
                  />
                </div>
              ) : null}
              <div>
                <Label>Context to use</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CONTEXT_INCLUDE.map((item) => (
                    <Choice
                      key={item}
                      active={input.contextIncludes.includes(item)}
                      onClick={() =>
                        patch({
                          contextIncludes: input.contextIncludes.includes(item)
                            ? input.contextIncludes.filter((current) => current !== item)
                            : [...input.contextIncludes, item],
                        })
                      }
                    >
                      {formatClass(item)}
                    </Choice>
                  ))}
                </div>
              </div>
            </div>
          </details>

          <Button
            size="lg"
            className="w-full"
            disabled={busy || !canSubmit}
            onClick={() => void run()}
          >
            {busy
              ? "Checking and reviewing…"
              : localOnly
                ? "Record a safe refusal"
                : "Review this task"}
          </Button>
          {!busy && !canSubmit ? (
            <p className="-mt-3 text-center text-xs text-muted-foreground" role="status">
              {!objectiveReady
                ? "Describe the task in at least 8 characters."
                : !selectedInformation
                  ? "Choose the kind of information involved."
                  : !authorizationReady
                    ? "Confirm that you are authorized to share this material."
                    : !repositoryReady
                      ? "Provide the repository path or URL."
                      : !urlNetworkReady
                        ? "Approve outbound access and confirm the target controls in Advanced options."
                        : !automationRepositoryReady
                          ? "Select a compatible repository source for the requested automation."
                    : loadError || discovery?.error
                      ? "Start Ollama and check again before submitting."
                      : !modelReadiness.roleReady
                        ? `The model selected for ${ROLE_CATALOG[resolvedRole].label} is not ready yet.`
                        : "The independent review model is not ready yet."}
            </p>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>What happens next</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>1. The server checks the information and permissions again.</p>
              <p>2. It verifies an approved model is actually available.</p>
              <p>3. A separate critic reviews the response.</p>
              <p>4. Unfinished checks are shown honestly instead of silently passing.</p>
              <div className="pt-2">
                <Badge variant={discovery?.error ? "deny" : modelsReady ? "ok" : "warn"}>
                  {discovery?.error
                    ? "Models unavailable"
                    : modelsReady
                      ? "Review path ready"
                      : discovery
                        ? "Review path incomplete"
                        : "Checking models"}
                </Badge>
              </div>
            </CardContent>
          </Card>
          {active ? (
            <RunResult
              run={active}
              onUpdate={(run) => {
                setActive(run);
                pushRun(run);
              }}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function RunResult({ run, onUpdate }: { run: HarnessRun; onUpdate: (run: HarnessRun) => void }) {
  const [automationBusy, setAutomationBusy] = useState(false);
  const [automationOutcome, setAutomationOutcome] = useState<string | null>(null);
  const [remoteTarget, setRemoteTarget] = useState("");
  const [releaseTag, setReleaseTag] = useState("");
  const [releaseName, setReleaseName] = useState("");

  async function automate(action: "patch" | "commands") {
    const message =
      action === "patch"
        ? "Apply this independently reviewed patch to the authorized local working tree?"
        : "Run these reviewed commands inside a network-disabled, disposable container?";
    if (!window.confirm(message)) return;
    setAutomationBusy(true);
    try {
      const result =
        action === "patch"
          ? await applyHarnessPatch({ data: { runId: run.id, confirmation: "APPLY REVIEWED PATCH" } })
          : await runHarnessCommands({ data: { runId: run.id, confirmation: "RUN IN ISOLATED CONTAINER" } });
      setAutomationOutcome(result.outcome);
      onUpdate(result.run);
      toast.success(action === "patch" ? "Patch applied." : "Container execution finished.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Automation was stopped.");
    } finally {
      setAutomationBusy(false);
    }
  }

  async function remote(action: "deployment_to_live_environment" | "pull_request_merge" | "release_publication") {
    if (!window.confirm("Execute this approved remote action now? It can change an external system.")) return;
    setAutomationBusy(true);
    try {
      const result = await performHarnessRemoteAction({
        data: {
          runId: run.id,
          action,
          target: remoteTarget,
          expectedRevision: run.repository?.revision ?? "",
          releaseTag,
          releaseName,
          confirmation: "EXECUTE APPROVED REMOTE ACTION",
        },
      });
      setAutomationOutcome(result.outcome);
      onUpdate(result.run);
      toast.success(result.outcome);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Remote action was stopped.");
    } finally {
      setAutomationBusy(false);
    }
  }

  const canAutomate = run.status === "accepted" && run.verification?.accepted === true;
  const remoteActions = run.approvedActions.filter((action) =>
    ["deployment_to_live_environment", "pull_request_merge", "release_publication"].includes(action),
  ) as Array<"deployment_to_live_environment" | "pull_request_merge" | "release_publication">;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="truncate">Result</CardTitle>
        <RunStatusChip status={run.status} />
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          {run.status === "blocked" || run.status.startsWith("pending")
            ? run.events.at(-1)?.summary
            : run.status === "needs_acceptance"
              ? "The response was reviewed, but required workspace checks are still missing."
              : run.status === "accepted"
                ? "The response and every required check passed."
                : run.events.at(-1)?.summary}
        </p>
        {run.output ? (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 text-xs">
            {run.output}
          </pre>
        ) : null}
        {run.verification ? (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={run.verification.structuredPlan ? "ok" : "deny"}>Plan</Badge>
            <Badge variant={run.verification.criticAccepted ? "ok" : "deny"}>Critic</Badge>
            {run.verification.checks.map((check) => (
              <Badge
                key={check.id}
                variant={check.status === "pass" ? "ok" : check.status === "fail" ? "deny" : "warn"}
              >
                {formatClass(check.id)}: {check.status}
              </Badge>
            ))}
          </div>
        ) : null}
        {run.repository ? (
          <p className="text-xs text-muted-foreground">
            Indexed {run.repository.indexedFiles} files from {run.repository.display}
            {run.repository.revision ? ` at ${run.repository.revision.slice(0, 12)}` : ""}.
          </p>
        ) : null}
        {canAutomate && run.patch && run.repository?.mutable && run.approvedActions.includes("working_tree_patch") ? (
          <Button className="w-full" disabled={automationBusy} onClick={() => void automate("patch")}>
            Apply reviewed patch
          </Button>
        ) : null}
        {canAutomate && run.commands.length > 0 && run.approvedActions.includes("generated_command_execution") ? (
          <Button className="w-full" variant="secondary" disabled={automationBusy} onClick={() => void automate("commands")}>
            Run reviewed commands in container
          </Button>
        ) : null}
        {canAutomate && run.repository && remoteActions.length > 0 ? (
          <div className="space-y-2 rounded-xl bg-secondary p-3">
            <Label htmlFor="remote-target">Remote target</Label>
            <Input
              id="remote-target"
              value={remoteTarget}
              onChange={(event) => setRemoteTarget(event.target.value)}
              placeholder="GitHub URL or deployment target name"
            />
            {remoteActions.includes("release_publication") ? (
              <>
                <Input value={releaseTag} onChange={(event) => setReleaseTag(event.target.value)} placeholder="Release tag" />
                <Input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} placeholder="Release name" />
              </>
            ) : null}
            {remoteActions.map((action) => (
              <Button
                key={action}
                className="w-full"
                variant="destructive"
                disabled={automationBusy || !remoteTarget.trim()}
                onClick={() => void remote(action)}
              >
                {ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        ) : null}
        {automationOutcome ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 text-xs">
            {automationOutcome}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full px-3 text-xs",
        active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-secondary px-3">
      <span className="text-sm">{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ActionOption({
  action,
  requested,
  approved,
  onChange,
}: {
  action: HumanApprovalAction;
  requested: boolean;
  approved: boolean;
  onChange: (requested: boolean, approved: boolean) => void;
}) {
  return (
    <div className="rounded-xl bg-secondary p-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={requested}
          onCheckedChange={(value) => onChange(value === true, false)}
        />
        {ACTION_LABELS[action]}
      </label>
      {requested ? (
        <label className="mt-2 flex items-center gap-2 pl-6 text-xs text-muted-foreground">
          <Checkbox
            checked={approved}
            onCheckedChange={(value) => onChange(true, value === true)}
          />
          I approve this action
        </label>
      ) : null}
    </div>
  );
}
