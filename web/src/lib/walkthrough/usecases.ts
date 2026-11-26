// In-product guided walkthrough content model.
//
// The walkthrough is organised as USE CASES (business scenarios), each with one or
// more STEPS. The Guide Card renders four structured sections per step, each tailored
// to the active persona (Executive/CISO vs. Analyst/SecEng) and switchable in place:
//   1. businessProblem — why organizations struggle here
//   2. artexValue      — the concrete operational & risk outcome ARTEX delivers
//   3. lookingAt       — "What you're looking at": the data on screen
//   4. action          — "Guided action": the exact click/filter instruction
//
// Steps are stored as a single flat list; the store walks it with Back/Next, and the
// use-case switcher jumps to a use case's first step. "Step X of Y" is computed within
// the current use case.

export type Persona = "executive" | "analyst";

export interface StepContent {
  businessProblem: string;
  artexValue: string;
  lookingAt: string;
  action: string;
}

export interface Step {
  id: string;
  useCase: number; // 1..6
  /** Headline shown above the sections. */
  headline: string;
  /** Route to navigate to (static-export path; may include query). */
  path: string;
  /** data-tour anchor to spotlight once the route has rendered. */
  anchor: string;
  /** Optional: a data-tour selector to click before spotlighting (e.g. open a drawer). */
  autoClick?: string;
  executive: StepContent;
  analyst: StepContent;
}

export interface UseCase {
  id: number;
  title: string;
  /** false = listed in the switcher but not yet implemented. */
  available: boolean;
}

// Seeded demo handles the walkthrough deep-links to.
export const DEMO_TASK_ID = "9001"; // Acme Web (acme.com) task used by UC2/UC3/UC6
export const DEMO_ENDPOINT_ASSET_ID = 9210; // canonical /api/v2/invoices/{id} on acme.demo.local

export const PERSONA_LABELS: Record<Persona, { short: string; long: string }> = {
  executive: { short: "Executive", long: "Executive (CISO)" },
  analyst: { short: "Analyst", long: "Analyst (SecEng)" },
};

export const USE_CASES: UseCase[] = [
  { id: 1, title: "Asset Normalization & Deduplication", available: true },
  { id: 2, title: "Coverage & Blind-Spot Triage", available: true },
  { id: 3, title: "Multi-Step Attack Paths", available: true },
  { id: 4, title: "Proof-Backed Triage", available: true },
  { id: 5, title: "Guardrailed Execution", available: true },
  { id: 6, title: "Closing the Remediation Loop", available: true },
];

