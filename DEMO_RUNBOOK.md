# ARTEX — Local Demo Runbook

A step-by-step guide to running ARTEX locally and demoing **every** major capability
end-to-end, with a deterministic, repeatable demo dataset. Nothing here reaches any
external or production host.

ARTEX is a self-hosted, LLM-driven autonomous pentest platform: **one Go binary with the
Next.js UI embedded + PostgreSQL**. A planner decomposes a goal into intents, workers run
tools, and results are written into two linked graphs (asset graph + exploration graph)
with findings bound to the HTTP traffic that proves them.

---

## 0. What you get

Two independent demo paths:

| Path | What it is | When to use | Backend | Live SSE/API |
|------|-----------|-------------|---------|--------------|
| **A. Full stack** | Go server + PostgreSQL + embedded UI, seeded DB | The real end-to-end demo (auth, API, SSE, approvals) | Docker | Yes |
| **B. Mock UI** | Frontend only, built-in canned dataset (`NEXT_PUBLIC_MOCK=1`) | Instant, zero-risk UI walkthrough; no DB, no keys | None | No (mocked) |

Both are **safe**: Path B talks to no backend at all; Path A runs with placeholder LLM
keys and binds only to `127.0.0.1`, so the agent never calls a real LLM or target unless
you deliberately add credentials and start a task.

---

## 1. Prerequisites

- **Docker Desktop** running (Path A). Check: `docker info`.
- **Node 20+** and **npm** (Path B, and already used to prebuild the UI). Check: `node -v`.
- **Python 3** on the host (used by the seed generator). Check: `python3 --version`.
- Ports free on localhost: **8787** (UI/API), **8788** (MITM proxy) for Path A; **3200** for Path B.

---

## 2. Configuration (safe local defaults)

Create `.env` in the project root (the repo ships `.env.example`). Minimum safe local config:

```bash
cp .env.example .env
```

Then set these keys in `.env` (leave the LLM keys **empty** for a no-cost UI/data demo):

```
ARTEX_BIND_ADDR=127.0.0.1          # host-local only; never 0.0.0.0 for a demo
POSTGRES_USER=artex
POSTGRES_PASSWORD=artex_local_demo_pw_2026
POSTGRES_DB=artex
ANTHROPIC_API_KEY=                 # leave empty: no live LLM calls
OPENAI_API_KEY=                    # leave empty
ARTEX_LLM_PROVIDER=
ARTEX_LLM_MODEL=
ARTEX_LLM_BASE_URL=
```

How config/keys/gates work in this build:
- **LLM profiles** live in PostgreSQL (`llm_profiles`) and are managed in **System → LLM**.
  Env `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` only seed an initial profile; you can add more in
  the UI. The demo seed inserts three **keyless** profiles so the LLM screen is populated.
- **Setup token / auth:** single admin account. On first start the server prints a one-time
  **setup token** to its logs; the `/setup` page uses it to set the admin password. Auth is a
  bcrypt hash in the `settings` table (`auth.password_hash`). `reset-password.sh` can set it
  non-interactively (see §4).
- **Scope rules:** org scope in `company_scope`, per-task scope in `task_scope`; out-of-scope
  is expressed with **deny** `task_constraints` and **deny** `intercept_rules`.
- **Approval gates (human-in-the-loop):** `intercept_rules` (allow/deny/ask by tool name,
  argv-prefix, or regex) produce `intercept_pending` rows awaiting a human decision; the
  per-task **target gate** (`tasks.target_gate`) forces approval of each target host and
  records approved hosts in `target_pins`.
- **Budgets:** `ARTEX_TASK_BUDGET_*` / `ARTEX_INTENT_BUDGET_*` cap tokens/turns per run.
- **Mock/preview mode:** `NEXT_PUBLIC_MOCK=1` (build-time) runs the whole UI on canned data.

---

## 3. Path A — Full stack (Docker)

### 3a. Build & start

