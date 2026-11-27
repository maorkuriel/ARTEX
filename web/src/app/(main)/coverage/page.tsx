"use client";

import * as React from "react";

import Link from "next/link";

import { ClipboardCheck, KeyRound, Loader2, Plus, Radar, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { WalkthroughButton } from "@/components/docs/doc-blocks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AnchorProvenance } from "@/components/vmdr/anchor-provenance";
import { AssetPosturePanel } from "@/components/vmdr/asset-posture-panel";
import { REASON_META, REASON_ORDER, ReasonBadge } from "@/components/vmdr/coverage-badges";
import { CRITICALITY_META, CriticalityBadge, VALIDATION_MODE_LABEL } from "@/components/vmdr/posture-badges";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type {
  BlindSpot,
  BlindSpotReason,
  BusinessCriticality,
  CoverageBucket,
  CoveragePolicy,
  CoverageSummary,
  CoverageTrigger,
  CoverageValidationResult,
  ValidationMode,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useActiveCompany } from "@/stores/company/company-store";

import { EngagementCoverage } from "./_components/engagement-coverage";

const TRIGGER_LABEL: Record<CoverageTrigger, string> = {
  on_new_endpoint_discovered: "New endpoint discovered",
  on_cadence_expired: "Cadence expired",
  on_high_priority_cve_ingested: "High-priority CVE ingested",
};

const RESULT_LABEL: Record<CoverageValidationResult["status"], string> = {
  completed: "Validated",
  held_for_approval: "Held for approval",
  queued: "Queued",
  rejected: "Rejected",
  denied: "Denied",
};

function pctTone(p: number) {
  if (p >= 80) return "[&>div]:bg-emerald-500";
  if (p >= 50) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-red-500";
}

function draftHref(d: NonNullable<CoverageValidationResult["task_draft"]>) {
  return `/function/tasks?${new URLSearchParams({ new: "1", ...d }).toString()}`;
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-4 shadow-xs">
      <span className="font-medium text-muted-foreground text-sm">{label}</span>
      <span className={cn("font-semibold text-3xl tabular-nums tracking-tight", tone)}>{value}</span>
      <span className="text-muted-foreground text-xs leading-snug">{sub}</span>
    </div>
  );
}

