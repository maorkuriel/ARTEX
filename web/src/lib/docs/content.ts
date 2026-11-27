// In-product Documentation Center content: plain-English, jargon-light guides shared by
// the /docs hub and the contextual "How this works" drawer. Kept as data (like the
// walkthrough use cases) so both surfaces render the same words.

export type PillarId = "overview" | "how-it-works" | "vmdr" | "glossary";

export interface Pillar {
  id: PillarId;
  number: number;
  title: string;
  summary: string;
}

export const PILLARS: Pillar[] = [
  {
    id: "overview",
    number: 1,
    title: "What is ARTEX & how it's organized",
    summary:
      "The one-minute version, the five VMDR pillars in the menu, and the Focus → Mitigate/Remediate → Verify loop.",
  },
  {
    id: "how-it-works",
    number: 2,
    title: "How ARTEX works",
    summary: "Four simple building blocks: one asset map, step-by-step thinking, camera-like proof and safety brakes.",
  },
  {
    id: "vmdr",
    number: 3,
    title: "How VMDR teams benefit",
    summary: "Six practical outcomes for vulnerability management, each one you can see live in the walkthrough.",
  },
  {
    id: "glossary",
    number: 4,
    title: "Glossary & where to start",
    summary: "Key terms in everyday words, plus a starting path for security leaders and for engineers.",
  },
];

/** A rich-text-free content block (rendered as plain text, so no markup or HTML). */
export type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "steps"; items: string[] }
  | { kind: "example"; text: string }
  | {
      kind: "compare";
      left: { title: string; items: string[] };
      right: { title: string; items: string[] };
    };

export interface DocLink {
  label: string;
  href: string;
}

export interface DocArticle {
  id: string;
  pillar: PillarId;
  title: string;
  /** Short subtitle shown on cards and in the drawer header. */
  tagline: string;
  /** The technical name, shown as a small label so engineers can map the plain words. */
  technicalName?: string;
  blocks: DocBlock[];
  /** Live screens to open in the product. */
  links?: DocLink[];
  /** VMDR use case (1-6) whose walkthrough chapter illustrates this article. */
  useCase?: number;
}

