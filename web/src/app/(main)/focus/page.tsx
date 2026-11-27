"use client";

import * as React from "react";

import Link from "next/link";

import {
  ArrowRight,
  Bug,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  Crosshair,
  FileSearch,
  Gauge,
  Loader2,
  Radar,
  RefreshCw,
  ShieldAlert,
  Target,
} from "lucide-react";
import { toast } from "sonner";

import { WalkthroughButton } from "@/components/docs/doc-blocks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CRITICALITY_META, CriticalityBadge, POSTURE_META, PostureStatusBadge } from "@/components/vmdr/posture-badges";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { statusMeta } from "@/lib/status";
import type { BusinessCriticality, PostureAssetRef, PostureStatus, PostureSummary, Severity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { VMDR_FLOW } from "@/lib/vmdr/pillars";
import { usePostureData } from "@/lib/vmdr/posture";
import { remediationFor } from "@/lib/vmdr/remediation";
import { useActiveCompany } from "@/stores/company/company-store";

const SEV_STYLE: Record<Severity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-amber-950",
  low: "bg-sky-500 text-white",
};

function gradeOf(score: number) {
  if (score >= 85) return { g: "A", c: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 70) return { g: "B", c: "text-lime-600 dark:text-lime-400" };
  if (score >= 55) return { g: "C", c: "text-amber-600 dark:text-amber-400" };
  if (score >= 40) return { g: "D", c: "text-orange-600 dark:text-orange-400" };
  return { g: "F", c: "text-red-600 dark:text-red-400" };
}

const TIER_SHORT: Record<BusinessCriticality, string> = {
  tier_1_crown_jewel: "Tier-1 crown jewel",
  tier_2_business: "Tier-2 business",
  tier_3_standard: "Tier-3 standard",
};

/** "Schedule safe validation": opens the new-task sheet prefilled with a read-only validation brief. */
function safeValidationHref(a: PostureAssetRef) {
  const p = new URLSearchParams({
    new: "1",
    name: `Safe validation: ${a.label}`,
    description: `Read-only safe validation of ${a.label} (${a.type}, ${TIER_SHORT[a.business_criticality]}, owner ${a.owner_team}). Use non-mutating probes only (GET/HEAD/OPTIONS, passive fingerprinting). The asset's validation policy blocks state-changing requests and Tier-1 targets require human approval.`,
    goal: `Determine whether ${a.label} exposes exploitable weaknesses using non-destructive checks, record coverage anchors for every asset exercised, and attach HTTP evidence to anything confirmed.`,
  });
  return `/function/tasks?${p.toString()}`;
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  href,
  tour,
  children,
}: {
  icon: typeof Bug;
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  tone?: string;
  href: string;
  tour?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      prefetch={false}
      href={href}
      data-tour={tour}
      className="group flex flex-col gap-1.5 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/40"
    >
      <span className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
        <Icon className="size-4 text-primary" />
        {label}
      </span>
      <span className={cn("font-semibold text-3xl tabular-nums tracking-tight", tone)}>{value}</span>
      <span className="text-muted-foreground text-xs leading-snug">{sub}</span>
      {children}
    </Link>
  );
}

function Section({
  n,
  icon: Icon,
  title,
  hint,
  count,
  children,
  tour,
}: {
  n: number;
  icon: typeof Bug;
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
  tour?: string;
}) {
  return (
    <section data-tour={tour} className="border-t first:border-t-0">
      <header className="flex items-center gap-2 bg-muted/30 px-4 py-2.5 md:px-6">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-[11px] text-primary-foreground">
          {n}
        </span>
        <Icon className="size-4 text-primary" />
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
        <span className="ml-auto hidden text-muted-foreground text-xs lg:inline">{hint}</span>
      </header>
      {count === 0 ? (
        <p className="flex items-center gap-2 px-4 py-3 text-muted-foreground text-sm md:px-6">
          <CheckCircle2 className="size-4 text-emerald-500" />
          {t("Nothing here right now.")}
        </p>
      ) : (
        <ol className="divide-y">{children}</ol>
      )}
    </section>
  );
}

