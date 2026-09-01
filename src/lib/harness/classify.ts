import {
  CLOUD_PERMITTED,
  EXPLICIT_AUTH_REQUIRED,
  LOCAL_ONLY,
  type Classification,
  type DataLane,
  type KnownDataClass,
} from "./types";

const LOCAL_PATTERNS: { cls: KnownDataClass; re: RegExp; reason: string }[] = [
  {
    cls: "private_keys",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
    reason: "PEM private key material in payload",
  },
  {
    cls: "certificates_and_pfx_files",
    re: /-----BEGIN CERTIFICATE-----|\.pfx\b|\.p12\b/i,
    reason: "Certificate or PFX material in payload",
  },
  {
    cls: "secrets_and_api_keys",
    re: /\b(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    reason: "API key or token pattern in payload",
  },
  {
    cls: "access_tokens",
    re: /\b(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*)\b/,
    reason: "Bearer or JWT access token in payload",
  },
  {
    cls: "usernames_and_passwords",
    re: /\b(password|passwd|pwd)\s*[:=]\s*\S+/i,
    reason: "Password assignment in payload",
  },
  {
    cls: "hashes",
    re: /\b[a-fA-F0-9]{32}:[a-fA-F0-9]{32}\b|\b\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}\b/,
    reason: "Password hash material in payload",
  },
  {
    cls: "kerberos_tickets",
    re: /\b(kirbi|ccache|krbtgt|TGT_|TGS_)\b/i,
    reason: "Kerberos ticket indicators in payload",
  },
  {
    cls: "session_cookies",
    re: /\b(set-cookie|sessionid|asp\.net_sessionid|jsessionid)\s*[:=]/i,
    reason: "Session cookie material in payload",
  },
  {
    cls: "bloodhound_collections",
    re: /\bbloodhound\b|\bneo4j\b.*\bad\b/i,
    reason: "BloodHound collection indicators",
  },
  {
    cls: "raw_packet_captures",
    re: /\b(\.pcap|\.pcapng|tcpdump|wireshark)\b/i,
    reason: "Packet capture artifacts referenced",
  },
  {
    cls: "unredacted_logs",
    re: /\bunredacted\b.*\blog|\braw (prod|production) logs?\b/i,
    reason: "Unredacted log material indicated",
  },
  {
    cls: "client_target_lists",
    re: /\b(scope list|target list|in-scope hosts?)\b/i,
    reason: "Client target list indicated",
  },
];

const REDACTION_CLASSES = new Set<KnownDataClass>([
  "fully_redacted_engagement_context",
  "sanitized_tool_output",
]);

export function laneOf(cls: KnownDataClass | "unknown"): DataLane {
  if (cls === "unknown") return "unknown";
  if ((LOCAL_ONLY as readonly string[]).includes(cls)) return "local_only";
  if ((EXPLICIT_AUTH_REQUIRED as readonly string[]).includes(cls)) {
    return "explicit_authorization";
  }
  if ((CLOUD_PERMITTED as readonly string[]).includes(cls)) {
    return "cloud_permitted";
  }
  return "unknown";
}

export function dominantLane(classes: Array<KnownDataClass | "unknown">): DataLane {
  if (classes.length === 0) return "unknown";
  const lanes = classes.map(laneOf);
  if (lanes.includes("unknown")) return "unknown";
  if (lanes.includes("local_only")) return "local_only";
  if (lanes.includes("explicit_authorization")) return "explicit_authorization";
  return "cloud_permitted";
}

export function detectSecrets(text: string): KnownDataClass[] {
  const found = new Set<KnownDataClass>();
  for (const rule of LOCAL_PATTERNS) {
    if (rule.re.test(text)) found.add(rule.cls);
  }
  return [...found];
}

export function detectionReasons(text: string): string[] {
  return LOCAL_PATTERNS.filter((rule) => rule.re.test(text)).map((r) => r.reason);
}

export function classifyPayload(
  text: string,
  tagged: KnownDataClass[],
): Classification {
  const detected = detectSecrets(text);
  const reasons = detectionReasons(text);
  const classes = unique([...tagged, ...detected]);
  const lane = dominantLane(classes.length ? classes : ["unknown"]);
  const suggested = suggestClasses(text, tagged, detected);
  const redactionRequired = classes.some((c) =>
    REDACTION_CLASSES.has(c as KnownDataClass),
  );

  if (classes.length === 0) {
    reasons.push("No data class tagged — default deny, unknown blocked");
  }

  return {
    classes: classes.length ? classes : ["unknown"],
    lane,
    detected,
    suggested,
    reasons,
    redactionRequired,
  };
}

function suggestClasses(
  text: string,
  tagged: KnownDataClass[],
  detected: KnownDataClass[],
): KnownDataClass[] {
  if (tagged.length || detected.length) return [];
  const t = text.toLowerCase();
  const out: KnownDataClass[] = [];
  if (/\b(cve-\d{4}-\d+|public (advisory|cve|nvd))\b/.test(t)) {
    out.push("public_vulnerability_information");
  }
  if (/\b(github\.com|public repo|open.source)\b/.test(t)) {
    out.push("public_repositories");
  }
  if (/\b(unit test|fixture|synthetic|dummy data)\b/.test(t)) {
    out.push("generated_test_fixtures");
  }
  if (/\b(lab|isolated|authorized range)\b/.test(t)) {
    out.push("synthetic_lab_data");
  }
  if (out.length === 0 && text.trim().length > 12) {
    out.push("generated_test_fixtures");
  }
  return unique(out);
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export const CLASS_LABELS: Record<KnownDataClass, string> = {
  public_repositories: "Public repositories",
  user_owned_nonclient_repositories: "User-owned non-client repos",
  synthetic_lab_data: "Synthetic lab data",
  fully_redacted_engagement_context: "Fully redacted engagement context",
  sanitized_tool_output: "Sanitized tool output",
  public_vulnerability_information: "Public vulnerability information",
  nonsecret_configuration: "Non-secret configuration",
  generated_test_fixtures: "Generated test fixtures",
  client_private_source_code: "Client private source",
  internal_company_source_code: "Internal company source",
  client_architecture_information: "Client architecture",
  client_vulnerability_details: "Client vulnerability details",
  customer_identifiers: "Customer identifiers",
  nonpublic_assessment_reports: "Non-public assessment reports",
  usernames_and_passwords: "Usernames and passwords",
  hashes: "Hashes",
  kerberos_tickets: "Kerberos tickets",
  access_tokens: "Access tokens",
  session_cookies: "Session cookies",
  private_keys: "Private keys",
  certificates_and_pfx_files: "Certificates and PFX",
  secrets_and_api_keys: "Secrets and API keys",
  bloodhound_collections: "BloodHound collections",
  raw_active_directory_exports: "Raw Active Directory exports",
  raw_packet_captures: "Raw packet captures",
  unredacted_logs: "Unredacted logs",
  unredacted_screenshots: "Unredacted screenshots",
  client_target_lists: "Client target lists",
  live_engagement_evidence: "Live engagement evidence",
};