export const ARTICLES: DocArticle[] = [
  // ── Pillar 1 · What is ARTEX? ─────────────────────────────────────────────
  {
    id: "what-is-artex",
    pillar: "overview",
    title: "ARTEX in plain English",
    tagline: "It checks whether a weakness can really be used against you, and keeps the proof.",
    blocks: [
      {
        kind: "p",
        text: "ARTEX is an autonomous security validation platform. You give it a goal, for example “find out whether an outsider could get into our admin console”, and a scope of what it may touch. AI agents then do what a careful penetration tester would do: look around, try small, safe tests, learn from each result and decide the next step.",
      },
      {
        kind: "p",
        text: "The point is not to produce another long list of possible problems. ARTEX tries to show whether each weakness is actually exploitable, and when it is, it keeps the exact web request and response that proved it. Noisy scanner output becomes a short list of findings you can trust.",
      },
      {
        kind: "example",
        text: "A scanner says: “admin.acme.com may use default credentials.” ARTEX tries the login, sees it succeed, records the request and the server's “200 OK” reply, and files one confirmed finding with that proof attached.",
      },
      {
        kind: "list",
        items: [
          "Runs on your own infrastructure, with your own AI model provider.",
          "Only tests what is in scope, and asks a human before risky actions.",
          "Keeps one shared map of your assets that every test adds to.",
        ],
      },
    ],
    links: [
      { label: "Tasks", href: "/function/tasks" },
      { label: "Findings", href: "/function/findings" },
    ],
  },
  {
    id: "vmdr-pillars",
    pillar: "overview",
    title: "The five VMDR pillars in the menu",
    tagline:
      "Assets, coverage, exposure, posture and guardrails are different questions, so they live in different places.",
    technicalName: "VMDR information architecture",
    blocks: [
      {
        kind: "p",
        text: "The most common mistake in vulnerability management is mixing up five different things: what you own, what you tested, what is actually exploitable, how healthy you are overall, and what you are allowed to touch. The ARTEX menu keeps them apart, and every screen shows a small banner naming its pillar and the one question it answers.",
      },
      {
        kind: "list",
        items: [
          "Posture & Focus (Focus Queue, Overview Dashboard) — “Where do I need to focus right now?” Overall asset security posture and a ranked list of next actions.",
          "Discovered Assets (Inventory & Asset Graph, Discovery Sources) — “What exists?” Each domain, IP, service, app and endpoint, counted once. Says nothing about whether it was tested.",
          "Coverage Status (Test Coverage) — “What has been tested, and what has not?” Tested vs. untested assets per engagement. Untested is a blind spot, never a clean result.",
          "Risk Exposure (Findings & Remediation, HTTP Evidence) — “What is actually exposed, and can we prove it?” Attack paths, confirmed findings with proof, mitigation and remediation steps, and retests.",
          "Scope & Guardrails (Scope & Interception Rules, Asset Blocklist, Approvals) — “What may ARTEX touch, and who signs off?” Allow/deny rules, budgets and the human approval queue.",
        ],
      },
      {
        kind: "compare",
        left: {
          title: "Easy to confuse",
          items: [
            "“We have 400 assets and 3 findings, so we're in good shape.”",
            "“No findings on this server” (because it was never tested).",
            "“The scanner flagged it, so it's a risk.”",
          ],
        },
        right: {
          title: "What ARTEX shows instead",
          items: [
            "Discovered Assets: 400 · Coverage Status: 38% tested · Risk Exposure: 3 proven.",
            "The server is gray on the coverage map: untested, so unknown.",
            "Only proven, evidence-backed issues count toward exposure and posture.",
          ],
        },
      },
      {
        kind: "p",
        text: "Operations (tasks, chat, tool runs, recordings, workspace) and System settings sit below the five pillars: they are how the work gets done, not what you report on.",
      },
    ],
    links: [
      { label: "Focus Queue", href: "/focus" },
      { label: "Test Coverage", href: "/coverage" },
    ],
  },
  {
    id: "posture-model",
    pillar: "overview",
    title: "How asset posture is calculated",
    tagline: "Every asset gets a status, a 0–100 score and a coverage figure, rolled up from the endpoints below it.",
    technicalName: "Asset-centric posture spine (RollupHierarchyPosture)",
    blocks: [
      {
        kind: "p",
        text: "Assets are first-class in ARTEX, not a side-effect of tests. Each one has business context you set (criticality tier, owner team, environment) and a posture ARTEX calculates from what was actually tested and proven.",
      },
      {
        kind: "list",
        items: [
          "Critical exposure — an open, confirmed critical finding on the asset or anything below it.",
          "High exposure — an open, confirmed high or medium finding.",
          "Pending retest — a fix is being verified right now.",
          "Validated clean — the asset and everything below it was tested, and nothing is open.",
          "Unvalidated blind spot — at least one part was never tested. Untested is never shown as clean.",
        ],
      },
      {
        kind: "p",
        text: "The score starts at 100 and loses points for open findings (more for critical) and for the untested share, scaled up for Tier-1 crown jewels and down for Tier-3 assets. An asset that was never validated cannot score above 50. Findings and coverage roll up: endpoint → service → subdomain or IP → root domain.",
      },
      {
        kind: "example",
        text: "The invoices API endpoint is Tier 1, owned by Platform Billing, and has a confirmed IDOR, so it shows High exposure. The same exposure rolls up to api.acme.demo.local and acme.demo.local.",
      },
    ],
    links: [
      { label: "Posture & Focus", href: "/focus" },
      { label: "Discovered assets", href: "/function/assets" },
    ],
    useCase: 1,
  },
  {
    id: "focus-loop",
    pillar: "overview",
    title: "Focus → Mitigate & remediate → Verify",
    tagline: "A simple four-step loop that takes you from “what matters?” to a proven fix.",
    technicalName: "VMDR operating loop",
    blocks: [
      {
        kind: "steps",
        items: [
          "Scope & Discover — confirm what is in scope (Scope & Guardrails), then review the de-duplicated Discovered Assets and their baseline posture.",
          "Check Coverage — open Test Coverage and find the gray, untested assets, so a blind spot is never mistaken for a clean bill of health.",
          "Inspect Exposure — in Risk Exposure, review the attack paths, confirmed findings and the HTTP request and response that prove each one.",
          "Mitigate, Remediate & Verify — on each finding, apply the temporary mitigation today, ship the permanent remediation, then click Launch retest to prove the fix holds.",
        ],
      },
      {
        kind: "compare",
        left: {
          title: "Mitigation (today, temporary)",
          items: [
            "Lowers the risk while the real fix is built.",
            "Examples: WAF rule, IP allow-list, rate limit, disable a feature.",
            "Does not remove the root cause.",
          ],
        },
        right: {
          title: "Remediation (permanent)",
          items: [
            "Removes the root cause in code, configuration or access.",
            "Examples: parameterized queries, ownership checks, rotate credentials and add MFA.",
            "Verified by a targeted retest of the original proof.",
          ],
        },
      },
      {
        kind: "example",
        text: "Admin console uses default credentials: mitigate by restricting the console to the VPN; remediate by rotating the password and requiring MFA; verify with a retest that now gets 403 Forbidden instead of 200 OK.",
      },
      {
        kind: "p",
        text: "The Focus Queue ranks this work for you: proven critical exposure first, then pending approvals, fixes awaiting verification and untested assets. Its posture grade lists the factors behind it, and is marked low-confidence when most assets are untested.",
      },
    ],
    links: [
      { label: "Focus Queue", href: "/focus" },
      { label: "Findings", href: "/function/findings" },
    ],
    useCase: 6,
  },
  {
    id: "scanning-vs-validation",
    pillar: "overview",
    title: "Traditional scanning vs. ARTEX validation",
    tagline: "Why a list of possible issues is not the same as proof.",
    blocks: [
      {
        kind: "compare",
        left: {
          title: "Traditional vulnerability scanning",
          items: [
            "Long lists of theoretical issues, ranked by a generic severity score.",
            "Many false positives that engineers have to argue about.",
            "The same server shows up several times under different names.",
            "Each issue stands alone: no idea which ones chain into a breach.",
            "Confirming a fix means waiting for the next full scan.",
          ],
        },
        right: {
          title: "ARTEX autonomous validation",
          items: [
            "Findings are confirmed by actually trying them, safely and in scope.",
            "Each confirmed finding carries the captured request and response.",
            "One clean asset map: every server, app and endpoint counted once.",
            "Step-by-step chains show how small clues lead to real impact.",
            "One-click retests confirm a fix in minutes.",
          ],
        },
      },
      {
        kind: "p",
        text: "Scanners are still useful for breadth. ARTEX is the step after: it takes what is known about your environment and proves what matters.",
      },
    ],
  },

  // ── Pillar 2 · How ARTEX works ────────────────────────────────────────────
  {
    id: "asset-map",
    pillar: "how-it-works",
    title: "One shared asset map",
    technicalName: "Asset Graph",
    tagline: "Everything ARTEX knows about your environment, in one clean tree, counted once.",
    useCase: 1,
    blocks: [
      {
        kind: "p",
        text: "Every test reports what it found: domains, subdomains, IP addresses, services, applications and individual web endpoints. ARTEX puts all of it into a single tree that every test shares, from the company down to one URL.",
      },
      {
        kind: "steps",
        items: ["Company", "Root domain", "Subdomain", "IP address", "Service (port)", "Application", "Endpoint (URL)"],
      },
      {
        kind: "p",
        text: "The agents never decide on their own whether two things are the same. ARTEX computes a fingerprint for each item (for an endpoint: its full URL and method). If a second test reports the same fingerprint, it is merged into the existing record instead of creating a duplicate, and the record remembers every test that saw it.",
      },
      {
        kind: "example",
        text: "Three different tests report GET https://api.acme.demo.local/api/v2/invoices/{id}. The asset map keeps one record, lists the three tests as sources, and shows findings from any of them on that one record.",
      },
    ],
    links: [{ label: "Assets", href: "/function/assets" }],
  },
  {
    id: "step-by-step",
    pillar: "how-it-works",
    title: "Step-by-step thinking",
    technicalName: "Exploration Graph",
    tagline: "How ARTEX breaks a goal into small tests and chains small clues into a real attack path.",
    useCase: 2,
    blocks: [
      {
        kind: "p",
        text: "Each task has its own map of reasoning. A planner agent reads the goal and splits it into small, concrete things to try. Worker agents pick those up, run real tools and write back what they learned. Every step is saved, so you can replay how ARTEX got from the goal to a finding.",
      },
      {
        kind: "steps",
        items: [
          "Goal: what you want to know (“can an outsider reach user data?”).",
          "Intent: one small thing to try (“check the admin console for default passwords”).",
          "Fact: something learned along the way (“the login page has no rate limit”).",
          "Finding: a confirmed weakness, with proof.",
        ],
      },
      {
        kind: "p",
        text: "Facts lead to new intents, so small clues add up. Arrows record why each step happened: an intent was spawned by a goal, a fact came from an intent, a finding proves a goal. Each step is also pinned to the assets it touched, which is how ARTEX knows what was really tested.",
      },
      {
        kind: "example",
        text: "A leaked .git folder (fact) reveals a database password (fact), which is tried on the admin console (intent), which works (finding that proves the goal).",
      },
    ],
    links: [{ label: "Tasks → Exploration graph tab", href: "/function/tasks" }],
  },
  {
    id: "proof",
    pillar: "how-it-works",
    title: "Camera-like proof",
    technicalName: "Evidence & traffic receipts",
    tagline: "The exact request and response that confirmed a weakness, kept with the finding.",
    useCase: 3,
    blocks: [
      {
        kind: "p",
        text: "Everything the agents send to a target goes through ARTEX's recording proxy, like a dashcam for web traffic. When a weakness is confirmed, the request that triggered it and the server's response are attached to the finding as a receipt.",
      },
      {
        kind: "list",
        items: [
          "A finding is only marked verified when its receipt and quoted evidence back it up.",
          "Receipts are stored encrypted and are kept even after raw traffic is cleaned up.",
          "Developers can open the receipt and replay the request themselves.",
        ],
      },
      {
        kind: "example",
        text: "Finding: remote code execution on shop.acme.com. Receipt: POST /api/import with the malicious payload, and the server's 200 OK reply. Nobody has to ask “is this real?”.",
      },
    ],
    links: [
      { label: "Findings", href: "/function/findings" },
      { label: "Traffic", href: "/function/traffic" },
    ],
  },
  {
    id: "safety",
    pillar: "how-it-works",
    title: "Built-in safety brakes: three layers",
    technicalName: "Three-layer guardrail pipeline, interception rules & approvals",
    tagline: "A read-only policy, blast-radius budgets and human sign-off, with every decision on an audit trail.",
    useCase: 5,
    blocks: [
      {
        kind: "p",
        text: "Autonomous does not mean unsupervised. Every action an agent wants to take passes three layers of checks before anything is sent, and the result of each check is written to the Guard Audit Trail.",
      },
      {
        kind: "steps",
        items: [
          "Layer 1 · Scope and non-destructive policy. Production and Tier-1 (crown-jewel) assets are in read-only validation: looking (GET, HEAD, OPTIONS, passive probes) is allowed, changing anything (POST, PUT, PATCH, DELETE, uploads, exploitation tools) is blocked before it leaves. Your allow, block and ask rules and the asset blocklist apply here too.",
          "Layer 2 · Blast-radius budgets. Each task has a request budget per target host, plus token, turn and pacing limits, so a runaway agent cannot flood a system.",
          "Layer 3 · Human in the loop. Any action against a Tier-1 asset, any state-changing test against an asset in controlled active validation, and anything the AI safety judge flags waits for a person to approve or deny it. No answer in time means no.",
        ],
      },
      {
        kind: "compare",
        left: {
          title: "Read-only validation",
          items: [
            "Default for production and Tier-1 assets.",
            "Proves exposure by observing, never by changing state.",
            "Approval cannot override a block.",
          ],
        },
        right: {
          title: "Controlled active validation",
          items: [
            "Set explicitly per asset (typically staging).",
            "Allows bounded state-changing tests.",
            "The first state-changing call per task needs human approval.",
          ],
        },
      },
      {
        kind: "example",
        text: "A worker tries POST /v1/orders on api.acme.com (Tier 1, production). Layer 1 blocks it with the reason “read_only_validation”, and the Guard Audit Trail records worker, task, asset, rule and rationale.",
      },
      {
        kind: "p",
        text: "Audit entries cannot be edited. Assets nobody has classified keep the standard rules, so turning this on never breaks existing tasks.",
      },
    ],
    links: [
      { label: "Guard Audit Trail", href: "/system/intercept/audit" },
      { label: "Interception rules", href: "/system/intercept" },
      { label: "Approvals", href: "/system/intercept/approvals" },
    ],
  },
];