function Row({ children, actions }: { children: React.ReactNode; actions: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start md:px-6">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
    </li>
  );
}

export default function FocusPage() {
  const company = useActiveCompany();
  const d = usePostureData(company);
  const [summary, setSummary] = React.useState<PostureSummary | null>(null);
  const [retesting, setRetesting] = React.useState<Record<string, boolean>>({});
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    api
      .postureSummary(company, tick > 0)
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
  }, [company, tick]);

  const reload = () => {
    setTick((n) => n + 1);
    d.reload();
  };

  async function launchRetest(findingId: string) {
    setRetesting((r) => ({ ...r, [findingId]: true }));
    try {
      await api.startFindingRetest(findingId, "Targeted retest launched from the Focus Queue to verify the fix.");
      toast.success(t("Targeted retest launched"));
      reload();
    } catch (e) {
      toast.error(t("Update failed: {error}", { error: (e as Error).message }));
    } finally {
      setRetesting((r) => ({ ...r, [findingId]: false }));
    }
  }

  const proven = d.open.filter((f) => f.status === "confirmed" || f.status === "in_progress");
  const blind = summary?.high_value_blind_spots ?? [];
  const loading = d.loading || !summary;
  const score = summary?.overall_score ?? 0;
  const grade = gradeOf(score);
  const tier1Exposed = (summary?.tier1.critical_exposures ?? 0) + (summary?.tier1.high_exposures ?? 0);

  return (
    <div className="flex flex-col gap-5" data-tour="focus-root">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
            <Crosshair className="size-6 text-primary" />
            {t("Posture & Focus")}
          </h1>
          <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
            {t(
              "Asset-centric security posture and where to focus now: proven exposures to mitigate and remediate, high-value blind spots to validate safely, guard approvals to give and fixes to verify.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={reload}>
            <RefreshCw className="size-3.5" />
            {t("Refresh")}
          </Button>
          <WalkthroughButton useCase={1} label={t("Start the Guided Walkthrough")} variant="default" />
        </div>
      </div>

      {/* KPI strip */}
      <section
        aria-label={t("Security posture")}
        data-tour="focus-kpis"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        {loading ? (
          Array.from({ length: 5 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))
        ) : (
          <>
            <Kpi
              icon={Gauge}
              label={t("Overall Posture Score")}
              tour="focus-posture"
              href="/function/assets"
              value={
                <span className="flex items-baseline gap-2">
                  <span className={grade.c}>{score}</span>
                  <span className="text-base text-muted-foreground">/100</span>
                  <span className={cn("ml-auto font-bold text-2xl", grade.c)}>{grade.g}</span>
                </span>
              }
              sub={
                (summary?.coverage_pct ?? 0) < 50
                  ? t("Low confidence: most assets are still untested")
                  : t("Criticality-weighted across {n} assets", { n: String(summary?.asset_total ?? 0) })
              }
            />
            <Kpi
              icon={ShieldAlert}
              label={t("Tier-1 Exposures")}
              href="/function/findings"
              tone={tier1Exposed ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}
              value={tier1Exposed}
              sub={t("{c} critical · {h} high · of {n} crown jewels", {
                c: String(summary?.tier1.critical_exposures ?? 0),
                h: String(summary?.tier1.high_exposures ?? 0),
                n: String(summary?.tier1.total ?? 0),
              })}
            />
            <Kpi
              icon={Radar}
              label={t("Validated Coverage")}
              href="/coverage"
              value={`${Math.round(summary?.coverage_pct ?? 0)}%`}
              sub={t("{v} of {n} assets have exploration anchors", {
                v: String(summary?.validated_assets ?? 0),
                n: String(summary?.asset_total ?? 0),
              })}
            >
              <Progress value={summary?.coverage_pct ?? 0} className="h-1.5" />
            </Kpi>
            <Kpi
              icon={Target}
              label={t("Untested Blind Spots")}
              href="/coverage"
              tone="text-slate-700 dark:text-slate-300"
              value={summary?.blind_spots ?? 0}
              sub={t("{n} are Tier-1/Tier-2", { n: String(blind.length) })}
            />
            <Kpi
              icon={ClipboardCheck}
              label={t("Pending Guard Approvals")}
              href="/system/intercept/approvals"
              tone={summary?.pending_approvals ? "text-amber-600 dark:text-amber-400" : undefined}
              value={summary?.pending_approvals ?? 0}
              sub={t("Fixes awaiting verification: {n}", { n: String(summary?.fixes_awaiting_verification ?? 0) })}
            />
          </>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] min-[2200px]:grid-cols-[minmax(0,1fr)_420px]">
        <Card data-tour="focus-queue" className="min-w-0 gap-0 overflow-hidden py-0">
          <CardHeader className="flex-row items-center justify-between gap-2 border-b py-4">
            <CardTitle className="text-base">{t("Where to focus now")}</CardTitle>
            <span className="text-muted-foreground text-xs">{t("Highest risk first")}</span>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col gap-2 p-6">
                {Array.from({ length: 6 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : (
              <>
                <Section
                  n={1}
                  icon={Bug}
                  tour="focus-exposures"
                  title={t("Proven exposures needing remediation / mitigation")}
                  hint={t("Confirmed findings, with their evidence")}
                  count={proven.length}
                >
                  {proven.map((f, i) => {
                    const id = f.finding_id ?? f.id;
                    const guide = remediationFor(f.vulnclass, f.name);
                    return (
                      <Row
                        key={f.id}
                        actions={
                          <>
                            <Button asChild size="sm" variant={i === 0 ? "default" : "outline"} className="gap-1">
                              <Link prefetch={false} href={`/function/findings/detail?id=${id}#remediation`}>
                                {t("Mitigate & remediate")}
                                <ArrowRight className="size-3.5" />
                              </Link>
                            </Button>
                            <Button asChild size="sm" variant="ghost" className="gap-1">
                              <Link prefetch={false} href={`/function/findings/detail?id=${id}#evidence`}>
                                <FileSearch className="size-3.5" />
                                {t("Evidence ({n})", { n: String(f.traffic_count ?? 0) })}
                              </Link>
                            </Button>
                          </>
                        }
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 font-semibold text-[11px] uppercase",
                              SEV_STYLE[f.severity],
                            )}
                          >
                            {statusMeta("severity", f.severity).label}
                          </span>
                          <span className="font-medium text-sm">{f.name || f.vulnclass}</span>
                        </div>
                        <p className="mt-0.5 text-muted-foreground text-sm leading-snug">
                          {f.assets?.[0]?.label ? `${f.assets[0].label} · ` : ""}
                          {t("Mitigate now:")} {guide.mitigate[0]}
                        </p>
                      </Row>
                    );
                  })}
                </Section>

                <Section
                  n={2}
                  icon={Target}
                  tour="focus-blind-spots"
                  title={t("High-criticality blind spots")}
                  hint={t("Tier-1/Tier-2 assets with zero exploration anchors")}
                  count={blind.length}
                >
                  {blind.map((a) => (
                    <Row
                      key={a.id}
                      actions={
                        <Button asChild size="sm" variant="outline" className="gap-1">
                          <Link prefetch={false} href={safeValidationHref(a)}>
                            <CalendarPlus className="size-3.5" />
                            {t("Schedule safe validation")}
                          </Link>
                        </Button>
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <CriticalityBadge tier={a.business_criticality} />
                        <Link
                          prefetch={false}
                          href={`/function/assets/?type=${a.type}&inspect=${a.id}`}
                          className="truncate font-medium font-mono text-sm hover:underline"
                        >
                          {a.label}
                        </Link>
                      </div>
                      <p className="mt-0.5 text-muted-foreground text-sm">
                        {a.type} · {t("owner {team}", { team: a.owner_team })} ·{" "}
                        {t("never validated — unknown, not clean")}
                      </p>
                    </Row>
                  ))}
                </Section>

                <Section
                  n={3}
                  icon={ClipboardCheck}
                  tour="focus-approvals"
                  title={t("Held guard approvals")}
                  hint={t("Waiting for human sign-off")}
                  count={d.pending.length}
                >
                  {d.pending.slice(0, 6).map((p) => (
                    <Row
                      key={p.id}
                      actions={
                        <Button asChild size="sm" variant="outline" className="gap-1">
                          <Link prefetch={false} href="/system/intercept/approvals">
                            {t("Review")}
                            <ArrowRight className="size-3.5" />
                          </Link>
                        </Button>
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.tool_name}</span>
                        {p.task_id && <span className="text-muted-foreground text-xs">#{p.task_id}</span>}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground text-sm leading-snug">
                        {p.reason || t("Approval required")}
                      </p>
                    </Row>
                  ))}
                </Section>

                <Section
                  n={4}
                  icon={RefreshCw}
                  tour="focus-verify"
                  title={t("Fixes awaiting verification")}
                  hint={t("Marked fixed, not yet proven by a retest")}
                  count={d.awaitingVerify.length}
                >
                  {d.awaitingVerify.map(({ finding: f, latest }) => {
                    const id = String(f.finding_id ?? f.id);
                    return (
                      <Row
                        key={f.id}
                        actions={
                          <>
                            <Button
                              size="sm"
                              className="gap-1"
                              disabled={retesting[id] || latest?.status === "running" || latest?.status === "pending"}
                              onClick={() => launchRetest(id)}
                            >
                              {retesting[id] ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3.5" />
                              )}
                              {t("Launch targeted retest")}
                            </Button>
                            <Button asChild size="sm" variant="ghost">
                              <Link prefetch={false} href={`/function/findings/detail?id=${id}#retest`}>
                                {t("Open")}
                              </Link>
                            </Button>
                          </>
                        }
                      >
                        <span className="font-medium text-sm">{f.name || f.vulnclass}</span>
                        <p className="mt-0.5 text-muted-foreground text-sm leading-snug">
                          {latest?.verdict === "reproduced"
                            ? t("The last retest still reproduced the issue — the fix is not working yet.")
                            : t("Marked fixed, but no retest has confirmed it yet.")}
                        </p>
                      </Row>
                    );
                  })}
                </Section>
              </>
            )}
          </CardContent>
        </Card>

        <aside className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Card data-tour="focus-status-mix">
            <CardHeader>
              <CardTitle className="text-base">{t("Assets by posture status")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {(Object.keys(POSTURE_META) as PostureStatus[]).map((st) => {
                const n = summary?.by_status[st] ?? 0;
                const pct = summary?.asset_total ? (n / summary.asset_total) * 100 : 0;
                return (
                  <div key={st} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <PostureStatusBadge status={st} />
                      <span className="text-sm tabular-nums">{n}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", POSTURE_META[st].dot)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="mt-1 flex flex-wrap gap-1.5 border-t pt-2 text-xs">
                {(Object.keys(CRITICALITY_META) as BusinessCriticality[]).map((k) => (
                  <span key={k} className="flex items-center gap-1">
                    <CriticalityBadge tier={k} />
                    <span className="tabular-nums">{summary?.by_criticality[k] ?? 0}</span>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card data-tour="focus-loop">
            <CardHeader>
              <CardTitle className="text-base">{t("The VMDR loop")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {VMDR_FLOW.map((s) => (
                  <li key={s.n}>
                    <Link prefetch={false} href={s.href} className="group flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
                        {s.n}
                      </span>
                      <span>
                        <span className="font-medium text-sm group-hover:underline">{t(s.title)}</span>
                        <span className="block text-muted-foreground text-sm leading-snug">{s.summary}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
