"use client";

import * as React from "react";

import Link from "next/link";

import { Gauge, Layers, RefreshCw, ScrollText, ShieldCheck, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { GuardAuditEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const DECISION_STYLE: Record<GuardAuditEvent["decision"], string> = {
  allowed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  blocked: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  denied: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  held_for_approval: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
};

const DECISION_LABEL: Record<GuardAuditEvent["decision"], string> = {
  allowed: "Allowed",
  approved: "Approved",
  blocked: "Blocked",
  denied: "Denied",
  held_for_approval: "Held for approval",
};

const LAYERS = [
  {
    n: 1,
    icon: ShieldCheck,
    title: "Layer 1 · Scope & non-destructive policy",
    body: "Production and Tier-1 assets default to read-only validation: GET/HEAD/OPTIONS and passive probes run; POST/PUT/PATCH/DELETE, request bodies, uploads and exploitation tools are blocked before dispatch. Intercept rules and the asset blocklist apply here too.",
  },
  {
    n: 2,
    icon: Gauge,
    title: "Layer 2 · Blast-radius budgets",
    body: "Per-task, per-target-host request budgets (setting guard_host_request_budget) stop a runaway worker; token/turn budgets and the noise governor cap cost and rate.",
  },
  {
    n: 3,
    icon: UserCheck,
    title: "Layer 3 · Human-in-the-loop",
    body: "Actions against Tier-1 crown jewels, state-changing calls crossing into controlled active validation, and LLM safety-judge escalations wait for a human to approve or deny.",
  },
];

const ALL = "__all__";

export default function GuardAuditPage() {
  const [events, setEvents] = React.useState<GuardAuditEvent[] | null>(null);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [decision, setDecision] = React.useState(ALL);
  const [layer, setLayer] = React.useState(ALL);
  const [tick, setTick] = React.useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the manual reload trigger
  React.useEffect(() => {
    let live = true;
    setEvents(null);
    api
      .guardAudit({
        decision: decision === ALL ? undefined : decision,
        layer: layer === ALL ? undefined : Number(layer),
        limit: 200,
      })
      .then((r) => {
        if (!live) return;
        setEvents(r.events);
        setCounts(r.counts_30d);
      })
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [decision, layer, tick]);

  return (
    <div className="flex flex-col gap-5" data-tour="guard-audit">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
            <ScrollText className="size-6 text-primary" />
            {t("Guard Audit Trail")}
          </h1>
          <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
            {t(
              "Every guardrail decision on a worker action, append-only: who acted, which asset, which policy rule, the decision and why.",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 self-start md:self-auto"
          onClick={() => setTick((n) => n + 1)}
        >
          <RefreshCw className="size-3.5" />
          {t("Refresh")}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3" data-tour="guard-layers">
        {LAYERS.map((l) => (
          <Card key={l.n} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <l.icon className="size-4 text-primary" />
                {t(l.title)}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 text-muted-foreground text-sm leading-snug">{l.body}</CardContent>
          </Card>
        ))}
      </div>

      <Card className="min-w-0 gap-0 py-0">
        <CardHeader className="flex flex-col gap-3 border-b py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{t("Decisions")}</CardTitle>
            {(Object.keys(DECISION_LABEL) as GuardAuditEvent["decision"][]).map((k) => (
              <span key={k} className={cn("rounded-md border px-1.5 py-0.5 text-[11px]", DECISION_STYLE[k])}>
                {t(DECISION_LABEL[k])} {counts[k] ?? 0}
              </span>
            ))}
            <span className="text-muted-foreground text-xs">{t("(last 30 days)")}</span>
          </div>
          <div className="flex gap-2">
            <Select value={decision} onValueChange={setDecision}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("All decisions")}</SelectItem>
                {(Object.keys(DECISION_LABEL) as GuardAuditEvent["decision"][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(DECISION_LABEL[k])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={layer} onValueChange={setLayer}>
              <SelectTrigger size="sm" className="w-32">
                <Layers className="size-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("All layers")}</SelectItem>
                <SelectItem value="1">{t("Layer 1")}</SelectItem>
                <SelectItem value="2">{t("Layer 2")}</SelectItem>
                <SelectItem value="3">{t("Layer 3")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {events === null ? (
            <div className="flex flex-col gap-2 p-6">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{t("Time")}</TableHead>
                  <TableHead>{t("Decision")}</TableHead>
                  <TableHead>{t("Layer")}</TableHead>
                  <TableHead>{t("Policy rule")}</TableHead>
                  <TableHead>{t("Target")}</TableHead>
                  <TableHead>{t("Actor")}</TableHead>
                  <TableHead className="pr-6">{t("Rationale")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap py-3 pl-6 text-xs tabular-nums">
                      {new Date(e.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="py-3">
                      <span
                        className={cn(
                          "whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px]",
                          DECISION_STYLE[e.decision],
                        )}
                      >
                        {t(DECISION_LABEL[e.decision])}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge variant="outline">L{e.layer}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[14rem] whitespace-normal break-words py-3 font-mono text-xs">
                      {e.policy_rule}
                    </TableCell>
                    <TableCell className="py-3 text-sm">
                      {e.target_asset_id ? (
                        <Link
                          prefetch={false}
                          href={`/function/assets/?inspect=${e.target_asset_id}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {e.target || `#${e.target_asset_id}`}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{e.target || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 text-xs">
                      {e.actor}
                      {e.task_id && <span className="block text-muted-foreground">#{e.task_id}</span>}
                      {e.tool_name && <span className="block text-muted-foreground">{e.tool_name}</span>}
                    </TableCell>
                    <TableCell className="min-w-[18rem] max-w-xl whitespace-normal py-3 pr-6 text-sm leading-snug">
                      {e.rationale}
                    </TableCell>
                  </TableRow>
                ))}
                {events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {t("No guard decisions recorded yet.")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