export const STEPS: Step[] = [
  // ───────────────────────── Use Case 1 — 4 steps ─────────────────────────
  {
    id: "uc1-overview",
    useCase: 1,
    headline: "The asset-sprawl problem",
    path: "/function/assets/",
    anchor: "assets-root",
    executive: {
      businessProblem:
        "Fragmented scanners and overlapping recon tasks inflate asset inventories with duplicate IPs, subdomains and endpoints, so leadership can't trust the true size of the attack surface.",
      artexValue:
        "ARTEX consolidates every raw agent observation into one canonical Asset Graph shared across all tasks — one source of truth, no duplicate noise inflating the numbers.",
      lookingAt:
        "The shared Asset Graph for Acme Cloud Corp (acme.demo.local). Every count here is a canonical asset, not a raw observation.",
      action:
        "Note the acme.demo.local root scope and the per-type counts — this is the deduplicated attack surface across all three discovery tasks.",
    },
    analyst: {
      businessProblem:
        "Three separate discovery/test tasks each reported overlapping hosts; naive tooling stores 3× the rows and breaks finding attribution.",
      artexValue:
        "Deterministic dedup keys (uq_av2_*) collapse overlapping raw observations into single canonical nodes, so facts and findings bind to one asset id.",
      lookingAt:
        "The canonical asset table for acme.demo.local: root_domain, subdomains, IPs, services, apps and endpoints.",
      action:
        "Scan the type tabs — each count is post-dedup. Next we open one canonical endpoint and see its merge lineage.",
    },
  },
  {
    id: "uc1-hierarchy",
    useCase: 1,
    headline: "Hierarchical normalization (root_domain → endpoint)",
    path: "/function/assets/?type=endpoint",
    anchor: "asset-type-tabs",
    executive: {
      businessProblem:
        "Without a canonical hierarchy you can't tell which endpoint belongs to which app, IP or business unit — so risk can't be rolled up to an owner.",
      artexValue:
        "ARTEX keeps the full chain root_domain → subdomain → ip → service → app → endpoint, so every endpoint rolls up to a system and an exposure.",
      lookingAt: "The asset type tabs mirror the canonical hierarchy for acme.demo.local.",
      action: "Open the Endpoints tab and locate /api/v2/invoices/{id} — then continue to open its canonical record.",
    },
    analyst: {
      businessProblem: "Raw observations arrive as flat (host, url) pairs with no parent linkage.",
      artexValue:
        "Each node stores root_domain / domain / url, so the parent→child lineage is reconstructed deterministically rather than guessed.",
      lookingAt:
        "Endpoints resolve to a service (443/tcp https), an IP (198.51.100.14) and the Customer Billing Portal app.",
      action: "Switch to the Endpoints tab; the next step opens /api/v2/invoices/{id} and its deduplication key.",
    },
  },
  {
    id: "uc1-dedup",
    useCase: 1,
    headline: "Deterministic deduplication keys",
    path: `/function/assets/?type=endpoint&inspect=${DEMO_ENDPOINT_ASSET_ID}`,
    anchor: "asset-dedup-key",
    executive: {
      businessProblem:
        "Duplicate asset rows mean the same risk is counted — and re-tested — many times, wasting budget and skewing exposure metrics.",
      artexValue:
        "One canonical node per real asset: three overlapping task observations merged into a single record with one stable identity.",
      lookingAt:
        "The canonical record for /api/v2/invoices/{id}. “Merged observations” lists the 3 tasks that independently reported it.",
      action:
        "Read the Deduplication key and the 3 merged task observations — the same asset, reported 3×, stored once.",
    },
    analyst: {
      businessProblem:
        "Scanners emit (url, method) tuples that differ only by casing, a trailing slash or port form, exploding the inventory.",
      artexValue:
        "The dedup key normalizes (type, url, method) into one uniqueness tuple (uq_av2_endpoint), so re-observations UPSERT onto the same id.",
      lookingAt:
        "The node inspector: canonical identity, computed dedup key, parent→child lineage and the contributing task ids.",
      action: "Inspect the Deduplication key and the 3 contributing tasks merged into canonical asset #9210.",
    },
  },
  {
    id: "uc1-enrichment",
    useCase: 1,
    headline: "Cross-task enrichment value",
    path: `/function/assets/?type=endpoint&inspect=${DEMO_ENDPOINT_ASSET_ID}`,
    anchor: "asset-provenance",
    executive: {
      businessProblem:
        "When findings live per-scan, nobody sees that two different tests both hit the same asset — correlated risk is missed.",
      artexValue:
        "Because the asset is canonical, findings and facts from different tasks attach to the same node — a single, enriched risk picture.",
      lookingAt: "This node's contributing tasks and the findings aggregated onto it from more than one task.",
      action:
        "See how findings from different tasks attach to this one canonical endpoint — correlated, not scattered.",
    },
    analyst: {
      businessProblem: "Finding attribution breaks when the same asset exists under N duplicate ids.",
      artexValue:
        "A finding's asset_ids reference the canonical node, so Task A's and Task B's findings both resolve to endpoint #9210.",
      lookingAt: "Contributing tasks plus the findings bound to this canonical endpoint.",
      action: "Confirm findings from separate tasks resolve to the same asset id — cross-task enrichment on one node.",
    },
  },

  // ───────────────────────── Use Case 2 ─────────────────────────
  {
    id: "uc2-coverage",
    useCase: 2,
    headline: "Validated vs. unvalidated exposure",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=coverage`,
    anchor: "task-coverage",
    executive: {
      businessProblem:
        "Teams can't tell tested surface from untested surface, so security spend chases noise instead of real blind spots.",
      artexValue: "A quantified tested-vs-untested view per asset makes unvalidated exposure explicit and fundable.",
      lookingAt: "The coverage percentage and the named coverage gaps for this task.",
      action: "Read the coverage score and the gaps — those surfaces still carry unknown risk.",
    },
    analyst: {
      businessProblem: "Coverage estimated from scan counts is meaningless without per-asset grounding.",
      artexValue:
        "exploration_anchors tie each intent/fact to a concrete asset, so coverage is computed per real node.",
      lookingAt: "The coverage ledger: surface × risk-area × outcome (reported / ruled_out / needs_follow_up).",
      action: "Inspect the ledger and filter the untested assets.",
    },
  },

  // ───────────────────────── Use Case 3 ─────────────────────────
  {
    id: "uc3-attack-paths",
    useCase: 3,
    headline: "Chained, exploitable risk — not CVE noise",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=graph`,
    anchor: "exploration-graph",
    executive: {
      businessProblem: "Thousands of isolated CVEs bury the few chains that actually reach crown-jewel data.",
      artexValue: "ARTEX shows the real path from entry to impact, so you prioritize demonstrated business risk.",
      lookingAt: "The exploration graph: entry → foothold → admin/domain takeover.",
      action: "Follow the path left→right; the red “proves” edge is a demonstrated risk.",
    },
    analyst: {
      businessProblem: "Flat vuln lists lose the reasoning that connects a foothold to impact.",
      artexValue: "Typed edges (spawns / derived_from / yields / proves) record a reproducible reasoning trail.",
      lookingAt: "goal → intent → fact → finding nodes with their lineage edges.",
      action: "Trace a finding back along its “proves” edge to its goal.",
    },
  },

  // ───────────────────────── Use Case 4 ─────────────────────────
  {
    id: "uc4-evidence",
    useCase: 4,
    headline: "Proof-backed triage, zero false-positive tax",
    path: "/function/findings/",
    anchor: "nav-findings",
    executive: {
      businessProblem:
        "Engineers burn cycles confirming or refuting low-context alerts, and audits demand proof teams don't have.",
      artexValue:
        "Every finding carries verifiable proof of exposure, so remediation starts immediately and audits are a click away.",
      lookingAt: "The findings register with severity tiles and verification badges.",
      action: "Open the Critical finding and view the evidence bound to it.",
    },
    analyst: {
      businessProblem: "A finding without the exact request/response is unverifiable and gets re-litigated.",
      artexValue: "Captured HTTP requests/responses and worker traces attach to the finding that cites them.",
      lookingAt: "Findings with their bound traffic-evidence counts.",
      action: "Open a finding → Linked traffic → View message to see the payload and response.",
    },
  },

  // ───────────────────────── Use Case 5 ─────────────────────────
  {
    id: "uc5-guardrails",
    useCase: 5,
    headline: "Guardrailed execution & scope control",
    path: "/system/intercept/",
    anchor: "nav-intercept",
    executive: {
      businessProblem: "Autonomous testing near production is unsafe without policy governance and human sign-off.",
      artexValue:
        "Allow/deny/ask gates, scope boundaries and budgets keep autonomy safe — coverage without losing control.",
      lookingAt: "The interception rule engine that gates risky tool actions.",
      action: "Review the allow / deny / ask rules and where human approval is required.",
    },
    analyst: {
      businessProblem: "A blanket on/off switch can't express “sqlmap only with approval, never rm -rf”.",
      artexValue:
        "Rules match by tool name, argv-prefix or regex (first match wins); unmatched defers to a model judge.",
      lookingAt: "Rule priority order, including “ask before sqlmap” and “deny destructive shell”.",
      action: "Inspect the priority order and approve a pending human-in-the-loop gate.",
    },
  },

  // ───────────────────────── Use Case 6 ─────────────────────────
  {
    id: "uc6-retest",
    useCase: 6,
    headline: "Closing the remediation loop",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=retests`,
    anchor: "task-retests",
    executive: {
      businessProblem: "Proving a fix usually means waiting for a full-environment rescan, blowing the SLA.",
      artexValue: "Targeted retests verify a specific fix fast, with clean closure evidence for auditors.",
      lookingAt: "The retest view for this task's findings.",
      action: "Open a retest and read the verdict — it re-checks just the patched finding.",
    },
    analyst: {
      businessProblem: "Ad-hoc re-tests lose the original payload and can't be compared to the first result.",
      artexValue: "A scoped retest replays against the exact asset/finding and compares pre- vs post-fix evidence.",
      lookingAt: "The retest session: same payload, fresh capture, verdict reproduced/fixed.",
      action: "Review a retest and compare its evidence to the original finding.",
    },
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────
export const stepUseCase = (index: number): number => STEPS[index]?.useCase ?? 1;

export const firstStepIndexOf = (useCase: number): number => {
  const i = STEPS.findIndex((s) => s.useCase === useCase);
  return i < 0 ? 0 : i;
};

/** { x, y } position of a step within its use case (1-based x, y = total in that use case). */
export function stepNumber(index: number): { x: number; y: number } {
  const uc = stepUseCase(index);
  const steps = STEPS.filter((s) => s.useCase === uc);
  const first = firstStepIndexOf(uc);
  return { x: index - first + 1, y: steps.length };
}