function Buckets({
  title,
  buckets,
  label,
}: {
  title: string;
  buckets: CoverageBucket[];
  label?: (k: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {buckets.length === 0 && <p className="text-muted-foreground text-sm">{t("No coverage data yet")}</p>}
        {buckets.map((b) => (
          <div key={b.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{label ? label(b.key) : b.key}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {b.validated}/{b.in_scope} · {Math.round(b.coverage_pct)}%
              </span>
            </div>
            <Progress value={b.coverage_pct} className={cn("h-1.5", pctTone(b.coverage_pct))} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ActionCell({ b, busy, onValidate }: { b: BlindSpot; busy: boolean; onValidate: (ids: number[]) => void }) {
  if (b.recommended_action === "review_approval") {
    return (
      <Button asChild size="sm" variant="outline" className="gap-1">
        <Link prefetch={false} href="/system/intercept/approvals">
          <ClipboardCheck className="size-3.5" />
          {t("Review approval")}
        </Link>
      </Button>
    );
  }
  if (b.recommended_action === "configure_auth") {
    return (
      <Button asChild size="sm" variant="outline" className="gap-1">
        <Link prefetch={false} href="/function/tasks">
          <KeyRound className="size-3.5" />
          {t("Configure auth")}
        </Link>
      </Button>
    );
  }
  if (!b.validatable) return <span className="text-muted-foreground text-xs">{t("Excluded")}</span>;
  return (
    <Button size="sm" className="gap-1" disabled={busy} onClick={() => onValidate([b.asset_id])}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
      {t("Validate safely")}
    </Button>
  );
}

function PolicyCard({ policies, onChanged }: { policies: CoveragePolicy[]; onChanged: () => void }) {
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    tier: "any",
    scope: "",
    cadence: "14",
    mode: "read_only_validation" as ValidationMode,
    triggers: ["on_cadence_expired"] as CoverageTrigger[],
  });
  async function save() {
    try {
      await api.createCoveragePolicy({
        name: form.name,
        business_criticality: form.tier === "any" ? "" : (form.tier as BusinessCriticality),
        scope_pattern: form.scope,
        cadence_days: Number(form.cadence),
        triggers: form.triggers,
        validation_mode: form.mode,
        enabled: true,
      });
      toast.success(t("Coverage policy saved"));
      setAdding(false);
      onChanged();
    } catch (e) {
      toast.error(t("Update failed: {error}", { error: (e as Error).message }));
    }
  }
  async function remove(id: number) {
    try {
      await api.deleteCoveragePolicy(id);
      onChanged();
    } catch (e) {
      toast.error(t("Update failed: {error}", { error: (e as Error).message }));
    }
  }
  return (
    <Card data-tour="coverage-policies">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{t("Coverage policies")}</CardTitle>
        {!adding && (
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            {t("Add")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {policies.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {t("Defaults: Tier 1 every 7 days, Tier 2 every 14, Tier 3 every 30, read-only validation.")}
          </p>
        )}
        {policies.map((p) => (
          <div key={p.id} className="flex items-start justify-between gap-2 rounded-md border px-2.5 py-2 text-sm">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{p.name}</span>
                {p.business_criticality ? <CriticalityBadge tier={p.business_criticality} /> : null}
              </div>
              <p className="text-muted-foreground text-xs leading-snug">
                {t("every {n} days", { n: String(p.cadence_days) })}
                {p.scope_pattern ? ` · *.${p.scope_pattern}` : ""} · {t(VALIDATION_MODE_LABEL[p.validation_mode])}
              </p>
              {p.triggers.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {p.triggers.map((x) => t(TRIGGER_LABEL[x])).join(" · ")}
                </p>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={t("Delete policy")}
              onClick={() => remove(p.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {adding && (
          <div className="flex flex-col gap-2 rounded-md border p-2.5">
            <Input
              placeholder={t("Policy name")}
              aria-label={t("Policy name")}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-8 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <Select value={form.tier} onValueChange={(v) => setForm((f) => ({ ...f, tier: v }))}>
                <SelectTrigger size="sm" className="w-full" aria-label={t("Business criticality")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t("Any tier")}</SelectItem>
                  {(Object.keys(CRITICALITY_META) as BusinessCriticality[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(CRITICALITY_META[k].label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                max={365}
                aria-label={t("Cadence (days)")}
                value={form.cadence}
                onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <Input
              placeholder={t("Scope (domain suffix, optional)")}
              aria-label={t("Scope (domain suffix, optional)")}
              value={form.scope}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
              className="h-8 text-sm"
            />
            <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v as ValidationMode }))}>
              <SelectTrigger size="sm" className="w-full" aria-label={t("Validation mode")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read_only_validation">{t("Read-only validation")}</SelectItem>
                <SelectItem value="controlled_active_validation">{t("Controlled active validation")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-1">
              {(Object.keys(TRIGGER_LABEL) as CoverageTrigger[]).map((tr) => (
                <span key={tr} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    aria-label={t(TRIGGER_LABEL[tr])}
                    checked={form.triggers.includes(tr)}
                    onCheckedChange={(c) =>
                      setForm((f) => ({
                        ...f,
                        triggers: c ? [...f.triggers, tr] : f.triggers.filter((x) => x !== tr),
                      }))
                    }
                  />
                  {t(TRIGGER_LABEL[tr])}
                </span>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t("Cancel")}
              </Button>
              <Button size="sm" onClick={save} disabled={!form.name.trim()}>
                {t("Save")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CoverageIntelligencePage() {
  const company = useActiveCompany();
  const [summary, setSummary] = React.useState<CoverageSummary | null>(null);
  const [spots, setSpots] = React.useState<BlindSpot[] | null>(null);
  const [policies, setPolicies] = React.useState<CoveragePolicy[]>([]);
  const [reason, setReason] = React.useState<BlindSpotReason | "all">("all");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [busy, setBusy] = React.useState<Set<number>>(new Set());
  const [results, setResults] = React.useState<CoverageValidationResult[]>([]);
  const [inspect, setInspect] = React.useState<BlindSpot | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    Promise.all([api.coverageSummary(company, tick > 0), api.coverageBlindSpots({ company }), api.coveragePolicies()])
      .then(([s, b, p]) => {
        if (!live) return;
        setSummary(s);
        setSpots(b.blind_spots);
        setPolicies(p.policies);
      })
      .catch((e: Error) => live && toast.error(e.message));
    return () => {
      live = false;
    };
  }, [company, tick]);

  const reload = () => setTick((n) => n + 1);
  const visible = (spots ?? []).filter((b) => reason === "all" || b.blind_spot_reason === reason);
  const selectable = visible.filter((b) => b.validatable);

  async function validate(ids: number[]) {
    setBusy((cur) => new Set([...cur, ...ids]));
    try {
      const r = await api.validateBlindSpots(ids);
      setResults(r.results);
      const done = r.results.filter((x) => x.status === "completed").length;
      const held = r.results.filter((x) => x.status === "held_for_approval").length;
      toast.success(
        t("{done} validated · {held} held for approval · {other} other", {
          done: String(done),
          held: String(held),
          other: String(r.results.length - done - held),
        }),
      );
      setSelected(new Set());
      reload();
    } catch (e) {
      toast.error(t("Update failed: {error}", { error: (e as Error).message }));
    } finally {
      setBusy((cur) => new Set([...cur].filter((x) => !ids.includes(x))));
    }
  }

  const s = summary;
  return (
    <div className="flex flex-col gap-5" data-tour="coverage-root">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
            <Radar className="size-6 text-primary" />
            {t("Coverage Intelligence")}
          </h1>
          <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
            {t(
              "Which assets were actively validated, backed by exploration anchors, and which are blind spots — with the reason each gap exists and a guardrailed way to close it.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={reload}>
            <RefreshCw className="size-3.5" />
            {t("Refresh")}
          </Button>
          <WalkthroughButton useCase={4} />
        </div>
      </div>

      <section data-tour="coverage-kpis" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {s ? (
          <>
            <Kpi
              label={t("In-scope coverage")}
              value={`${Math.round(s.overall.coverage_pct)}%`}
              sub={t("{v} of {n} in-scope assets validated · endpoints {e}%", {
                v: String(s.overall.validated),
                n: String(s.overall.in_scope),
                e: String(Math.round(s.endpoints.coverage_pct)),
              })}
            />
            <Kpi
              label={t("Tier-1 crown-jewel coverage")}
              value={`${Math.round(s.tier1.coverage_pct)}%`}
              tone={
                s.tier1.coverage_pct < 80
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }
              sub={t("{v} of {n} Tier-1 assets validated", {
                v: String(s.tier1.validated),
                n: String(s.tier1.in_scope),
              })}
            />
            <Kpi
              label={t("Untested blind spots")}
              value={s.by_state.unvalidated_blind_spot ?? 0}
              tone="text-red-600 dark:text-red-400"
              sub={t("never validated, with a classified reason")}
            />
            <Kpi
              label={t("Stale validations")}
              value={s.by_state.stale_validation ?? 0}
              tone="text-orange-600 dark:text-orange-400"
              sub={t("validated, but outside the cadence window")}
            />
            <Kpi
              label={t("Out-of-scope (excluded)")}
              value={s.out_of_scope}
              sub={t("excluded by scope rules on purpose")}
            />
          </>
        ) : (
          Array.from({ length: 5 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))
        )}
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_400px] min-[2200px]:grid-cols-[minmax(0,1fr)_440px]">
        <Card data-tour="blind-spot-queue" className="min-w-0 gap-0 py-0">
          <CardHeader className="flex flex-col gap-3 border-b py-4">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{t("Prioritized blind-spot queue")}</CardTitle>
              <Button
                size="sm"
                className="gap-1"
                disabled={selected.size === 0}
                onClick={() => validate([...selected])}
              >
                <ShieldCheck className="size-3.5" />
                {t("Validate selected ({n})", { n: String(selected.size) })}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5" data-tour="blind-spot-reasons">
              <button
                type="button"
                onClick={() => setReason("all")}
                aria-pressed={reason === "all"}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-medium text-xs transition-colors",
                  reason === "all" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {t("All")} {spots?.length ?? 0}
              </button>
              {REASON_ORDER.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  aria-pressed={reason === r}
                  title={t(REASON_META[r].hint)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-medium text-xs transition-colors",
                    reason === r ? "ring-2 ring-primary ring-offset-1" : "hover:opacity-80",
                    REASON_META[r].className,
                  )}
                >
                  {t(REASON_META[r].label)} {s?.by_reason[r] ?? 0}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {spots === null ? (
              <div className="flex flex-col gap-2 p-6">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 pl-4">
                      <Checkbox
                        aria-label={t("Select all")}
                        checked={selectable.length > 0 && selectable.every((b) => selected.has(b.asset_id))}
                        onCheckedChange={(c) => setSelected(c ? new Set(selectable.map((b) => b.asset_id)) : new Set())}
                      />
                    </TableHead>
                    <TableHead>{t("Asset")}</TableHead>
                    <TableHead>{t("Tier · owner")}</TableHead>
                    <TableHead>{t("Reason")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Recommended action")}</TableHead>
                    <TableHead className="pr-4 text-right">{t("Action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((b) => (
                    <TableRow
                      key={b.asset_id}
                      className="cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button,a,[role=checkbox]")) return;
                        setInspect(b);
                      }}
                    >
                      <TableCell className="py-3 pl-4">
                        <Checkbox
                          aria-label={t("Select {name}", { name: b.label })}
                          disabled={!b.validatable}
                          checked={selected.has(b.asset_id)}
                          onCheckedChange={(c) =>
                            setSelected((cur) => {
                              const n = new Set(cur);
                              if (c) n.add(b.asset_id);
                              else n.delete(b.asset_id);
                              return n;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="max-w-[22rem] py-3">
                        <div className="truncate font-medium font-mono text-sm" title={b.label}>
                          {b.label}
                        </div>
                        <div className="truncate text-muted-foreground text-xs">
                          {b.type}
                          {b.parent_label ? ` · ${b.parent_label}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <CriticalityBadge tier={b.business_criticality} />
                        <div className="mt-0.5 text-muted-foreground text-xs">{b.owner_team}</div>
                      </TableCell>
                      <TableCell className="py-3">
                        <ReasonBadge reason={b.blind_spot_reason} />
                        {b.triggers_fired.length > 0 && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {b.triggers_fired.map((x) => t(TRIGGER_LABEL[x])).join(" · ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden max-w-[16rem] whitespace-normal py-3 text-sm lg:table-cell">
                        {t(b.recommended_action_label)}
                        {b.needs_approval && b.validatable && (
                          <span className="block text-[11px] text-muted-foreground">
                            {t("Tier 1: needs human approval")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-3 pr-4 text-right">
                        <ActionCell b={b} busy={busy.has(b.asset_id)} onValidate={validate} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {visible.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {t("No blind spots in this category.")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
            {results.length > 0 && (
              <div
                className="flex flex-col gap-1 border-t bg-muted/30 px-4 py-3 text-sm"
                data-tour="validation-results"
              >
                <p className="font-medium">{t("Last validation request")}</p>
                {results.map((r) => (
                  <div key={r.id || r.asset_id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{t(RESULT_LABEL[r.status])}</span>
                    <span className="font-mono">{r.label ?? `#${r.asset_id}`}</span>
                    <span className="text-muted-foreground">{r.reason}</span>
                    {r.task_draft && (
                      <Link prefetch={false} href={draftHref(r.task_draft)} className="text-primary hover:underline">
                        {t("Open task draft")}
                      </Link>
                    )}
                    {r.status === "held_for_approval" && (
                      <Link
                        prefetch={false}
                        href="/system/intercept/approvals"
                        className="text-primary hover:underline"
                      >
                        {t("Review approval")}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <aside className="grid content-start gap-4 md:grid-cols-2 2xl:grid-cols-1">
          <Buckets
            title={t("Coverage by criticality tier")}
            buckets={s?.by_criticality ?? []}
            label={(k) => t(CRITICALITY_META[k as BusinessCriticality]?.label ?? k)}
          />
          <Buckets title={t("Coverage by owner team")} buckets={(s?.by_owner_team ?? []).slice(0, 8)} />
          <Buckets title={t("Coverage by parent domain")} buckets={(s?.by_parent_domain ?? []).slice(0, 8)} />
          <PolicyCard policies={policies} onChanged={reload} />
        </aside>
      </div>

      <EngagementCoverage />

      <Sheet open={!!inspect} onOpenChange={(o) => !o && setInspect(null)}>
        <SheetContent side="right" className="w-[94vw] gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
          {inspect && (
            <>
              <SheetHeader className="border-b">
                <SheetTitle className="break-all font-mono text-sm">{inspect.label}</SheetTitle>
                <SheetDescription>
                  {inspect.type} · {inspect.owner_team}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 p-4">
                <AssetPosturePanel assetId={inspect.asset_id} onChanged={reload} />
                <AnchorProvenance assetId={inspect.asset_id} refreshKey={tick} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