// ── Pillar 3 · VMDR outcomes ─────────────────────────────────────────────────
export interface OutcomeCard {
  useCase: number;
  title: string;
  problem: string;
  helps: string;
  outcome: string;
  /** Building block that explains how this works. */
  articleId: string;
}

export const OUTCOMES: OutcomeCard[] = [
  {
    useCase: 1,
    title: "Cleaner asset inventory",
    problem:
      "Several scanners report the same server under different names, so it is counted, ticketed and tested again and again.",
    helps:
      "Every observation is fingerprinted and merged into one shared asset map; each record lists the tests that saw it.",
    outcome: "One record per real asset. Metrics stop double-counting and nobody fixes the same thing twice.",
    articleId: "asset-map",
  },
  {
    useCase: 2,
    title: "Real attack paths over flat CVE lists",
    problem: "A list of thousands of CVEs hides the few weaknesses that actually chain together into a breach.",
    helps: "The step-by-step map shows how one clue led to the next, from first foothold to proven impact.",
    outcome: "Teams fix the chain that leads to real damage first, instead of sorting by a generic score.",
    articleId: "step-by-step",
  },
  {
    useCase: 3,
    title: "Zero-debate triage",
    problem: "Engineers lose days arguing over alerts that turn out to be false, and audits ask for proof nobody kept.",
    helps: "Each confirmed finding carries the exact HTTP request and response that proved it.",
    outcome: "Developers get reproduction steps on day one. No time is lost on false alarms.",
    articleId: "proof",
  },
  {
    useCase: 4,
    title: "Clear testing blind spots",
    problem: "“We scanned everything” hides assets that were found but never actually tested.",
    helps:
      "Each test step is pinned to the assets it touched, so coverage shows tested vs. untested assets one by one.",
    outcome: "An honest coverage picture that tells you exactly where to test next.",
    articleId: "step-by-step",
  },
  {
    useCase: 5,
    title: "Safe active validation",
    problem: "Letting automated tools test near production feels risky: one wrong command could cause an outage.",
    helps: "Scope rules, block/ask rules, budgets and human approval gates check every command before it runs.",
    outcome: "Autonomous testing inside limits you set, with a person signing off on risky steps.",
    articleId: "safety",
  },
  {
    useCase: 6,
    title: "Fast fix verification",
    problem: "Proving a patch worked usually means waiting weeks for the next full scan.",
    helps: "A targeted retest replays just that finding and records “Still reproducible” or “Fixed” with fresh proof.",
    outcome: "Fixes are confirmed in minutes, with before-and-after evidence side by side.",
    articleId: "proof",
  },
];

