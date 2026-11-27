// In-product guided walkthrough content model.
//
// The walkthrough is organised as USE CASES (business scenarios), each with one or
// more STEPS. The Guide Card renders four plain-English, labeled sections per step,
// each tailored to the active persona (Executive/CISO vs. Analyst/SecEng) and
// switchable in place:
//   1. painPoint    — "The Pain Point": what frustrates teams today, in plain words.
//   2. lookingAt    — "What You're Looking At": the exact numbers/rows/nodes on screen.
//   3. howArtex     — "How ARTEX Helps": what ARTEX is doing here, ...
//   4. tryThis      — ... plus the exact "Try This" click/filter/inspect instruction.
//   5. valueShipped — "Value Shipped": the tangible outcome for the team.
//
// Steps are a single flat list; the store walks it with Back/Next, and the use-case
// switcher jumps to a use case's first step. "Step X of Y" is computed within the
// current use case.

export type Persona = "executive" | "analyst";

export interface StepContent {
  painPoint: string;
  lookingAt: string;
  howArtex: string;
  tryThis: string;
  valueShipped: string;
}

export interface Step {
  id: string;
  useCase: number; // 1..6
  headline: string;
  path: string;
  anchor: string;
  autoClick?: string;
  executive: StepContent;
  analyst: StepContent;
}

export interface UseCase {
  id: number;
  title: string;
  available: boolean;
}

// Seeded demo handles the walkthrough deep-links to.
export const DEMO_TASK_ID = "9001"; // Acme Web engagement (acme.com) — populated graph/findings/retests
export const DEMO_ENDPOINT_ASSET_ID = 9210;
/** Critical finding with a bound request/response evidence snapshot (Use Case 3). */
export const DEMO_PROOF_FINDING_ID = 9005; // canonical /api/v2/invoices/{id} on acme.demo.local

export const PERSONA_LABELS: Record<Persona, { short: string; long: string }> = {
  executive: { short: "Executive", long: "Executive (CISO)" },
  analyst: { short: "Analyst", long: "Analyst (SecEng)" },
};

export const USE_CASES: UseCase[] = [
  { id: 1, title: "Taming Asset Sprawl", available: true },
  { id: 2, title: "Finding Real Attack Paths", available: true },
  { id: 3, title: "Eliminating False Positives with Proof", available: true },
  { id: 4, title: "Spotting Testing Blind Spots", available: true },
  { id: 5, title: "Safe Testing with Guardrails", available: true },
  { id: 6, title: "Proving Fixes Fast", available: true },
];