The upstream `docker-compose.yml` builds the **full** image, which downloads and compiles a
large third-party pentest toolbox (nuclei, httpx, subfinder, ffuf, dalfox, sqlmap, **bbot**,
Playwright/Chromium). That build is heavy and, on Apple-silicon/arm64, the `bbot
--install-all-deps` step is network-flaky (see §7 *Known issues*). Two options:

> **Important:** the server runs as root and drops to an unprivileged agent uid, then
> refuses to start unless that uid *cannot* write to `/app/data`, `/app/keys`, `/app/skills`.
> Those are host bind-mounts, which Docker Desktop (macOS/Windows) makes broadly writable, so
> the self-test fails and the container crash-loops. For a local demo, add the
> `docker-compose.dev.yml` overlay, which passes the project's documented dev escape
> `-dev-insecure-no-isolation`. (Safe for a local, single-user, no-live-agent demo only.)

**Option 1 — Full image (live-scan tools included):**
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

**Option 2 — Slim demo image (recommended for a data demo; fast & reliable):**
Builds only the Go binary + embedded UI, skips the live-scan toolbox. Everything the seeded
demo shows (asset graph, exploration graph, findings, evidence, governance) works; only live
scanning against real targets is unavailable.
```bash
docker build --target build -t artex-build-stage .          # compiles UI + binary (cached)
docker compose -f docker-compose.yml -f docker-compose.demo.yml -f docker-compose.dev.yml up -d
```

> All subsequent `docker compose ...` commands need the same `-f` files **and**
> `POSTGRES_PASSWORD` in the environment (compose has no default for it and there is no `.env`
> unless you created one). Either create `.env` (§2) or prefix commands with
> `POSTGRES_PASSWORD=...`.