// ── Pillar 4 · Glossary & role guides ────────────────────────────────────────
export interface GlossaryTerm {
  term: string;
  definition: string;
  example?: string;
  articleId?: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    term: "Business criticality",
    definition:
      "How much an asset matters: Tier 1 (crown jewel), Tier 2 (business) or Tier 3 (standard). It weights the posture score and turns on extra guardrails for Tier 1.",
    articleId: "posture-model",
  },
  {
    term: "Validation mode",
    definition:
      "How hard ARTEX may push on an asset: read-only validation (observe only; default for production and Tier 1) or controlled active validation (bounded state-changing tests after approval).",
    articleId: "safety",
  },
  {
    term: "Guard Audit Trail",
    definition:
      "The append-only record of every guardrail decision: who acted, which asset, which rule, allowed / blocked / held / approved / denied, and why.",
    articleId: "safety",
  },
  {
    term: "Coverage Status",
    definition:
      "How much of the in-scope estate has actually been tested. Untested assets are blind spots: unknown, not safe.",
    example: "38 of 100 in-scope assets tested = 38% coverage, 62 blind spots.",
    articleId: "vmdr-pillars",
  },
  {
    term: "Risk Exposure",
    definition: "Weaknesses that ARTEX proved are exploitable, with the request and response that show it.",
    articleId: "vmdr-pillars",
  },
  {
    term: "Asset Security Posture",
    definition:
      "An overall grade combining open proven exposure and coverage. It shows its factors and is marked low-confidence when most assets are untested.",
    articleId: "focus-loop",
  },
  {
    term: "Mitigation vs. remediation",
    definition:
      "Mitigation is a temporary control that lowers risk today; remediation is the permanent fix of the root cause. Both end with a retest.",
    example: "Mitigate: block the route at the WAF. Remediate: upgrade the vulnerable library.",
    articleId: "focus-loop",
  },
  {
    term: "Asset Graph",
    definition:
      "The single shared map of everything ARTEX knows about your environment: domains, servers, apps and URLs, each counted once.",
    example: "acme.com → api.acme.com → 203.0.113.10 → port 443 → /v1/orders",
    articleId: "asset-map",
  },
  {
    term: "Exploration Graph",
    definition: "A task's step-by-step record of what was tried, what was learned and why each next step was taken.",
    example: "goal → intent → fact → finding",
    articleId: "step-by-step",
  },
  {
    term: "Exploration Anchor",
    definition:
      "A pin that ties a test step to the asset it touched. Anchors are how ARTEX knows which assets were really tested.",
    example: "The intent “try default passwords” is anchored to admin.acme.com.",
    articleId: "step-by-step",
  },
  {
    term: "Traffic Receipt",
    definition: "The saved web request and response that prove a finding, attached to it like a receipt to an expense.",
    example: "POST /api/import → 200 OK",
    articleId: "proof",
  },
  {
    term: "Guard Gate",
    definition:
      "The checkpoint every agent command passes through: scope, rules, an optional AI check and, when needed, a human approval.",
    example: "“sqlmap” waits for a person to click Approve or Deny.",
    articleId: "safety",
  },
  {
    term: "Retest Session",
    definition:
      "A short, focused re-run of one finding after a fix, ending in a clear verdict: still reproducible or fixed.",
    example: "Before the fix: 200 OK. After the fix: 403 Forbidden.",
    articleId: "proof",
  },
  {
    term: "Intent",
    definition: "One small, concrete thing for an agent to try, created by the planner from a goal or a new fact.",
    articleId: "step-by-step",
  },
  {
    term: "Finding",
    definition: "A confirmed weakness. In ARTEX a finding should carry the proof that confirmed it.",
    articleId: "proof",
  },
  {
    term: "Scope",
    definition: "The list of targets a task is allowed to test. Anything outside it is refused.",
    articleId: "safety",
  },
];