export const STEPS: Step[] = [
  // ═══════════════ Use Case 1 — Taming Asset Sprawl (4 steps) ═══════════════
  {
    id: "uc1-overview",
    useCase: 1,
    headline: "The asset-sprawl problem",
    path: "/function/assets/",
    anchor: "assets-root",
    executive: {
      painPoint:
        "Different scanners list the same server over and over under slightly different names, so the asset count looks huge and nobody trusts it.",
      lookingAt:
        "The whole cloud estate for Acme Cloud Corp (acme.demo.local) on one screen — each domain, IP, service, app and endpoint listed once.",
      howArtex:
        "ARTEX folds every raw observation from every scan into one shared inventory, so the duplicates simply disappear.",
      tryThis:
        "Look at the acme.demo.local row and the per-type counts — this is the real, de-duplicated attack surface across all three discovery tasks.",
      valueShipped: "One clean inventory the whole team can trust, instead of five conflicting spreadsheets.",
    },
    analyst: {
      painPoint:
        "Three separate tasks each reported overlapping hosts. Naive tooling stores them three times and loses track of which finding belongs to which asset.",
      lookingAt:
        "The canonical asset table for acme.demo.local: root_domain → subdomains → IPs → services → apps → endpoints.",
      howArtex: "Each raw hit is normalized to a stable key, so repeat observations collapse onto one asset id.",
      tryThis: "Scan the type tabs — every count is after de-duplication. Next we open one endpoint to see the merge.",
      valueShipped: "Findings and coverage attach to one real asset, not many copies of it.",
    },
  },
  {
    id: "uc1-hierarchy",
    useCase: 1,
    headline: "From domain down to endpoint",
    path: "/function/assets/?type=endpoint",
    anchor: "asset-type-tabs",
    executive: {
      painPoint:
        "When assets are just a flat list, you can't tell which endpoint belongs to which app, server or team — so no one owns the risk.",
      lookingAt:
        "The type tabs across the top (Root domains, Subdomains, IP, Services, Apps, Endpoints) are the levels of one clean tree.",
      howArtex:
        "ARTEX keeps the full chain — domain → subdomain → IP → service → app → endpoint — so every endpoint rolls up to a system and an owner.",
      tryThis:
        "You're on the Endpoints tab. Find GET /api/v2/invoices/{id} — the next step opens its canonical record.",
      valueShipped: "Every endpoint has a clear parent and owner, so risk can be routed to the right team.",
    },
    analyst: {
      painPoint: "Raw observations arrive as flat (host, url) pairs with no parent linkage.",
      lookingAt:
        "Endpoints resolve to a service (443/tcp https), an IP (198.51.100.14) and the Customer Billing Portal app.",
      howArtex:
        "Each node stores its root_domain / domain / url, so the parent→child lineage is reconstructed, not guessed.",
      tryThis: "Stay on the Endpoints tab; the next step opens /api/v2/invoices/{id} and its deduplication key.",
      valueShipped: "A queryable hierarchy you can pivot on, instead of a flat dump of URLs.",
    },
  },
  {
    id: "uc1-dedup",
    useCase: 1,
    headline: "Three scans, one clean record",
    path: `/function/assets/?type=endpoint&inspect=${DEMO_ENDPOINT_ASSET_ID}`,
    anchor: "asset-dedup-key",
    executive: {
      painPoint:
        "If the same endpoint is stored three times, the same risk gets counted — and re-tested — three times, wasting money and skewing the metrics.",
      lookingAt:
        "The record for GET /api/v2/invoices/{id}. “Merged observations” shows the three separate tasks that each reported it.",
      howArtex:
        "ARTEX recognised all three reports as the same thing and merged them into one record with one identity.",
      tryThis:
        "Read the Deduplication key and the three merged task observations — same asset, reported 3×, stored once.",
      valueShipped: "No double-counting: the exposure is tracked, fixed and measured exactly once.",
    },
    analyst: {
      painPoint:
        "Scanners emit (url, method) tuples that differ only by casing, a trailing slash or port form, which explodes the inventory.",
      lookingAt:
        "The node inspector: canonical identity, the computed dedup key, parent→child lineage and the contributing task ids.",
      howArtex:
        "The dedup key normalizes (type, url, method) into one uniqueness tuple (uq_av2_endpoint); re-observations UPSERT onto the same id.",
      tryThis: "Inspect the Deduplication key and the three tasks merged into canonical asset #9210.",
      valueShipped: "A stable asset id that every repeat observation lands on — deterministic, not fuzzy.",
    },
  },
  {
    id: "uc1-enrichment",
    useCase: 1,
    headline: "One asset, enriched by every task",
    path: `/function/assets/?type=endpoint&inspect=${DEMO_ENDPOINT_ASSET_ID}`,
    anchor: "asset-provenance",
    executive: {
      painPoint:
        "When each scan keeps its own copy, no one notices that two different tests both hit the same endpoint — so related risk is missed.",
      lookingAt: "This endpoint's contributing tasks, and the findings attached to it from more than one task.",
      howArtex:
        "Because the asset is one record, findings from different tasks pile onto the same node — a single, fuller risk picture.",
      tryThis: "See the findings from different tasks sitting on this one endpoint — connected, not scattered.",
      valueShipped: "One place to see everything known about an asset, so correlated risk is obvious.",
    },
    analyst: {
      painPoint: "Finding attribution breaks when the same asset exists under several duplicate ids.",
      lookingAt: "The contributing tasks plus the findings whose asset_ids reference this canonical endpoint.",
      howArtex:
        "A finding's asset_ids point at the canonical node, so Task A's IDOR and Task B's error-disclosure both resolve to #9210.",
      tryThis: "Confirm findings from separate tasks resolve to the same asset id — cross-task enrichment on one node.",
      valueShipped: "Accurate attribution: every finding rolls up to the one real asset it concerns.",
    },
  },

  // ═══════════════ Use Case 2 — Finding Real Attack Paths ═══════════════
  {
    id: "uc2-attack-paths",
    useCase: 2,
    headline: "How small gaps chain into a breach",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=graph`,
    anchor: "exploration-graph",
    executive: {
      painPoint:
        "A flat list of thousands of CVEs hides the handful of weaknesses that actually chain together to reach your crown-jewel data.",
      lookingAt:
        "The exploration graph for this engagement: a path running left-to-right from the entry point to a foothold to admin/domain takeover.",
      howArtex:
        "ARTEX doesn't just list issues — it shows the route an attacker takes, step by step, and marks where the goal was proven.",
      tryThis:
        "Follow the path from Start to Goal, then click a Finding node: its “proves” link marks a demonstrated way in, not a theoretical one.",
      valueShipped: "You fix the one chain that leads to a real breach first, instead of drowning in isolated CVEs.",
    },
    analyst: {
      painPoint: "Flat vulnerability lists throw away the reasoning that connects a foothold to real impact.",
      lookingAt:
        "Nodes for goal → intent → fact → finding → hint, joined by typed edges: spawns, derived_from, yields, proves.",
      howArtex: "Every node records what was tried and what it produced; the edges make the whole chain reproducible.",
      tryThis: "Trace a finding back along its “proves” edge to its goal, then follow a “hint” into the next intent.",
      valueShipped: "A reproducible attack narrative you can hand to engineering, not a context-free severity score.",
    },
  },

  // ═══════════════ Use Case 3 — Eliminating False Positives with Proof ═══════════════
  {
    id: "uc3-evidence",
    useCase: 3,
    headline: "Proof, not false alarms",
    path: `/function/findings/detail/?id=${DEMO_PROOF_FINDING_ID}`,
    anchor: "finding-linked-traffic",
    executive: {
      painPoint:
        "Engineers waste days arguing over scanner alerts that turn out to be false, and audits demand proof the team doesn't have.",
      lookingAt:
        "One Critical finding (Fastjson remote code execution on shop.acme.com), marked Verified, with the exact request that proved it attached: POST /api/import → 200.",
      howArtex:
        "ARTEX only calls something a finding after it reproduces it, and keeps the request, the server's response and the steps the agent took as a receipt.",
      tryThis:
        "Click View message on the linked request to see what was sent and what came back. The Exploration graph tab at the top shows the steps that led here.",
      valueShipped: "Developers get proof they can reproduce on day one, so no time is lost on false alarms.",
    },
    analyst: {
      painPoint:
        "A finding with no captured request/response can't be checked, so it gets argued over again and again.",
      lookingAt:
        "Finding #9005: Verified L4, with Linked traffic (1), a bound POST /api/import → 200 evidence snapshot, plus the PoC, confidence rationale and retest history.",
      howArtex:
        "Traffic is bound to the finding as an immutable evidence snapshot (kept even after raw traffic is purged); the Exploration graph tab shows the worker trace.",
      tryThis:
        "Click View message to read the @type gadget payload and the 200 response, then open the Exploration graph tab for the trace.",
      valueShipped: "Every confirmed finding ships with a replayable receipt: proof instead of a claim.",
    },
  },

  // ═══════════════ Use Case 4 — Spotting Testing Blind Spots ═══════════════
  {
    id: "uc4-coverage",
    useCase: 4,
    headline: "Discovered is not the same as tested",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=coverage`,
    anchor: "task-coverage",
    executive: {
      painPoint:
        "“We scanned everything” is dangerous. Many assets get discovered but never actually tested, and those blind spots are where breaches hide.",
      lookingAt:
        "A map of everything in scope for this engagement. The top-left counter reads In scope 13 · Tested 3. Green dots were actually tested; gray dots were only discovered.",
      howArtex:
        "ARTEX tracks which assets it truly exercised, not just which it found, so untested assets stand out instead of hiding inside a big number.",
      tryThis:
        "Compare the green (tested) dots with the gray (untested) ones. Every gray dot is a blind spot to test next.",
      valueShipped: "An honest picture of what's been validated, so budget goes to the gaps that matter.",
    },
    analyst: {
      painPoint:
        "Coverage guessed from scan counts is meaningless. You need per-asset grounding to know what was really exercised.",
      lookingAt:
        "The asset-coverage graph for task 9001: company → root domain → subdomain → IP → service → endpoint, with 3 of 13 in-scope nodes highlighted as tested.",
      howArtex:
        "Exploration anchors tie every intent and fact to a concrete asset, so a node only counts as tested when the agent actually worked on it.",
      tryThis:
        "Drag or zoom the graph, click the gray “⋯” fold node to expand it, and list the untested gray subdomains and services.",
      valueShipped: "A defensible, per-asset coverage map that tells you exactly where to point the next test.",
    },
  },

  // ═══════════════ Use Case 5 — Safe Testing with Guardrails ═══════════════
  {
    id: "uc5-guardrails",
    useCase: 5,
    headline: "Autonomy with the brakes on",
    path: "/system/intercept/",
    anchor: "intercept-rules",
    executive: {
      painPoint:
        "Letting an automated tool test near production is scary. One wrong move against the wrong host can cause an outage.",
      lookingAt:
        "The safety rules every action passes through before it runs. The top rule blocks the production database (prod-db.acme.demo.local) outright; others block destructive commands or ask a human first.",
      howArtex:
        "Each rule says Allow, Block or Ask. ARTEX checks every command against the rules, highest priority first, so out-of-scope or risky actions never run unattended.",
      tryThis:
        "Find “Deny out-of-scope prod database” at the top (Block), then “Allow read-only recon tools” further down (Allow).",
      valueShipped: "Teams can run autonomous testing near production with clear limits they set themselves.",
    },
    analyst: {
      painPoint:
        "A blanket on/off switch can't express “sqlmap only with approval, never rm -rf, and never touch prod-db”.",
      lookingAt:
        "Interception rules in priority order (higher first, first match wins): 120 deny prod-db.acme.demo.local, 110 deny destructive shell, 100 allow nuclei, 90 ask before sqlmap, plus built-in blocks.",
      howArtex:
        "Rules match on tool name, input string, argv prefix or regex; anything unmatched can fall back to a model judge or the human approval queue.",
      tryThis: "Scroll to “Ask before sqlmap” (Ask). Next step: the request it is holding for a human.",
      valueShipped:
        "Precise, auditable guardrails: exactly what each worker may touch, with a human in the loop for the risky parts.",
    },
  },
  {
    id: "uc5-approval",
    useCase: 5,
    headline: "A human signs off on the risky step",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=intercept`,
    anchor: "task-intercept",
    executive: {
      painPoint:
        "Fully automatic testing can't tell a safe check from one that might disturb a live system. Someone accountable has to decide.",
      lookingAt:
        "A request the agent is not allowed to run on its own: an SQL-injection tool (sqlmap) against www.acme.com, paused and waiting for a person to approve or deny it.",
      howArtex:
        "ARTEX pauses the agent at exactly this action and waits. Nothing runs until someone decides, and the decision is recorded.",
      tryThis:
        "Tick the pending sqlmap request, then click Approve selected or Deny selected. Either way, the decision is logged.",
      valueShipped: "Human control over the risky moments without slowing down everything else.",
    },
    analyst: {
      painPoint: "Approval gates that live in chat threads leave no audit trail and stall workers indefinitely.",
      lookingAt:
        "The task's pending approval queue: Bash `sqlmap -u https://www.acme.com/search?q=1 --batch --dbs`, matched by rule “Ask before sqlmap” with a 120 s timeout that defaults to deny.",
      howArtex:
        "The worker blocks on this gate; the decision (human, rule or timeout) is stored with who decided and when.",
      tryThis:
        "Tick the sqlmap row and use Approve selected / Deny selected (expand it to see the full request). Re-run scripts/demo/seed.sh to restore it.",
      valueShipped: "An auditable, fail-closed human-in-the-loop gate for intrusive tools.",
    },
  },

  // ═══════════════ Use Case 6 — Proving Fixes Fast ═══════════════
  {
    id: "uc6-retest",
    useCase: 6,
    headline: "Confirm the fix in seconds",
    path: `/function/tasks/detail/?id=${DEMO_TASK_ID}&tab=retests`,
    anchor: "task-retests",
    executive: {
      painPoint: "After a fix ships, proving it actually worked usually means waiting weeks for the next full rescan.",
      lookingAt:
        "The retest history for “Admin console uses default credentials”: the first retest said Still reproducible (login worked, 200 OK); after the fix, the newest says Fixed (403 Forbidden).",
      howArtex: "ARTEX replays the exact original attack against just the patched asset and compares before vs. after.",
      tryThis:
        "Compare the two verdicts on the right — Still reproducible, then Fixed — or click Start retest to run a fresh check.",
      valueShipped:
        "Confirms a patch really worked in seconds, instead of waiting weeks for a full-environment rescan.",
    },
    analyst: {
      painPoint: "Ad-hoc re-tests lose the original payload, so you can't compare the new result to the first one.",
      lookingAt:
        "Two retests of the same finding: #9002 replays admin/admin123 and gets 200 OK (reproduced); #9003, after the fix, gets 403 Forbidden (fixed).",
      howArtex: "A scoped retest replays against the exact asset/finding and diffs the pre-fix and post-fix evidence.",
      tryThis: "Open Retest evidence on #9002 and #9003 to diff the 200 vs. 403 responses, or click Start retest.",
      valueShipped: "Deterministic fix verification with side-by-side proof — no full rescan required.",
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
