"use client";

import * as React from "react";

import Link from "next/link";

import { ArrowRight, Hammer, PauseCircle, RefreshCw, ShieldHalf } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { AssetPostureDetail, Finding } from "@/lib/types";
import { remediationFor } from "@/lib/vmdr/remediation";

import { CriticalityBadge, PostureStatusBadge } from "./posture-badges";

/**
 * Mitigate → Remediate → Verify guidance for one finding. Mitigation is a temporary
 * control in the target environment; remediation is the permanent root-cause fix; the
 * retest (panel below, #retest) replays the original proof to verify closure.
 */
export function RemediationPanel({ finding }: { finding: Finding }) {
  const g = remediationFor(finding.vulnclass, finding.name);
  const asset = finding.assets?.[0]?.label;
  const closed = ["resolved", "fixed"].includes(finding.status);
  const assetId = Number(finding.assets?.[0]?.id);
  const [posture, setPosture] = React.useState<AssetPostureDetail | null>(null);
  React.useEffect(() => {
    if (!assetId) return;
    let live = true;
    api
      .assetPosture(assetId)
      .then((p) => live && setPosture(p))
      .catch(() => live && setPosture(null));
    return () => {
      live = false;
    };
  }, [assetId]);

  return (
    <Card id="remediation" data-tour="finding-remediation" className="scroll-mt-28">
      <CardHeader className="gap-1">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {t("Mitigation & remediation")}
          <span className="rounded bg-muted px-1.5 py-0.5 font-normal text-muted-foreground text-xs">{g.family}</span>
        </CardTitle>
        <p className="text-muted-foreground text-sm leading-snug">{g.risk}</p>
        {posture && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" data-tour="finding-asset-posture">
            <span className="text-muted-foreground">{t("Affected asset")}</span>
            <span className="font-mono">{posture.asset.label}</span>
            <CriticalityBadge tier={posture.asset.business_criticality} full />
            <PostureStatusBadge status={posture.asset.posture_status} />
            <span className="text-muted-foreground">
              {t("owner {team}", { team: posture.asset.owner_team })} ·{" "}
              {t("posture {score}/100", { score: String(posture.asset.posture_score) })}
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 xl:grid-cols-2">
          <section className="rounded-lg border bg-amber-500/5 p-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-sm">
              <ShieldHalf className="size-4 text-amber-600 dark:text-amber-400" />
              {t("1 · Mitigate now")}
              <span className="font-normal text-muted-foreground text-xs">{t("temporary control")}</span>
            </h3>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm leading-snug">
              {g.mitigate.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </section>
          <section className="rounded-lg border bg-emerald-500/5 p-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-sm">
              <Hammer className="size-4 text-emerald-600 dark:text-emerald-400" />
              {t("2 · Remediate")}
              <span className="font-normal text-muted-foreground text-xs">{t("permanent fix")}</span>
            </h3>
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm leading-snug">
              {g.remediate.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ol>
          </section>
        </div>
        <section className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="flex items-center gap-1.5 font-semibold text-sm">
              <RefreshCw className="size-4 text-primary" />
              {t("3 · Verify")}
            </h3>
            <p className="mt-0.5 text-sm leading-snug">
              <span className="text-muted-foreground">{t("Expected after the fix:")}</span> {g.verify}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild size="sm" variant={closed ? "default" : "outline"} className="gap-1">
              <a href="#retest">
                {t("Launch retest")}
                <ArrowRight className="size-3.5" />
              </a>
            </Button>
            {asset && (
              <Button asChild size="sm" variant="ghost" className="gap-1">
                <Link
                  prefetch={false}
                  href={`/system/intercept/assets?target=${encodeURIComponent(asset)}`}
                  title={t(
                    "Optional: stop ARTEX's own agents from touching this asset while the fix is deployed (does not block attackers).",
                  )}
                >
                  <PauseCircle className="size-3.5" />
                  {t("Hold ARTEX testing on this asset")}
                </Link>
              </Button>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
