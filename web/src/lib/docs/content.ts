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
    title: "What is ARTEX?",
    summary: "The one-minute version: what ARTEX does and how it differs from a vulnerability scanner.",
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
    title: "Built-in safety brakes",
    technicalName: "Guards, interception rules & approvals",
    tagline: "Scope limits, budgets, an AI safety check and human sign-off keep testing safe.",
    useCase: 5,
    blocks: [
      {
        kind: "p",
        text: "Autonomous does not mean unsupervised. Every command an agent wants to run passes through ARTEX's safety checks before anything is sent.",
      },
      {
        kind: "steps",
        items: [
          "Scope boundaries: only targets you put in scope are explored; anything else is refused.",
          "Rules: each command is checked against allow, block and ask rules (for example “never touch prod-db”, “never run rm -rf”).",
          "AI safety check: commands no rule covers can be judged by a separate model before they run.",
          "Human approval: risky actions wait for a person to approve or deny them, and are denied if nobody answers in time.",
          "Budgets: limits on how much AI work a task or a single step may use, plus pacing so targets are not flooded.",
        ],
      },
      {
        kind: "p",
        text: "Every decision is recorded with who made it (a person, a rule, the model or the system), so you have an audit trail.",
      },
    ],
    links: [
      { label: "Interception rules", href: "/system/intercept" },
      { label: "Approval records", href: "/system/intercept/approvals" },
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
  if (p.startsWith("/function/assets") || p.startsWith("/function/sync"))
    return { articleId: "asset-map", useCase: 1, screen: "Assets" };
  if (p.startsWith("/function/findings")) return { articleId: "proof", useCase: 3, screen: "Findings" };
  if (p.startsWith("/function/traffic")) return { articleId: "proof", useCase: 3, screen: "Traffic" };
  if (p.startsWith("/system/intercept")) return { articleId: "safety", useCase: 5, screen: "Interception" };
  if (p.startsWith("/function/tasks")) return { articleId: "step-by-step", useCase: 2, screen: "Tasks" };
  return { articleId: "what-is-artex", screen: "" };
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