Wait for the `artex` container to be healthy and listening (`listening on :8787`):
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f artex
```

### 3b. First-time login

Grab the one-time setup token and open the UI:
```bash
docker compose logs artex | grep -i "setup token"
```
Open **http://localhost:8787** → `/setup` → paste the token → set an admin password.

**Or** set a known demo password non-interactively (skips the token flow):
```bash
./reset-password.sh -m docker -p 'demo-admin-pw-2026'
```
Then log in as user **ARTEX** with that password.

### 3c. Seed the demo data

With the stack up and the schema initialised:
```bash
./scripts/demo/seed.sh
```
> **Restart the server after seeding.** ARTEX loads the task list into an in-memory manager
> at startup, so tasks inserted into the DB while it is running do not appear until you
> restart it: `docker compose -f docker-compose.yml -f docker-compose.dev.yml restart artex`.
> (Assets, findings, graphs and evidence are read live and show immediately; only the Tasks
> list needs the reload.) If you set/reset the admin password, that also requires a restart
> and invalidates existing sessions — log in again afterward.

This is **deterministic and idempotent** — re-run it anytime; it only touches its own demo
rows (`id >= 9000` / `demo-` prefix) and never clobbers your auth or other data. It:
- writes HTTP evidence **blobs** into `data/evidence/blobs/` (so finding receipts show real
  request/response bodies, not just headers), and
- loads two companies, 18 assets (all 6 types), 4 tasks with full exploration graphs
  (41 nodes, 46 edges, 27 anchors), 8 findings across all severities, 3 traffic receipts,
  a completed retest, scope rules, approval gates, and target pins.

Remove it again with `./scripts/demo/reset.sh`.

### 3d. Verify it's healthy

```bash
curl -s http://localhost:8787/api/auth/status           # {"initialized":true/false}
curl -s http://localhost:8787/healthz                   # liveness (if present)
docker compose logs --tail=50 artex                      # should show "listening" on :8787
```
In the browser, after login you should see **4 tasks** under **Tasks** and **8 findings**
under **Findings**. SSE/real-time streams drive live updates on the Tasks, task-detail
(sessions), and Traffic pages — they connect automatically once you open those pages.

---

## 4. Path B — Mock UI (no backend)

Fastest way to show every screen, with the built-in demo dataset:
```bash
cd web
npm install                                   # once
NEXT_PUBLIC_MOCK=1 npm run dev -- -p 3200
```
Open **http://localhost:3200**. No login, no DB, no keys. Every screen is populated from
`web/src/lib/mock/data.ts` (an Acme Corp external→internal engagement). Blob download, HAR
import/export and live replay are disabled in mock mode (they need the backend).

---

## 5. Demo script — every major capability

Follow this order for a coherent "external recon → admin → DMZ → internal" narrative. Routes
are the same on both paths (Path A: `localhost:8787`, Path B: `localhost:3200`).

1. **Dashboard** (`Dashboard`) — token usage, task/finding rollups, activity. Shows the
   platform is live and the budget governor is tracking usage.
2. **Asset graph** (`Assets`) — two companies (Acme Corp, Globex Retail). Expand Acme to see
   the hierarchy: `acme.com` → subdomains (`www`, `api`, `shop`, `admin`) → IPs
   (`203.0.113.10/11/12`) → services (nginx, kong) → endpoints (`/search`, `/v1/orders`) →
   mobile app. Point out **dedup keys** (one row per domain/url/ip) and per-asset
   technologies/open-ports. Use **Asset Sync** to show scope-driven company attribution.
3. **Tasks** (`Tasks`) — 4 tasks across the lifecycle: *Acme Web* (running, target-gate ON),
   *Acme API* (running), *Acme DMZ → internal* (done), *Globex recon* (paused). Open **Acme
   Web** (eye icon).
   The task detail opens with tabs: **Sessions · Overview · Exploration graph · Broadcast ·
   Findings · Retests · Test assets · Credentials · Assets**.
4. **Exploration graph** (task → **Exploration graph** tab) — the two-graph story: `begin` (origin) →
   **goals** → **intents** (open/running/paused/done/blocked/exhausted/stopped) →
   **facts/findings** → **hints** → **digest**. Edges are typed: `spawns`, `derived_from`,
   `yields`, `proves`, `covers`. Each finding `proves` its goal. **Anchors** tie intents and
   findings to concrete assets, and the **coverage** view shows what was tested and the
   outcome (`reported` / `no_issue_found` / `ruled_out` / `needs_follow_up` / `not_applicable`).
5. **Sessions & tool calls** (task → **Sessions** tab) — the planner/worker activity timeline: tool
   `tool_use`/`tool_result` events (subfinder, WebFetch, sqlmap), token accounting per round.
   This is the closed exploration loop in action.
6. **Findings** (`Findings`) — 17 findings (mock) / 8 (seed) with severity tiles
   (Critical→Low), status, verification state (verified/unverified), and **Traffic evidence**
   counts. Open the **Fastjson RCE (Critical)** finding:
   - **Report** tab: full Markdown write-up (overview, reproduction, remediation).
   - **Evidence / Traffic** tab: the bound **request/response receipt** — headers **and**
     body (the JNDI gadget request and the out-of-band callback). This is "keeps its receipts."
   - **Retest**: the *Fastjson RCE* finding has a completed retest (verdict **reproduced**).
   Use **By task** / **By asset** views and **Export**.
7. **Traffic** (`Traffic`) — the recording MITM proxy view. Seeded evidence snapshots appear
   as finding receipts; the *live* capture list populates when the proxy (`:8788`) actually
   proxies a target (not part of the static seed).
8. **Tool-call audit log** (`Tool Execution`, route `/function/commands`) — every tool call
   workers made (Bash, WebFetch, sqlmap) with task, worker, arguments and success/failure.
   This is the auditable "what did the agent actually run" trail.
9. **Governance — approvals (human-in-the-loop)** — the seed inserts `intercept_rules`
   (allow passive recon / **ask** before sqlmap / **deny** destructive shell) and
   `intercept_pending` rows: a **pending** `sqlmap` approval, a **pending target-gate** request
   for `api.acme.com:443`, plus history (operator-approved, rule-denied, auto-approved). These
   drive the approval queue that pops during a live run; with no live agent they live in the
   DB and are visible via the API (`/api/interception/...`) and the task's gating controls.
10. **Governance — scope & lifecycle** — in a task: **Scope** (in-scope company/domains/CIDR)
    and **Constraints** (deny: *don't touch vpn.acme.com*, *read-only proof only*). Target
    pins list approved hosts (`shop.acme.com:443` active; `vpn.acme.com` revoked). Task budget
    / timeout / status transitions illustrate the lifecycle.
11. **System** — **LLM** (three profiles + rotation/failover; add a real key to run live),
    **Agent** (planner/worker/mainagent roles & prompts), **MCP**, **Skill**, **Tools**,
    **Notifications**. **LLM Recording** shows raw request/response transcripts per call.
12. **Chat** (`Chat`) — the main-agent human-in-the-loop console (ask the agent to act; needs
    a live LLM key to respond).

---

## 6. Useful commands

All commands assume `POSTGRES_PASSWORD` is set (in `.env` or the shell) and the dev overlay.
Set a shell default once per terminal: `export POSTGRES_PASSWORD=artex_local_demo_pw_2026`.

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
$DC up -d --build                   # full stack (dev-isolation overlay)
$DC logs -f artex                   # follow backend logs (incl. setup token, listening line)
$DC restart artex                   # reload the task list after seeding
./scripts/demo/seed.sh              # load/refresh demo data (idempotent), then restart artex
./scripts/demo/reset.sh             # remove demo data
$DC down                            # stop (keeps the pgdata volume)
$DC down -v                         # stop and wipe the database volume
```

