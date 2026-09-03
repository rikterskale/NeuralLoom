import type { DispatchInput } from "./types";

export type Preset = {
  id: string;
  label: string;
  blurb: string;
  input: DispatchInput;
};

export const PRESETS: Preset[] = [
  {
    id: "public-refactor",
    label: "Public repo refactor",
    blurb: "Cloud-permitted. Coder weaves a patch for a public helper.",
    input: {
      title: "Extract retry helper",
      objective:
        "In a public GitHub repository, extract the duplicated retry loop in src/http.ts into a tested helper. Generate a unified diff and unit test fixtures. Do not touch secrets or vendor directories.",
      role: "coder",
      taggedClasses: ["public_repositories", "generated_test_fixtures"],
      redactionVerified: false,
      authorizationGranted: false,
      requestedActions: [],
      approvedActions: [],
      contextIncludes: [
        "relevant_source_files",
        "relevant_tests",
        "recent_diffs",
      ],
      repository: { kind: "none", location: "" },
      targetAllowlisted: false,
      authorizationRecord: false,
      simulatePrimaryFailure: false,
      operatorAcceptedLab: false,
    },
  },
  {
    id: "secret-logs",
    label: "Unredacted logs",
    blurb: "Local-only. Must fail closed before any cloud call.",
    input: {
      title: "Summarize production dump",
      objective:
        "Summarize these unredacted production logs. password=SuperSecret!99 and Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb appear in the dump.",
      role: "fast_triage",
      taggedClasses: ["unredacted_logs"],
      redactionVerified: false,
      authorizationGranted: false,
      requestedActions: [],
      approvedActions: [],
      contextIncludes: [],
      repository: { kind: "none", location: "" },
      targetAllowlisted: false,
      authorizationRecord: false,
      simulatePrimaryFailure: false,
      operatorAcceptedLab: false,
    },
  },
  {
    id: "client-source",
    label: "Client source review",
    blurb: "Explicit authorization required before the security specialist runs.",
    input: {
      title: "AuthN review of client service",
      objective:
        "Review the authentication flow in the client's private source for privilege-escalation paths. Stay inside the authorized engagement. Produce a plan and a patch that adds tests, not a full rewrite.",
      role: "security_specialist",
      taggedClasses: ["client_private_source_code", "client_architecture_information"],
      redactionVerified: false,
      authorizationGranted: false,
      requestedActions: [],
      approvedActions: [],
      contextIncludes: [
        "relevant_source_files",
        "symbol_index",
        "applicable_documentation",
      ],
      repository: { kind: "none", location: "" },
      targetAllowlisted: false,
      authorizationRecord: false,
      simulatePrimaryFailure: false,
      operatorAcceptedLab: false,
    },
  },
  {
    id: "lab-poc",
    label: "Lab proof of concept",
    blurb: "Synthetic lab data. Exploit execution needs human approval and an allowlist.",
    input: {
      title: "Synthetic XSS lab PoC",
      objective:
        "Develop a synthetic lab proof of concept for a reflected XSS finding using isolated authorized lab data. Do not target external hosts. Capture commands and expected output. Include detection notes.",
      role: "security_specialist",
      taggedClasses: ["synthetic_lab_data", "public_vulnerability_information"],
      redactionVerified: false,
      authorizationGranted: false,
      requestedActions: ["exploit_execution"],
      approvedActions: [],
      contextIncludes: ["applicable_documentation", "relevant_tests"],
      repository: { kind: "none", location: "" },
      targetAllowlisted: false,
      authorizationRecord: false,
      simulatePrimaryFailure: false,
      operatorAcceptedLab: false,
    },
  },
  {
    id: "triage",
    label: "CI crash triage",
    blurb: "Fast triage on sanitized logs. Routes without the heavy models.",
    input: {
      title: "Classify CI failure",
      objective:
        "Triage this sanitized tool output from CI: typecheck failed in packages/core/src/queue.ts line 88. Which files should the coder open first, and should this route to repo_agent instead?",
      role: "fast_triage",
      taggedClasses: ["sanitized_tool_output", "nonsecret_configuration"],
      redactionVerified: true,
      authorizationGranted: false,
      requestedActions: [],
      approvedActions: [],
      contextIncludes: ["repository_manifest", "recent_diffs"],
      repository: { kind: "none", location: "" },
      targetAllowlisted: false,
      authorizationRecord: false,
      simulatePrimaryFailure: false,
      operatorAcceptedLab: false,
    },
  },
];
