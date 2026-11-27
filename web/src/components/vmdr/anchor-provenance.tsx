"use client";

import * as React from "react";

import Link from "next/link";

import { Bug, CircleDot, Lightbulb, ListChecks, Loader2, ShieldCheck, Target } from "lucide-react";

import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { AnchorProvenanceItem, BlindSpot } from "@/lib/types";
import { cn } from "@/lib/utils";

import { CoverageStateBadge, ReasonBadge } from "./coverage-badges";

const KIND_META: Record<string, { icon: typeof Bug; label: string; tone: string }> = {
  intent: { icon: Target, label: "Validation intent", tone: "text-sky-600 dark:text-sky-400" },
  fact: { icon: ListChecks, label: "Fact", tone: "text-emerald-600 dark:text-emerald-400" },
  finding: { icon: Bug, label: "Finding", tone: "text-red-600 dark:text-red-400" },
  hint: { icon: Lightbulb, label: "Hint", tone: "text-amber-600 dark:text-amber-400" },
  goal: { icon: CircleDot, label: "Goal", tone: "text-muted-foreground" },
};

function fmt(ts?: string) {
  return ts ? new Date(ts).toLocaleString() : "";
}

/**
 * Reverse-anchor provenance: every exploration node anchored to an asset, newest first —
 * the proof of testing behind the coverage state, not just a green checkmark.
 */
export function AnchorProvenance({ assetId, refreshKey = 0 }: { assetId: number; refreshKey?: number }) {
  const [data, setData] = React.useState<{ coverage: BlindSpot; anchors: AnchorProvenanceItem[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-fetches after a validation
  React.useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api
      .assetAnchors(assetId)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [assetId, refreshKey]);

  if (error) return <p className="text-destructive text-xs">{error}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t("Loading…")}
      </div>
    );
  }
  const c = data.coverage;
  const validations = data.anchors.filter((a) => a.counts_as_validation).length;

  return (
    <section data-tour="anchor-provenance" className="flex flex-col gap-3 rounded-lg border p-3">
      <p className="flex items-center gap-1.5 font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
        <ShieldCheck className="size-3.5 text-primary" />
        {t("Anchor provenance")}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <CoverageStateBadge state={c.coverage_state} />
        <ReasonBadge reason={c.blind_spot_reason} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("Anchors")}</dt>
        <dd className="tabular-nums">
          {t("{n} total · {v} count as validation · {i} intents", {
            n: String(c.anchor_count),
            v: String(validations),
            i: String(c.intent_anchor_count),
          })}
        </dd>
        <dt className="text-muted-foreground">{t("Cadence")}</dt>
        <dd>
          {t("every {n} days", { n: String(c.validation_cadence_days) })}
          {c.policy && <span className="text-muted-foreground"> · {c.policy}</span>}
        </dd>
        <dt className="text-muted-foreground">{t("Next validation due")}</dt>
        <dd>{c.next_validation_due_at ? fmt(c.next_validation_due_at) : t("Not validated yet")}</dd>
        <dt className="text-muted-foreground">{t("Next step")}</dt>
        <dd>{t(c.recommended_action_label)}</dd>
      </dl>

      {data.anchors.length === 0 ? (
        <p className="rounded-md bg-muted/50 px-2 py-2 text-muted-foreground text-xs">
          {t("No exploration node has ever touched this asset. It is a blind spot, not a clean result.")}
        </p>
      ) : (
        <ol className="relative flex flex-col gap-2 border-l pl-4">
          {data.anchors.map((a) => {
            const m = KIND_META[a.kind] ?? KIND_META.goal;
            return (
              <li key={a.node_id} className="relative">
                <span
                  className={cn(
                    "absolute top-0.5 -left-[1.4rem] flex size-4 items-center justify-center rounded-full border bg-background",
                    m.tone,
                  )}
                >
                  <m.icon className="size-2.5" />
                </span>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={cn("font-semibold uppercase", m.tone)}>{t(m.label)}</span>
                  <span className="text-muted-foreground">{a.state}</span>
                  {a.counts_as_validation ? (
                    <span className="rounded bg-emerald-500/10 px-1 text-emerald-700 dark:text-emerald-300">
                      {t("proof of testing")}
                    </span>
                  ) : (
                    <span className="rounded bg-muted px-1 text-muted-foreground">{t("not validation")}</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-snug">{a.summary}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {fmt(a.created_at)}
                  {a.task_id ? (
                    <>
                      {" · "}
                      <Link
                        prefetch={false}
                        href={`/function/tasks/detail?id=${a.task_id}&tab=graph`}
                        className="hover:underline"
                      >
                        {a.task_name || `#${a.task_id}`}
                      </Link>
                    </>
                  ) : null}
                  {" · "}
                  {t("node #{id}", { id: String(a.node_id) })}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
