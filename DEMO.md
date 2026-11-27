# ARTEX Demo — In-Product Guided Walkthrough

ARTEX ships an **in-product Guided Walkthrough**: a docked, light-mode card that tells the
business story of each capability while spotlighting the exact UI it describes. It is
organised as **use cases** (business scenarios), each with one or more steps, and every step
is tailored to the viewer's **persona**.

For local setup, seeding and the two run modes (full Docker stack vs. backend-free mock UI),
see **[DEMO_RUNBOOK.md](DEMO_RUNBOOK.md)**. This file documents the walkthrough itself.

---

## Launching it

- Click **Guided Walkthrough** (compass icon) in the top header.
- A **WalkthroughCard** docks bottom-right (it flips to the left when the spotlight is on a
  right-side panel, e.g. the node inspector) and the tour navigates to each step's screen.
- Shareable deep link: `?tour=1&step=<n>&persona=<executive|analyst>` auto-starts the tour at
  that step/persona (e.g. `/function/assets/?tour=1&step=3&persona=analyst`).

### Card controls
| Control | Behaviour |
|---------|-----------|
| **Use-case switcher** (dropdown) | Jump between Use Case 1–6 (first step of each). |
| **Persona toggle** | `Executive (CISO)` vs. `Analyst (SecEng)` — rewrites the current step's copy **in place**, without resetting progress. |
| **Step X of Y** | Position within the current use case. |
| **Back / Next** | Move through steps; **Next** on the last step finishes. |
| **Reset Demo** | Restart at Use Case 1, Step 1 (keeps the selected persona). |
| **Exit Tour** (or ✕ / Esc) | Close the walkthrough (progress is kept in `localStorage`). |

### Four plain-English sections per step
1. **The Pain Point** — what frustrates security/engineering teams today, in plain words.
2. **What You're Looking At** — a concrete guide to the exact numbers/rows/nodes on screen.
3. **How ARTEX Addresses This VMDR Use Case** (card label: *How ARTEX helps*): what ARTEX is doing here, plus a **Try This** action (click/filter/inspect/approve), with a `data-tour` spotlight.
4. **Value Shipped** — the tangible outcome delivered to the team.

---

## The six VMDR use cases (10 steps)

Every step lands on seeded, populated data (on first load and after **Reset Demo**). IDs below
are the deterministic seed rows the step deep-links to.

| Step | Use case | Screen it opens | What the viewer sees (seeded data) |
|------|----------|-----------------|------------------------------------|
| 1.1 | **Taming Asset Sprawl** | Assets | 31 canonical assets across 3 companies; `acme.demo.local` reported by 3 separate tasks. |
| 1.2 | | Assets → Endpoints tab | The root-domain → subdomain → IP → service → app → endpoint hierarchy. |
| 1.3 | | Asset inspector `#9210` | Dedup key for `GET https://api.acme.demo.local/api/v2/invoices/{id}` + **3 merged task observations**. |
| 1.4 | | Asset inspector `#9210` | Findings from two different tasks (IDOR from 9006, stack trace from 9005) on the same node. |
| 2.1 | **Finding Real Attack Paths** | Task `9001` → Exploration graph | Start → intent → fact → finding → Goal chain (2 goals, 3 findings) joined by 2 `proves` edges. |
| 3.1 | **Eliminating False Positives with Proof** | Finding `9005` detail | Critical Fastjson RCE, *Verified L4*, Linked traffic `POST /api/import → 200` (View message), Exploration-graph tab = worker trace. |
| 4.1 | **Spotting Testing Blind Spots** | Task `9001` → Asset coverage | *In scope 13 · Tested 3*: green = tested, gray = discovered but never tested. |
| 5.1 | **Safe Testing with Guardrails** | System → Interception rules | Top rule (priority 120) **blocks `prod-db.acme.demo.local`**; deny destructive shell; allow nuclei; ask before sqlmap. |
| 5.2 | | Task `9001` → Interception approval | A pending `sqlmap` request waiting for a human **Approve / Deny** (120 s timeout → deny). |
| 6.1 | **Proving Fixes Fast** | Task `9001` → Retests | Finding 9006 (default creds): retest `#9002` *Still reproducible* (200 OK) → retest `#9003` *Fixed* (403 Forbidden); **Start retest** runs a new one. |

> Deciding the pending approval in step 5.2 changes real data. Re-run `scripts/demo/seed.sh`
> to put it back (the seed is idempotent and only touches ids ≥ 9000). **Reset Demo** on the card
> resets the *tour* (back to step 1.1, persona kept), not the database.

### Use Case 1 dataset (`acme.demo.local`, Acme Cloud Corp)

Reported by **three** separate discovery/test tasks (9005, 9006, 9007) with overlapping raw
observations. ARTEX resolves them into single canonical nodes via deterministic dedup keys:

```
root_domain  acme.demo.local
 ├─ subdomain api.acme.demo.local ──► ip 198.51.100.14 ──► service 443/tcp https
 │                                                         app Customer Billing Portal
 │                                                          └─ endpoint GET /api/v2/invoices/{id}   ← canonical #9210
 │                                                          └─ endpoint POST /api/v2/auth/token
 ├─ subdomain portal.acme.demo.local ─► ip 198.51.100.22 ─► service 8443/tcp admin-api
 │                                                          app Internal Partner Gateway
 │                                                          └─ endpoint GET /internal/export
 └─ subdomain admin-staging.acme.demo.local
```

### The Asset node inspector
Clicking any asset row, or deep-linking `?type=<t>&inspect=<assetId>`, opens a right-side
drawer with the canonical identity, the **deduplication key** (mirrors the `uq_av2_*` unique
indexes in `db/schema.sql`), parent → child lineage, the contributing tasks (`task_ids`), and the
findings attached to that node from any task.

### Verifying the walkthrough
Walk all 10 steps in **both** personas with the deep link, e.g.
`http://localhost:8787/function/assets/?tour=1&step=1&persona=executive` then **Next** through to **Finish**,
switching persona on any step (copy swaps in place; the screen does not move). Run
`scripts/demo/seed.sh` and restart `artex` first so the tasks are loaded.

> Task-detail pages tolerate a brief backend restart: a failed first fetch keeps showing
> *Loading…* and retries, instead of flashing “task does not exist”.

---

## Files

| Path | Purpose |
|------|---------|
| `web/src/lib/walkthrough/usecases.ts` | Use-case & step model + all content (both personas, 4 sections). |
| `web/src/lib/walkthrough/store.ts` | Walkthrough state (active / step / persona). |
| `web/src/components/walkthrough/walkthrough.tsx` | WalkthroughCard, persona toggle, spotlight overlay, header launcher. |
| `web/src/app/(main)/function/assets/asset-inspector.tsx` | Asset node-inspector drawer (dedup key, lineage, provenance). |
| `scripts/demo/seed_demo.py` | Deterministic seed for every step: `acme.demo.local` assets, evidence receipts, prod-db deny rule, pending approval, before/after retests. |
