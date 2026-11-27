"use client";

import * as React from "react";

import Link from "next/link";

import { ArrowRight, CircleAlert, Radar, RefreshCw } from "lucide-react";

import { WalkthroughButton } from "@/components/docs/doc-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { t } from "@/i18n";
import { statusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { type TaskCoverageRow, usePostureData } from "@/lib/vmdr/posture";
import { useActiveCompany } from "@/stores/company/company-store";

const TYPE_ORDER = ["root_domain", "subdomain", "ip", "service", "app", "endpoint"];
const TYPE_LABEL: Record<string, string> = {
  root_domain: "Root domains",
  subdomain: "Subdomains",
  ip: "IPs",
  service: "Services",
  app: "Apps",
  endpoint: "Endpoints",
};

function pctOf(row: TaskCoverageRow): number | null {
  const c = row.coverage;
  if (!c?.enabled || !c.denominator) return null;
  return c.pct ?? c.tested / c.denominator;
}

function barTone(pct: number) {
  if (pct >= 0.8) return "[&>div]:bg-emerald-500";
  if (pct >= 0.5) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-red-500";
}

export default function CoveragePage() {
  const company = useActiveCompany();
  const d = usePostureData(company, { retests: false });

  const rows = React.useMemo(
    () =>
      [...d.coverage]
        .filter((r) => r.coverage?.enabled && r.coverage.denominator > 0)
        .sort((a, b) => (pctOf(a) ?? 1) - (pctOf(b) ?? 1)),
    [d.coverage],
  );
  const noData = d.coverage.filter((r) => !(r.coverage?.enabled && r.coverage.denominator > 0));

  // Tested vs. untested by asset type across all tasks.
  const byType = React.useMemo(() => {
    const m = new Map<string, { total: number; tested: number }>();
    for (const r of rows)
      for (const b of r.coverage?.by_type ?? []) {
        const cur = m.get(b.type) ?? { total: 0, tested: 0 };
        cur.total += b.total;
        cur.tested += b.tested;
        m.set(b.type, cur);
      }
    return [...m.entries()].sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]));
  }, [rows]);

  const gaps = rows.flatMap((r) => (r.coverage?.gaps ?? []).map((g) => ({ ...g, task: r.task })));
  const untested = d.denominator - d.tested;
  const overall = d.denominator ? d.tested / d.denominator : null;

  return (
    <div className="flex flex-col gap-5" data-tour="coverage-root">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
            <Radar className="size-6 text-primary" />
            {t("Test Coverage")}
          </h1>
          <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
            {t(
              "What has been tested vs. what has not, per engagement. An untested asset is a blind spot, never a clean result. Open a coverage map to see exactly which assets are still gray.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={d.reload}>
            <RefreshCw className="size-3.5" />
            {t("Refresh")}
          </Button>
          <WalkthroughButton useCase={4} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="gap-1 py-4">
          <CardContent className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">{t("Overall coverage")}</span>
            <span className="font-semibold text-3xl tabular-nums">
              {overall === null ? "—" : `${Math.round(overall * 100)}%`}
            </span>
            {overall !== null && (
              <Progress value={Math.round(overall * 100)} className={cn("h-1.5", barTone(overall))} />
            )}
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">{t("Tested assets")}</span>
            <span className="font-semibold text-3xl text-emerald-600 tabular-nums dark:text-emerald-400">
              {d.tested}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("of {total} in scope", { total: String(d.denominator) })}
            </span>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">{t("Untested blind spots")}</span>
            <span className="font-semibold text-3xl text-red-600 tabular-nums dark:text-red-400">
              {Math.max(0, untested)}
            </span>
            <span className="text-muted-foreground text-xs">{t("not yet examined — not proof of safety")}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_400px] min-[2200px]:grid-cols-[minmax(0,1fr)_440px]">
        <Card data-tour="coverage-tasks" className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">{t("Coverage by engagement")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {d.loading ? (
              <div className="flex flex-col gap-2 px-6 pb-6">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">{t("Task")}</TableHead>
                    <TableHead className="w-[28%]">{t("Tested")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("By type")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Open gaps")}</TableHead>
                    <TableHead className="pr-6 text-right">{t("Action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const c = r.coverage;
                    const pct = pctOf(r) ?? 0;
                    return (
                      <TableRow key={r.task.id}>
                        <TableCell className="py-3 pl-6">
                          <div className="font-medium">{r.task.name || r.task.description || r.task.id}</div>
                          <div className="text-muted-foreground text-xs">
                            #{r.task.id} · {statusMeta("task", r.task.status).label}
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2">
                            <Progress value={Math.round(pct * 100)} className={cn("h-2 flex-1", barTone(pct))} />
                            <span className="w-24 text-right text-sm tabular-nums">
                              {c?.tested}/{c?.denominator} · {Math.round(pct * 100)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden py-3 lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {[...(c?.by_type ?? [])]
                              .filter((b) => b.total > 0)
                              .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
                              .map((b) => (
                                <Badge
                                  key={b.type}
                                  variant="outline"
                                  className={cn(
                                    "font-normal tabular-nums",
                                    b.tested < b.total && "border-amber-500/50",
                                  )}
                                >
                                  {t(TYPE_LABEL[b.type] ?? b.type)} {b.tested}/{b.total}
                                </Badge>
                              ))}
                          </div>
                        </TableCell>
                        <TableCell className="hidden py-3 md:table-cell">
                          {c?.gaps?.length ? (
                            <span className="text-amber-700 text-sm dark:text-amber-400">{c.gaps.length}</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">0</span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 pr-6 text-right">
                          <Button asChild size="sm" variant={pct < 0.8 ? "default" : "outline"} className="gap-1">
                            <Link prefetch={false} href={`/function/tasks/detail?id=${r.task.id}&tab=coverage`}>
                              {pct < 1 ? t("Test the gaps") : t("Open coverage map")}
                              <ArrowRight className="size-3.5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        {t("No coverage data yet. Run a task with assets in scope to measure coverage.")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
            {noData.length > 0 && !d.loading && (
              <p className="border-t px-6 py-3 text-muted-foreground text-xs">
                {t("{n} more tasks have no in-scope assets to measure yet.", { n: String(noData.length) })}
              </p>
            )}
          </CardContent>
        </Card>

        <aside className="grid content-start gap-4 md:grid-cols-2 2xl:grid-cols-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Tested vs. untested by asset type")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {byType.length === 0 && <p className="text-muted-foreground text-sm">{t("No coverage data yet")}</p>}
              {byType.map(([type, v]) => {
                const p = v.total ? v.tested / v.total : 0;
                return (
                  <div key={type} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm">
                      <span>{t(TYPE_LABEL[type] ?? type)}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {v.tested}/{v.total}
                      </span>
                    </div>
                    <Progress value={Math.round(p * 100)} className={cn("h-1.5", barTone(p))} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Open coverage gaps")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {gaps.length === 0 && (
                <p className="text-muted-foreground text-sm">{t("No open gaps reported by the coverage ledger.")}</p>
              )}
              {gaps.slice(0, 8).map((g, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: gaps have no stable id
                  key={i}
                  className="flex gap-2 text-sm leading-snug"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <span>
                    <span className="font-medium">{g.risk_area}</span>
                    {g.surface ? <span className="text-muted-foreground"> · {g.surface}</span> : null}
                    <span className="block text-muted-foreground text-xs">
                      {g.task.name || g.task.description || g.task.id}
                    </span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