export interface RoleGuide {
  id: "executive" | "analyst";
  title: string;
  who: string;
  steps: { text: string; href?: string; articleId?: string; walkthrough?: boolean }[];
}

export const ROLE_GUIDES: RoleGuide[] = [
  {
    id: "executive",
    title: "CISOs & security leaders",
    who: "You care about risk, proof and where the budget goes.",
    steps: [
      { text: "Read “ARTEX in plain English” and the scanning comparison.", articleId: "what-is-artex" },
      { text: "Take the Guided Walkthrough in Executive (CISO) mode: about ten minutes.", walkthrough: true },
      { text: "Open Findings to see confirmed issues with their proof.", href: "/function/findings" },
      { text: "Check a task's Asset coverage tab to see what has not been tested yet.", href: "/function/tasks" },
    ],
  },
  {
    id: "analyst",
    title: "Security engineers & AppSec analysts",
    who: "You want to see exactly what was sent, what came back and why.",
    steps: [
      { text: "Read the four building blocks in “How ARTEX works”.", articleId: "asset-map" },
      { text: "Take the Guided Walkthrough in Analyst (SecEng) mode.", walkthrough: true },
      { text: "Open a task's Exploration graph and trace a finding back to its goal.", href: "/function/tasks" },
      { text: "Review the interception rules, then retest a finding after a fix.", href: "/system/intercept" },
    ],
  },
];

