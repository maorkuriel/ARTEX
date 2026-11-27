"use client";

import * as React from "react";

import Link from "next/link";

import {
  ArrowRight,
  Bug,
  CheckCircle2,
  ClipboardCheck,
  Crosshair,
  Network,
  Radar,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { WalkthroughButton } from "@/components/docs/doc-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { statusMeta } from "@/lib/status";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { pillarById, VMDR_FLOW, type VmdrPillarId } from "@/lib/vmdr/pillars";
import { type PostureData, postureScore, usePostureData } from "@/lib/vmdr/posture";
import { remediationFor } from "@/lib/vmdr/remediation";
import { useActiveCompany } from "@/stores/company/company-store";

const SEV_STYLE: Record<Severity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-amber-950",
  low: "bg-sky-500 text-white",
};

const GRADE_STYLE: Record<string, string> = {
  A: "text-emerald-600 dark:text-emerald-400",
  B: "text-lime-600 dark:text-lime-400",
  C: "text-amber-600 dark:text-amber-400",
  D: "text-orange-600 dark:text-orange-400",
  F: "text-red-600 dark:text-red-400",
};

const ASSET_ORDER = ["root_domain", "subdomain", "ip", "service", "app", "endpoint"];
const ASSET_LABEL: Record<string, string> = {
  root_domain: "Root domains",
  subdomain: "Subdomains",
  ip: "IPs",
  service: "Services",
  app: "Apps",
  endpoint: "Endpoints",
};

type FocusKind = "exposure" | "approval" | "verify" | "coverage";

interface FocusItem {
  key: string;
  priority: number;
  kind: FocusKind;
  pillar: VmdrPillarId;
  severity?: Severity;
  title: string;
  detail: string;
  href: string;
  action: string;
}

const KIND_META: Record<FocusKind, { label: string; icon: typeof Bug }> = {
  exposure: { label: "Mitigate & remediate", icon: Bug },
  approval: { label: "Approve", icon: ClipboardCheck },
  verify: { label: "Verify fix", icon: RefreshCw },
  coverage: { label: "Close blind spot", icon: Radar },
};

const SEV_PRIORITY: Record<Severity, number> = { critical: 100, high: 80, medium: 50, low: 25 };

function buildQueue(d: PostureData): FocusItem[] {
  const items: FocusItem[] = [];
  for (const f of d.open) {
    const asset = f.assets?.[0]?.label;
    const guide = remediationFor(f.vulnclass, f.name);
    const unverified = f.status === "pending";
    items.push({
      key: `f-${f.id}`,
      priority: SEV_PRIORITY[f.severity] - (unverified ? 15 : 0),
      kind: "exposure",
      pillar: "exposure",
      severity: f.severity,
      title: f.name || f.vulnclass,
      detail: `${asset ? `${asset} · ` : ""}${unverified ? "Not yet proven — validate first. " : ""}Mitigate now: ${guide.mitigate[0]}`,
      href: `/function/findings/detail?id=${f.finding_id ?? f.id}#remediation`,
      action: unverified ? "Validate" : "Mitigate & remediate",
    });
  }
  if (d.pending.length) {
    items.push({
      key: "approvals",
      priority: 90,
      kind: "approval",
      pillar: "guardrails",
      title: `${d.pending.length} risky ${d.pending.length === 1 ? "action is" : "actions are"} waiting for approval`,
      detail: `Testing is paused on these steps until a human allows or denies them (e.g. ${d.pending[0].tool_name}).`,
      href: "/system/intercept/approvals",
      action: "Review approvals",
    });
  }
  for (const { finding: f, latest } of d.awaitingVerify) {
    items.push({
      key: `v-${f.id}`,
      priority: 70,
      kind: "verify",
      pillar: "exposure",
      severity: f.severity,
      title: `Verify the fix: ${f.name || f.vulnclass}`,
      detail:
        latest?.verdict === "reproduced"
          ? "The last retest still reproduced the issue — the fix is not working yet."
          : "Marked fixed, but no retest has confirmed it. Launch a retest to prove closure.",
      href: `/function/findings/detail?id=${f.finding_id ?? f.id}#retest`,
      action: "Launch retest",
    });
  }
  for (const { task, coverage: c } of d.coverage) {
    if (!c?.enabled || !c.denominator) continue;
    const untested = c.denominator - c.tested;
    const pct = c.pct ?? c.tested / c.denominator;
    if (untested <= 0 || pct >= 0.9) continue;
    items.push({
      key: `c-${task.id}`,
      priority: 55 + Math.round((1 - pct) * 20),
      kind: "coverage",
      pillar: "coverage",
      title: `${untested} untested ${untested === 1 ? "asset" : "assets"} in ${task.name || task.description || `task ${task.id}`}`,
      detail: `Only ${Math.round(pct * 100)}% of in-scope assets have been tested. Untested is a blind spot, not a clean result.`,
      href: `/function/tasks/detail?id=${task.id}&tab=coverage`,
      action: "Open coverage map",
    });
  }
  return items.sort((a, b) => b.priority - a.priority);
}

