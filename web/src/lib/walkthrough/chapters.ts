// Guided walkthrough content. Each chapter carries shared navigation mechanics
// (route + the data-tour anchor to spotlight) plus two persona-tailored narratives
// that the Guide Card swaps between in place, without resetting tour progress.
//
// Personas:
//   executive — CISO / Executive: business risk reduction, attack-surface visibility,
//               MTTR / remediation verification, false-positive cost, auditability, guardrails.
//   analyst   — Security Engineer / Analyst: dedup keys, exploration_anchors, graph lineage
//               edges, HTTP receipts, payload traces, scope/rate-limit rules, retest mechanics.

export type Persona = "executive" | "analyst";

export interface PersonaContent {
  /** "What you're looking at" */
  headline: string;
  summary: string;
  /** "Try this / Inspect here" */
  action: string;
  /** "Why it matters" */
  takeaway: string;
}

export interface Chapter {
  id: string;
  /** Short chapter title shown in the Guide Card chrome. */
  title: string;
  /** Route the walkthrough navigates to for this chapter (static-export paths). */
  path: string;
  /** `data-tour` value of the element to spotlight once the route has loaded. */
  anchor: string;
  executive: PersonaContent;
  analyst: PersonaContent;
}

// The seeded demo task the in-task chapters point at (see scripts/demo/seed_demo.py).
export const DEMO_TASK_ID = "9001";

export const PERSONA_LABELS: Record<Persona, { short: string; long: string }> = {
  executive: { short: "Executive", long: "Executive (CISO)" },
  analyst: { short: "Analyst", long: "Analyst (SecEng)" },
};

