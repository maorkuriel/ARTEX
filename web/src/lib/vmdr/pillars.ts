// VMDR information architecture: the five pillars every screen belongs to, plus the
// four-step operating loop that moves a user from "where do I focus?" to a verified fix.
// One source of truth for the sidebar groups, the pillar banner on each page, the
// Focus Queue and the in-product docs, so the words never drift apart.

export type VmdrPillarId = "posture" | "assets" | "coverage" | "exposure" | "guardrails";

export interface VmdrPillar {
  id: VmdrPillarId;
  /** Sidebar group / banner title. */
  title: string;
  /** Short subtitle naming the artifacts in this pillar. */
  artifacts: string;
  /** The one question this pillar answers. */
  question: string;
  /** One plain-English sentence on what lives here (and what does not). */
  description: string;
  /** Main screen for the pillar. */
  href: string;
  /** Route prefixes (no trailing slash) that belong to this pillar. */
  routes: string[];
}

export const VMDR_PILLARS: VmdrPillar[] = [
  {
    id: "posture",
    title: "Posture & Focus",
    artifacts: "Overview · Focus Queue",
    question: "Where do I need to focus right now?",
    description:
      "Overall asset security posture in one place: top risk exposures, untested high-value blind spots, pending approvals and the recommended next action.",
    href: "/focus",
    routes: ["/focus", "/dashboard"],
  },
  {
    id: "assets",
    title: "Discovered Assets",
    artifacts: "Inventory · Asset Graph",
    question: "What exists in our environment?",
    description:
      "Only what exists: the de-duplicated hierarchy from root domain down to endpoint, where each asset came from, and its posture snapshot. Not whether it was tested.",
    href: "/function/assets",
    routes: ["/function/assets", "/function/sync"],
  },
  {
    id: "coverage",
    title: "Coverage Status",
    artifacts: "Test Coverage · Anchors",
    question: "What has been tested, and what has not?",
    description:
      "Only testing reach: tested vs. untested assets and the gaps between them. An untested asset is a blind spot, never a clean result.",
    href: "/coverage",
    routes: ["/coverage"],
  },
  {
    id: "exposure",
    title: "Risk Exposure",
    artifacts: "Attack Paths · Findings · Proof",
    question: "What is actually exposed, and can we prove it?",
    description:
      "Only what is provably exploitable: chained attack paths, confirmed findings with their HTTP proof, how to mitigate and remediate each one, and the retest that verifies the fix.",
    href: "/function/findings",
    routes: ["/function/findings", "/function/traffic"],
  },
  {
    id: "guardrails",
    title: "Scope & Guardrails",
    artifacts: "Scope · Rules · Approvals",
    question: "What may ARTEX touch, and who signs off?",
    description:
      "Only boundaries and safe execution: allow/deny rules, the asset blocklist, run budgets and the human approval queue for risky steps.",
    href: "/system/intercept",
    routes: ["/system/intercept"],
  },
];

export const pillarById = (id: VmdrPillarId) => VMDR_PILLARS.find((p) => p.id === id) as VmdrPillar;

/** The pillar a route belongs to (longest matching prefix), or undefined for operations/system/learn screens. */
export function pillarForPath(pathname: string): VmdrPillar | undefined {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    /* keep raw */
  }
  p = p.replace(/\/+$/, "") || "/";
  let best: VmdrPillar | undefined;
  let bestLen = -1;
  for (const pillar of VMDR_PILLARS) {
    for (const r of pillar.routes) {
      if ((p === r || p.startsWith(`${r}/`)) && r.length > bestLen) {
        best = pillar;
        bestLen = r.length;
      }
    }
  }
  return best;
}

// ── The operating loop ───────────────────────────────────────────────────────

export interface FlowStep {
  n: number;
  title: string;
  summary: string;
  href: string;
  /** Pillars whose screens belong to this step. */
  pillars: VmdrPillarId[];
}

export const VMDR_FLOW: FlowStep[] = [
  {
    n: 1,
    title: "Scope & Discover",
    summary: "Confirm what is in scope, then review the de-duplicated assets and their baseline posture.",
    href: "/function/assets",
    pillars: ["guardrails", "assets"],
  },
  {
    n: 2,
    title: "Check Coverage",
    summary: "Find the tested vs. untested gaps, so a blind spot is never mistaken for a clean bill of health.",
    href: "/coverage",
    pillars: ["coverage"],
  },
  {
    n: 3,
    title: "Inspect Exposure",
    summary: "Review chained attack paths, confirmed findings and their HTTP proof to see what is truly exploitable.",
    href: "/function/findings",
    pillars: ["exposure"],
  },
  {
    n: 4,
    title: "Mitigate, Remediate & Verify",
    summary: "Contain the risk now, fix the root cause, then launch a retest to prove the fix closed it.",
    href: "/focus",
    pillars: ["posture"],
  },
];

/** Which loop step a pillar sits in (Scope & Guardrails and Discovered Assets are both step 1). */
export const flowStepForPillar = (id: VmdrPillarId): FlowStep | undefined =>
  VMDR_FLOW.find((s) => s.pillars.includes(id));