// ── Contextual help: which guide fits the current screen ─────────────────────
export interface HelpTopic {
  articleId: string;
  useCase?: number;
  screen: string;
}

/** Pick the most relevant guide for a pathname (+ optional ?tab=) so the drawer opens on it. */
export function helpTopicFor(pathname: string, tab?: string | null): HelpTopic {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p.startsWith("/function/tasks/detail")) {
    switch (tab) {
      case "coverage":
        return { articleId: "step-by-step", useCase: 4, screen: "Asset coverage" };
      case "findings":
        return { articleId: "proof", useCase: 3, screen: "Task findings" };
      case "retests":
        return { articleId: "proof", useCase: 6, screen: "Retests" };
      case "intercept":
        return { articleId: "safety", useCase: 5, screen: "Interception approval" };
      case "assets":
        return { articleId: "asset-map", useCase: 1, screen: "Test assets" };
      default:
        return { articleId: "step-by-step", useCase: 2, screen: "Task" };
    }
  }
  if (p.startsWith("/focus") || p.startsWith("/dashboard"))
    return { articleId: "focus-loop", useCase: 6, screen: "Focus Queue" };
  if (p.startsWith("/coverage")) return { articleId: "vmdr-pillars", useCase: 4, screen: "Test Coverage" };
  if (p.startsWith("/function/assets")) return { articleId: "posture-model", useCase: 1, screen: "Assets" };
  if (p.startsWith("/function/sync")) return { articleId: "asset-map", useCase: 1, screen: "Discovery sources" };
  if (p.startsWith("/function/findings/detail"))
    return { articleId: "focus-loop", useCase: 6, screen: "Finding remediation" };
  if (p.startsWith("/function/findings")) return { articleId: "proof", useCase: 3, screen: "Findings" };
  if (p.startsWith("/function/traffic")) return { articleId: "proof", useCase: 3, screen: "Traffic" };
  if (p.startsWith("/system/intercept/audit")) return { articleId: "safety", useCase: 5, screen: "Guard Audit Trail" };
  if (p.startsWith("/system/intercept")) return { articleId: "safety", useCase: 5, screen: "Interception" };
  if (p.startsWith("/function/tasks")) return { articleId: "step-by-step", useCase: 2, screen: "Tasks" };
  return { articleId: "vmdr-pillars", screen: "" };
}

export const articleById = (id: string) => ARTICLES.find((a) => a.id === id);
export const outcomeFor = (useCase?: number) => OUTCOMES.find((o) => o.useCase === useCase);

/** Flattened plain text for keyword search. */
export function articleText(a: DocArticle): string {
  const parts: string[] = [a.title, a.tagline, a.technicalName ?? ""];
  for (const b of a.blocks) {
    if (b.kind === "p" || b.kind === "example") parts.push(b.text);
    else if (b.kind === "list" || b.kind === "steps") parts.push(...b.items);
    else parts.push(b.left.title, ...b.left.items, b.right.title, ...b.right.items);
  }
  return parts.join(" ").toLowerCase();
}