export const CHAPTERS: Chapter[] = [
  {
    id: "asset-sprawl",
    title: "Taming Asset Sprawl",
    path: "/function/assets/",
    anchor: "nav-assets",
    executive: {
      headline: "One source of truth for your attack surface",
      summary:
        "Every business unit's domains, IPs, services and apps unified in a single graph — with no duplicate-asset inflation padding the numbers.",
      action:
        "Scan the company view and the per-type counts. This is your real external exposure, deduplicated across every task that discovered it.",
      takeaway: "You can finally answer “what do we actually expose?” without reconciling five spreadsheets.",
    },
    analyst: {
      headline: "Canonical, deduplicated asset hierarchy",
      summary:
        "root_domain → subdomain → ip → service → app → endpoint, each row keyed by deterministic dedup keys so the same asset is never double-counted.",
      action:
        "Open the Subdomains / IP / Services type tabs: each row links to its root_domain and resolved IP. Try the DSL search bar (e.g. domain=acme.com AND status_code>=400).",
      takeaway:
        "Stable identity keys (uq_av2_*) mean findings and coverage bind to one canonical asset, not N copies of it.",
    },
  },
  {
    id: "coverage",
    title: "Coverage & Blind-Spot Triage",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=coverage`,
    anchor: "task-coverage",
    executive: {
      headline: "Validated vs. unvalidated exposure",
      summary:
        "A quantified view of what has actually been tested versus what is still a blind spot — so security spend targets real gaps, not noise.",
      action:
        "Read the coverage percentage and the named coverage gaps. Those surfaces still carry unknown, unfunded risk.",
      takeaway:
        "“Absence of a finding is not proof of safety” — this makes untested surface explicit and defensible in a budget review.",
    },
    analyst: {
      headline: "Anchors tie tests to concrete assets",
      summary:
        "exploration_anchors link each intent and fact to the exact endpoint/service it touched, so coverage is computed per real asset — not estimated.",
      action:
        "Inspect the coverage ledger: surface × risk-area × outcome (reported / ruled_out / needs_follow_up / not_applicable) and filter the untested assets.",
      takeaway:
        "You can see which risk classes were exercised against which assets, and exactly what still needs a worker.",
    },
  },
  {
    id: "attack-paths",
    title: "Multi-Step Attack Paths",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=graph`,
    anchor: "exploration-graph",
    executive: {
      headline: "Chained, exploitable risk — not CVE noise",
      summary:
        "A real attack path from entry to impact, so you prioritize the handful of chains that actually reach crown-jewel data over thousands of isolated CVEs.",
      action:
        "Follow the path left→right: entry → foothold → admin / domain takeover. The red “proves” edge is a demonstrated business risk, not a theoretical one.",
      takeaway: "One proven chain to sensitive data outranks a wall of context-free “highs.”",
    },
    analyst: {
      headline: "goal → intent → fact → finding lineage",
      summary:
        "The exploration graph records every node and typed edge — spawns, derived_from, yields, proves — as a reproducible reasoning trail.",
      action:
        "Trace a finding back along its “proves” edge to its goal, and follow a “hint” forward via “derived_from” into the next intent.",
      takeaway:
        "Every conclusion is reproducible: you can see exactly what was tried, what it produced, and why it mattered.",
    },
  },
  {
    id: "evidence",
    title: "Proof-Backed Triage",
    path: "/function/findings/",
    anchor: "nav-findings",
    executive: {
      headline: "Audit-ready proof, zero false-positive tax",
      summary:
        "Each finding carries verifiable proof of exposure, so engineers stop burning cycles confirming or refuting low-context alerts.",
      action:
        "Scan the severity tiles and verification badges, then open the Critical finding to see the evidence bound to it.",
      takeaway:
        "Verified, receipt-backed findings mean remediation starts immediately — and the audit trail is a click away.",
    },
    analyst: {
      headline: "Request/response receipts bound to the finding",
      summary:
        "Captured HTTP requests and responses, worker execution traces and proof artifacts are attached to the finding that cites them.",
      action:
        "Open a finding → Linked traffic → View message to inspect the exact payload and the server response, bodies included.",
      takeaway: "The proof travels with the finding and persists even after the raw traffic log is purged.",
    },
  },
  {
    id: "guardrails",
    title: "Guardrailed Execution",
    path: "/system/intercept/",
    anchor: "nav-intercept",
    executive: {
      headline: "Policy governance and blast-radius control",
      summary:
        "Human sign-off gates, scope boundaries and budgets keep autonomous testing safe for production-adjacent systems.",
      action:
        "Review the allow / deny / ask rules and where human approval is required before a risky action is allowed to run.",
      takeaway: "Autonomy with brakes: you get coverage without ceding control of what the agent is permitted to do.",
    },
    analyst: {
      headline: "Allow/deny/ask rules, budgets, approval gates",
      summary:
        "Interception rules match by tool name, argv-prefix or regex (first match wins); unmatched commands can defer to a model judge; risky actions queue for a human.",
      action:
        "Inspect the rule priority order — find “ask before sqlmap” and “deny destructive shell” — and approve a pending human-in-the-loop gate.",
      takeaway: "Scope allow/deny + rate/budget limits + per-target pins bound exactly what each worker can touch.",
    },
  },
  {
    id: "retest",
    title: "Closing the Remediation Loop",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=retests`,
    anchor: "task-retests",
    executive: {
      headline: "Prove risk closure on your SLA",
      summary:
        "Targeted retests verify a specific fix fast, instead of waiting for a full-environment rescan to confirm remediation.",
      action:
        "Open the retest and read the verdict: it re-checks just the patched finding and reports reproduced or fixed.",
      takeaway: "Faster MTTR verification and clean closure evidence for auditors and leadership.",
    },
    analyst: {
      headline: "Scoped retest against the patched asset",
      summary:
        "A retest launches a fresh, scoped session against the exact asset/finding and compares pre- vs. post-fix evidence.",
      action:
        "Review the retest session: same payload, new capture — verdict “reproduced” or “fixed,” with fresh receipts attached.",
      takeaway: "You confirm the fix with the same rigor as the original finding — evidence, not assertion.",
    },
  },
];
