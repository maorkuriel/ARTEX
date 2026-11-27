"use client";

import { t } from "@/i18n";
import type { BusinessCriticality, PostureStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const POSTURE_META: Record<PostureStatus, { label: string; className: string; dot: string }> = {
  critical_exposure: {
    label: "Critical exposure",
    className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  high_exposure: {
    label: "High exposure",
    className: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  pending_retest: {
    label: "Pending retest",
    className: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  validated_clean: {
    label: "Validated clean",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  unvalidated_blind_spot: {
    label: "Blind spot",
    className: "border-slate-400/50 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    dot: "bg-slate-400",
  },
};

export const CRITICALITY_META: Record<BusinessCriticality, { short: string; label: string; className: string }> = {
  tier_1_crown_jewel: {
    short: "Tier 1",
    label: "Tier 1 · Crown jewel",
    className: "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  tier_2_business: {
    short: "Tier 2",
    label: "Tier 2 · Business",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  tier_3_standard: {
    short: "Tier 3",
    label: "Tier 3 · Standard",
    className: "border-border bg-muted text-muted-foreground",
  },
};

export const VALIDATION_MODE_LABEL: Record<string, string> = {
  read_only_validation: "Read-only validation",
  controlled_active_validation: "Controlled active validation",
  "": "Standard rules",
};

export function PostureStatusBadge({ status, className }: { status?: PostureStatus; className?: string }) {
  if (!status) return null;
  const m = POSTURE_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-medium text-[11px]",
        m.className,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {t(m.label)}
    </span>
  );
}

export function CriticalityBadge({
  tier,
  full,
  className,
}: {
  tier?: BusinessCriticality;
  full?: boolean;
  className?: string;
}) {
  if (!tier) return null;
  const m = CRITICALITY_META[tier];
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 font-medium text-[11px]",
        m.className,
        className,
      )}
      title={t(m.label)}
    >
      {t(full ? m.label : m.short)}
    </span>
  );
}

function scoreTone(score: number) {
  if (score >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** Score as a small colored number (0–100). */
export function PostureScore({ score, className }: { score?: number; className?: string }) {
  if (score === undefined) return null;
  const tone = scoreTone(score);
  return <span className={cn("font-semibold tabular-nums", tone, className)}>{score}</span>;
}

/** Compact table cell: status, score, tier, owner. */
export function PostureCell({
  status,
  score,
  tier,
  owner,
}: {
  status?: PostureStatus;
  score?: number;
  tier?: BusinessCriticality;
  owner?: string;
}) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex min-w-[12rem] flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <PostureStatusBadge status={status} />
        <PostureScore score={score} className="text-xs" />
        <CriticalityBadge tier={tier} />
      </div>
      {owner && owner !== "Unassigned" && <span className="truncate text-[11px] text-muted-foreground">{owner}</span>}
    </div>
  );
}