function PillarTile({
  id,
  icon: Icon,
  value,
  sub,
  children,
}: {
  id: VmdrPillarId;
  icon: typeof Bug;
  value: React.ReactNode;
  sub: React.ReactNode;
  children?: React.ReactNode;
}) {
  const p = pillarById(id);
  return (
    <Link
      prefetch={false}
      href={p.href}
      data-tour={`focus-tile-${id}`}
      className="group flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
          <Icon className="size-4 text-primary" />
          {t(p.title)}
        </span>
        <ArrowRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="font-semibold text-2xl tabular-nums tracking-tight">{value}</div>
      <div className="text-muted-foreground text-xs leading-snug">{sub}</div>
      {children}
    </Link>
  );
}

function QueueBody({ loading, queue }: { loading: boolean; queue: FocusItem[] }) {
  if (loading)
    return (
      <div className="flex flex-col gap-2 px-6 pb-6">
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  if (queue.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 px-6 pb-8 text-center text-muted-foreground text-sm">
        <CheckCircle2 className="size-8 text-emerald-500" />
        {t("Nothing needs your attention right now.")}
      </div>
    );
  return (
    <ol className="divide-y border-t">
      {queue.map((item, i) => {
        const Meta = KIND_META[item.kind];
        return (
          <li key={item.key} className="flex items-start gap-3 px-4 py-3 md:px-6">
            <span className="mt-0.5 w-5 shrink-0 text-right font-medium text-muted-foreground text-sm tabular-nums">
              {i + 1}
            </span>
            <Meta.icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {item.severity && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-semibold text-[11px] uppercase",
                      SEV_STYLE[item.severity],
                    )}
                  >
                    {statusMeta("severity", item.severity).label}
                  </span>
                )}
                <span className="font-medium text-sm">{item.title}</span>
                <Badge variant="secondary" className="text-[11px]">
                  {t(pillarById(item.pillar).title)}
                </Badge>
              </div>
              <p className="mt-0.5 text-muted-foreground text-sm leading-snug">{item.detail}</p>
            </div>
            <Button asChild size="sm" variant={i === 0 ? "default" : "outline"} className="shrink-0 gap-1">
              <Link prefetch={false} href={item.href}>
                {t(item.action)}
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

export default function FocusPage() {
  const company = useActiveCompany();
  const d = usePostureData(company);
  const queue = React.useMemo(() => buildQueue(d), [d]);
  const posture = postureScore(d.open, d.tested, d.denominator);
  const covPct = d.denominator ? Math.round((d.tested / d.denominator) * 100) : null;
  const sevCount = (s: Severity) => d.open.filter((f) => f.severity === s).length;

  return (
    <div className="flex flex-col gap-5" data-tour="focus-root">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
            <Crosshair className="size-6 text-primary" />
            {t("Focus Queue")}
          </h1>
          <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
            {t(
              "Your overall asset security posture and the next actions that reduce real risk, ranked: open exposures to mitigate and remediate, fixes to verify, blind spots to test and approvals to give.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={d.reload}>
            <RefreshCw className="size-3.5" />
            {t("Refresh")}
          </Button>
          <WalkthroughButton useCase={1} label={t("Start the Guided Walkthrough")} variant="default" />
        </div>
      </div>

      {/* Posture across the five pillars */}
      <section aria-label={t("Security posture")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {d.loading ? (
          Array.from({ length: 5 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))
        ) : (
          <>
            <div
              data-tour="focus-posture"
              className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-xs sm:col-span-2 lg:col-span-1 lg:row-span-2 2xl:row-span-1"
            >
              <span className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
                <ShieldCheck className="size-4 text-primary" />
                {t("Overall Asset Security Posture")}
              </span>
              <div className="flex items-baseline gap-2">
                <span className={cn("font-bold text-4xl", GRADE_STYLE[posture.grade])}>{posture.grade}</span>
                <span className="text-muted-foreground text-sm tabular-nums">{posture.score}/100</span>
                <Badge variant="outline" className="ml-auto text-xs">
                  {t("{level} confidence", { level: statusMeta("severity", posture.confidence).label })}
                </Badge>
              </div>
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
                {posture.factors.length ? (
                  posture.factors.map((f) => (
                    <li key={f.label} className="tabular-nums">
                      {f.label} <span className="text-red-600 dark:text-red-400">{f.delta}</span>
                    </li>
                  ))
                ) : (
                  <li>{t("No open exposure and full coverage.")}</li>
                )}
              </ul>
              {posture.confidence === "low" && (
                <p className="text-amber-700 text-xs dark:text-amber-400">
                  {t("Most in-scope assets are untested, so this grade could hide blind spots.")}
                </p>
              )}
            </div>
            <PillarTile
              id="assets"
              icon={Network}
              value={d.assetTotal.toLocaleString()}
              sub={ASSET_ORDER.filter((k) => d.assetCounts[k])
                .map((k) => `${d.assetCounts[k]} ${t(ASSET_LABEL[k])}`)
                .join(" · ")}
            />
            <PillarTile
              id="coverage"
              icon={Radar}
              value={covPct === null ? "—" : `${covPct}%`}
              sub={
                d.denominator
                  ? t("{tested} of {total} in-scope assets tested", {
                      tested: String(d.tested),
                      total: String(d.denominator),
                    })
                  : t("No coverage data yet")
              }
            >
              {covPct !== null && <Progress value={covPct} className="h-1.5" />}
            </PillarTile>
            <PillarTile
              id="exposure"
              icon={Bug}
              value={d.open.length}
              sub={t("open findings · fixes awaiting verification: {verify}", {
                verify: String(d.awaitingVerify.length),
              })}
            >
              <div className="flex flex-wrap gap-1">
                {(["critical", "high", "medium", "low"] as Severity[]).map((s) => (
                  <span
                    key={s}
                    className={cn(
                      "rounded px-1.5 py-0.5 font-medium text-[11px] tabular-nums",
                      SEV_STYLE[s],
                      sevCount(s) === 0 && "opacity-35",
                    )}
                    title={statusMeta("severity", s).label}
                  >
                    {sevCount(s)} {statusMeta("severity", s).label}
                  </span>
                ))}
              </div>
            </PillarTile>
            <PillarTile
              id="guardrails"
              icon={ShieldAlert}
              value={d.pending.length}
              sub={t("pending approvals · {rules} active rules · {block} blocklist entries", {
                rules: String(d.guardrailRules),
                block: String(d.blocklistRules),
              })}
            />
          </>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] min-[2200px]:grid-cols-[minmax(0,1fr)_440px]">
        {/* Ranked focus queue */}
        <Card data-tour="focus-queue" className="min-w-0">
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">{t("What to do next")}</CardTitle>
            <span className="text-muted-foreground text-xs">
              {t("{n} actions, highest risk first", { n: String(queue.length) })}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <QueueBody loading={d.loading} queue={queue} />
          </CardContent>
        </Card>

        {/* The loop + how to read this page */}
        <aside className="flex flex-col gap-4">
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Mitigate vs. remediate")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm leading-snug">
              <p>
                <span className="font-medium">{t("Mitigate")}</span> —{" "}
                {t(
                  "a temporary control that lowers risk today (WAF rule, IP allow-list, rate limit, disable a feature).",
                )}
              </p>
              <p>
                <span className="font-medium">{t("Remediate")}</span> —{" "}
                {t("the permanent fix of the root cause in code, configuration or access.")}
              </p>
              <p>
                <span className="font-medium">{t("Verify")}</span> —{" "}
                {t("a targeted retest replays the original proof to show the fix holds.")}
              </p>
              <Link prefetch={false} href="/docs#focus-loop" className="text-primary text-sm hover:underline">
                {t("Read the guide")} →
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