---

## 6b. Persona-aware Guided Walkthrough (in-product)

A live, in-product guided tour is built into the UI, with a **Persona Mode Switcher** so a
presenter can toggle perspective mid-tour and get tailored narratives for every chapter.

- **Start it:** click **Guided tour** (compass icon) in the top header. A Guide Card appears
  bottom-right and the tour navigates to each chapter's screen, spotlighting the relevant panel.
- **Switch persona in place:** the card's segmented toggle — **Executive (CISO)** vs.
  **Analyst (SecEng)** — rewrites the current step's *Headline/Summary*, *Try this* action, and
  *Why it matters* takeaway **without resetting progress or navigating away**.
  - *Executive (CISO):* business-risk reduction, attack-surface visibility, MTTR/remediation
    verification, false-positive cost, auditability, operational guardrails.
  - *Analyst (SecEng):* dedup keys, `exploration_anchors`, graph lineage edges
    (`spawns`/`derived_from`/`yields`/`proves`), HTTP request/response receipts, payload traces,
    scope/rate-limit rules, targeted retest mechanics.
- **Six chapters**, each navigating to a real screen and spotlighting it:
  1. Taming Asset Sprawl → Assets graph
  2. Coverage & Blind-Spot Triage → task **Asset coverage** tab
  3. Multi-Step Attack Paths → task **Exploration graph** tab
  4. Proof-Backed Triage → Findings (open a finding → Linked traffic → View message)
  5. Guardrailed Execution → **Scope & Guardrails → Scope & Interception Rules**
  6. Closing the Remediation Loop → finding **Mitigation & remediation** panel → task **Retests**
     tab → **Posture & Focus → Focus Queue**
- **Navigation & reset:** Prev/Next, chapter dots (jump to any chapter), and **Reset** (restart
  at chapter 1, keeps the chosen persona). **Esc** or the ✕ closes it.
- **Persistence:** the chosen persona and chapter are saved to `localStorage`; a shareable deep
  link `?tour=1&persona=analyst&chapter=3` auto-starts the tour at that step/persona.
- **Note:** chapters 2/3/6 deep-link to the seeded demo task (id `9001`), so run the seed
  (`scripts/demo/seed.sh`) and restart `artex` first for those chapters to land on populated
  content. Chapters 1/4/5 work against any data.

