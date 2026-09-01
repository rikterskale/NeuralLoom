export type CriticVerdict = {
  parsed: boolean;
  accepted: boolean;
  findings: Array<{ severity: string; issue: string }>;
  notes: string;
};

export function parseCriticVerdict(text: string): CriticVerdict {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return unparsed();
  try {
    const value = JSON.parse(candidate) as Record<string, unknown>;
    if (typeof value.accept !== "boolean" || !Array.isArray(value.findings)) return unparsed();
    const findings = value.findings.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const finding = item as Record<string, unknown>;
      if (typeof finding.issue !== "string") return [];
      return [
        {
          severity: typeof finding.severity === "string" ? finding.severity : "unknown",
          issue: finding.issue,
        },
      ];
    });
    return {
      parsed: true,
      accepted:
        value.accept === true &&
        findings.every((f) => !["critical", "high"].includes(f.severity.toLowerCase())),
      findings,
      notes: typeof value.notes === "string" ? value.notes : "",
    };
  } catch {
    return unparsed();
  }
}

function unparsed(): CriticVerdict {
  return {
    parsed: false,
    accepted: false,
    findings: [{ severity: "high", issue: "Critic response was not valid structured JSON" }],
    notes: "Fail closed: an unparseable critic response cannot approve an artifact.",
  };
}
