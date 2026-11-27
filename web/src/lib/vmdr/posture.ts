"use client";

// Loads and derives the cross-pillar picture used by the Focus Queue and Test Coverage
// screens: discovered assets, per-task coverage, open exposure, fixes awaiting verification
// and pending approvals. Read-only, built from existing APIs.

import * as React from "react";

import { api } from "@/lib/api";
import type { Finding, FindingRetest, InterceptPending, Severity, Task } from "@/lib/types";

export type TaskCoverage = Awaited<ReturnType<typeof api.taskCoverage>>;

export interface TaskCoverageRow {
  task: Task;
  coverage: TaskCoverage | null;
}

/** Statuses that still represent live, unresolved exposure. */
export const OPEN_STATUSES = new Set(["pending", "in_progress", "confirmed"]);
/** Statuses where a fix was reported and should be verified by a retest. */
export const FIXED_STATUSES = new Set(["resolved", "fixed"]);

export interface PostureData {
  loading: boolean;
  error: string | null;
  assetCounts: Record<string, number>;
  assetTotal: number;
  coverage: TaskCoverageRow[];
  tested: number;
  denominator: number;
  findings: Finding[];
  open: Finding[];
  awaitingVerify: { finding: Finding; latest?: FindingRetest }[];
  pending: InterceptPending[];
  guardrailRules: number;
  blocklistRules: number;
  reload: () => void;
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const bySeverity = (a: Finding, b: Finding) => SEV_RANK[a.severity] - SEV_RANK[b.severity];

export function usePostureData(company?: string, opts: { retests?: boolean } = {}): PostureData {
  const withRetests = opts.retests ?? true;
  const [state, setState] = React.useState<Omit<PostureData, "reload">>({
    loading: true,
    error: null,
    assetCounts: {},
    assetTotal: 0,
    coverage: [],
    tested: 0,
    denominator: 0,
    findings: [],
    open: [],
    awaitingVerify: [],
    pending: [],
    guardrailRules: 0,
    blocklistRules: 0,
  });
  const [tick, setTick] = React.useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the manual reload trigger
  React.useEffect(() => {
    let live = true;
    void (async () => {
      const companyId = company ? Number(company) : null;
      const [countsR, tasksR, findingsR, pendingR, rulesR, blockR] = await Promise.allSettled([
        api.assetCounts(),
        api.tasks(companyId),
        api.findingsPage({ page: 1, pageSize: 200, sort: "severity", company }),
        api.interceptPending(),
        api.interceptRules(),
        api.assetInterceptRules(),
      ]);
      const counts = countsR.status === "fulfilled" ? (countsR.value ?? {}) : {};
      const tasks = tasksR.status === "fulfilled" ? tasksR.value.tasks : [];
      const findings = findingsR.status === "fulfilled" ? (findingsR.value.items ?? []) : [];

      const covResults = await Promise.allSettled(tasks.slice(0, 30).map((tk) => api.taskCoverage(tk.id)));
      const coverage: TaskCoverageRow[] = tasks.slice(0, 30).map((task, i) => {
        const r = covResults[i];
        return { task, coverage: r.status === "fulfilled" ? r.value : null };
      });

      const fixed = findings.filter((f) => FIXED_STATUSES.has(f.status) && f.finding_id).slice(0, 12);
      let awaitingVerify: PostureData["awaitingVerify"] = [];
      if (withRetests) {
        const rt = await Promise.allSettled(fixed.map((f) => api.findingRetests(String(f.finding_id))));
        awaitingVerify = fixed
          .map((finding, i) => {
            const r = rt[i];
            const list = r.status === "fulfilled" ? r.value : [];
            const latest = [...list].sort((a, b) => b.id - a.id)[0];
            return { finding, latest };
          })
          // Verified fixed by the latest retest → no longer needs attention.
          .filter((x) => x.latest?.verdict !== "fixed");
      }

      if (!live) return;
      const withCov = coverage.filter((c) => c.coverage?.enabled && c.coverage.denominator > 0);
      setState({
        loading: false,
        error: findingsR.status === "rejected" && tasksR.status === "rejected" ? String(findingsR.reason) : null,
        assetCounts: counts,
        assetTotal: Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0),
        coverage,
        tested: withCov.reduce((a, c) => a + (c.coverage?.tested ?? 0), 0),
        denominator: withCov.reduce((a, c) => a + (c.coverage?.denominator ?? 0), 0),
        findings,
        open: findings.filter((f) => OPEN_STATUSES.has(f.status)).sort(bySeverity),
        awaitingVerify,
        pending: pendingR.status === "fulfilled" ? pendingR.value : [],
        guardrailRules: rulesR.status === "fulfilled" ? rulesR.value.filter((r) => r.enabled).length : 0,
        blocklistRules: blockR.status === "fulfilled" ? blockR.value.filter((r) => r.enabled !== false).length : 0,
      });
    })();
    return () => {
      live = false;
    };
  }, [company, withRetests, tick]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}

// ── Overall posture ──────────────────────────────────────────────────────────

export interface PostureScore {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  /** Low when most in-scope assets are untested: a good grade would not be trustworthy. */
  confidence: "high" | "medium" | "low";
  factors: { label: string; delta: number }[];
}

function gradeFor(score: number): PostureScore["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function confidenceFor(cov: number | null): PostureScore["confidence"] {
  if (cov === null || cov < 0.5) return "low";
  if (cov < 0.8) return "medium";
  return "high";
}

export function postureScore(open: Finding[], tested: number, denominator: number): PostureScore {
  const n = (s: Severity) => open.filter((f) => f.severity === s).length;
  const factors: { label: string; delta: number }[] = [];
  const crit = Math.min(50, n("critical") * 20);
  const high = Math.min(32, n("high") * 8);
  const med = Math.min(12, n("medium") * 3);
  if (crit) factors.push({ label: `${n("critical")} open critical`, delta: -crit });
  if (high) factors.push({ label: `${n("high")} open high`, delta: -high });
  if (med) factors.push({ label: `${n("medium")} open medium`, delta: -med });
  const cov = denominator > 0 ? tested / denominator : null;
  const covPenalty = cov === null ? 10 : Math.round((1 - cov) * 20);
  if (covPenalty) {
    const label = cov === null ? "coverage unknown" : `${Math.round((1 - cov) * 100)}% untested`;
    factors.push({ label, delta: -covPenalty });
  }
  const score = Math.max(0, 100 - crit - high - med - covPenalty);
  return { score, grade: gradeFor(score), confidence: confidenceFor(cov), factors };
}