---

## 7. Known issues, quirks & limitations found in this repo

- **Agent-isolation self-test blocks startup under Docker.** As root the server requires that
  the unprivileged agent uid cannot write to the bind-mounted `/app/data`, `/app/keys`,
  `/app/skills`; Docker Desktop makes those writable, so it crash-loops. Fixed here with the
  `docker-compose.dev.yml` overlay (`-dev-insecure-no-isolation`). This is **verified working**
  — the full stack came up and the whole seeded demo was confirmed end-to-end (tasks,
  exploration graph, findings, retest, and blob-backed traffic receipts all render).
- **Full Docker build is heavy and the `bbot` step is flaky on arm64.** The runtime image
  compiles/installs a large toolbox; the `bbot -y --install-all-deps` layer failed **once** on
  this machine (Apple silicon) with a strict post-install check, then **succeeded on retry** —
  it was a transient network hiccup during dependency install. If it fails for you, just re-run
  the build (it resumes from cache), or use the slim demo image
  (`Dockerfile.demo` / `docker-compose.demo.yml`), which skips the toolbox and builds reliably.
- **Seed → restart.** Tasks are held in an in-memory manager; `docker compose ... restart artex`
  after seeding is required for the Tasks list to show the seeded tasks (other screens update
  live). Setting the admin password also needs a restart and invalidates sessions.
- **No LLM keys by default = no live agent.** Tasks won't *advance* and Chat won't *reply*
  without a real provider key in **System → LLM**. The demo data is pre-populated so every
  screen is rich without spending tokens. Add a key only if you want to run a live task.
- **Live Traffic capture is empty in the seed.** Seeded evidence snapshots render as finding
  receipts, but the live proxy-capture list only fills when the MITM proxy (`:8788`) actually
  proxies requests during a real task.
- **`.env` is required by compose** (`POSTGRES_PASSWORD` has no default and compose errors
  without it). Secret-management tooling may block editing `.env` automatically — create it by
  hand with the values in §2.
- **Evidence blobs are host-side.** `seed.sh` writes request/response bodies into
  `data/evidence/blobs/` (bind-mounted into the container). If you run the stack on a remote
  Docker host, run the seed there so the blobs land on the same filesystem.
- **Ports.** UI/API `8787`, MITM proxy `8788`, both bound to `127.0.0.1`. Mock UI uses `3200`
  here to avoid colliding with other dev servers.
- **Single admin user.** There is no multi-user model; auth is one bcrypt-hashed admin
  password in `settings`. Use `reset-password.sh` to (re)set it.

---

## 8. File map (what was added for the demo)

| Path | Purpose |
|------|---------|
| `scripts/demo/seed_demo.py` | Deterministic seed generator: writes evidence blobs + emits idempotent SQL covering all entities |
| `scripts/demo/seed.sh` | Runs the generator and loads the SQL into the running Postgres |
| `scripts/demo/reset.sh` | Removes the demo rows (id ≥ 9000 / `demo-` prefix) |
| `docker-compose.dev.yml` | Overlay that disables the agent-isolation self-test for a local demo |
| `Dockerfile.demo` + `docker-compose.demo.yml` | Slim image: UI + API + server, no live-scan toolbox |
| `web/src/lib/walkthrough/chapters.ts` | Guided-walkthrough chapter schema + the 6 chapters' Executive/Analyst content |
| `web/src/lib/walkthrough/store.ts` | Walkthrough state (active, chapter, persona) — zustand |
| `web/src/components/walkthrough/walkthrough.tsx` | Guide Card, persona toggle, spotlight overlay, header launcher |
| `DEMO_RUNBOOK.md` | This file |

Walkthrough anchors were added as `data-tour` attributes on the sidebar nav items and on the
task-detail `graph` / `coverage` / `retests` tab panels, plus deep-linkable `?tab=` support on
the task-detail page.
