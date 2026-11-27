"use client";

import { t } from "@/i18n";
import type { BlindSpotReason, CoverageState } from "@/lib/types";
import { cn } from "@/lib/utils";

export const COVERAGE_STATE_META: Record<CoverageState, { label: string; className: string }> = {
  validated: {
    label: "Validated",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  partially_validated: {
    label: "Partially validated",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  unvalidated_blind_spot: {
    label: "Blind spot",
    className: "border-slate-400/50 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  stale_validation: {
    label: "Stale validation",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  out_of_scope: {
    label: "Out of scope",
    className: "border-border bg-muted text-muted-foreground",
  },
};

export const REASON_META: Record<BlindSpotReason, { label: string; className: string; hint: string }> = {
  never_tested: {
    label: "Never tested",
    className: "border-slate-400/50 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    hint: "Discovered, but no validation has ever touched it.",
  },
  awaiting_guard_approval: {
    label: "Awaiting approval",
    className: "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300",
    hint: "A pending guard approval is holding validation on this asset.",
  },
  blocked_by_auth_or_waf: {
    label: "Blocked by auth/WAF",
    className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    hint: "Evidence shows 401/403/429 responses or a WAF without valid credentials.",
  },
  budget_exhausted: {
    label: "Budget exhausted",
    className: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    hint: "The run that would have reached it stopped on a turn/token/request budget.",
  },
  cadence_expired: {
    label: "Cadence expired",
    className: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    hint: "Validated before, but longer ago than its cadence policy allows.",
  },
  out_of_scope: {
    label: "Out of scope",
    className: "border-border bg-muted text-muted-foreground",
    hint: "Excluded by a scope rule or the asset blocklist; never tested on purpose.",
  },
};

export const REASON_ORDER: BlindSpotReason[] = [
  "never_tested",
  "awaiting_guard_approval",
  "blocked_by_auth_or_waf",
  "budget_exhausted",
  "cadence_expired",
  "out_of_scope",
];

export function CoverageStateBadge({ state, className }: { state?: CoverageState; className?: string }) {
  if (!state) return null;
  const m = COVERAGE_STATE_META[state];
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 font-medium text-[11px]",
        m.className,
        className,
      )}
    >
      {t(m.label)}
    </span>
  );
}

export function ReasonBadge({ reason, className }: { reason?: BlindSpotReason | ""; className?: string }) {
  if (!reason) return null;
  const m = REASON_META[reason];
  return (
    <span
      title={t(m.hint)}
      className={cn(
        "inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 font-medium text-[11px]",
        m.className,
        className,
      )}
    >
      {t(m.label)}
    </span>
  );
}
