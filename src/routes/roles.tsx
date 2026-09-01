import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { catalogForModelSettings, ROLE_BLURBS, ROLE_CATALOG } from "@/lib/harness/spec";
import { useHarness } from "@/lib/harness/store";
import { formatClass } from "@/lib/harness/labels";
import { ROLE_IDS } from "@/lib/harness/types";

export const Route = createFileRoute("/roles")({ component: RolesPage });

function RolesPage() {
  const discovery = useHarness((state) => state.discovery);
  const catalog = discovery ? catalogForModelSettings(discovery.roleModels) : ROLE_CATALOG;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        kicker="Role map"
        title="Six threads, one loom."
        description="Each role has a primary Ollama Cloud model, an approved fallback chain, a think level, and a hard temperature cap. Unapproved substitution is forbidden."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {ROLE_IDS.map((id) => {
          const role = catalog[id];
          return (
            <Card key={id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>{role.label}</CardTitle>
                  <div className="flex gap-1.5">
                    <Badge variant="outline">think {role.think}</Badge>
                    <Badge variant="muted">{role.temperature.toFixed(2)}</Badge>
                  </div>
                </div>
                <CardDescription>{ROLE_BLURBS[id]}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Primary
                  </p>
                  <p className="mt-1 font-mono text-sm">{role.primary}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Fallbacks
                  </p>
                  <ul className="mt-1 space-y-1">
                    {role.fallbacks.map((fb) => (
                      <li key={fb} className="font-mono text-sm text-muted-foreground">
                        {fb}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Responsibilities
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {role.responsibilities.map((r) => (
                      <Badge key={r} variant="outline">
                        {formatClass(r)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
