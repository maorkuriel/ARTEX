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

### Four structured sections per step
1. **Business Problem** — why organizations struggle here.
2. **ARTEX Value** — the concrete operational & risk outcome.
3. **What You're Looking At** — the data on screen.
4. **Guided Action** — the exact click/filter instruction (with a `data-tour` spotlight).

---

## Use Case 1 — Asset Normalization & Deduplication

Demonstrated on **Acme Cloud Corp** (`acme.demo.local`), whose attack surface was reported by
**three** separate discovery/test tasks with overlapping raw observations. ARTEX resolves them
into single canonical nodes via deterministic dedup keys.

Canonical hierarchy seeded:

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

**The 4 steps:**

| Step | What it shows | Guided action |
|------|---------------|---------------|
| **1.1 — The asset-sprawl problem** | The shared Asset Graph for `acme.demo.local`; counts are canonical, not raw. | Note the root scope and per-type counts. |
| **1.2 — Hierarchical normalization** | The type tabs mirror `root_domain → … → endpoint`. | Open the **Endpoints** tab and find `/api/v2/invoices/{id}`. |
| **1.3 — Deterministic dedup keys** | The **node inspector** for endpoint `#9210`: computed dedup key + **3 merged task observations**. | Read the Deduplication key and the 3 contributing tasks. |
| **1.4 — Cross-task enrichment** | Findings from **different tasks** (IDOR from task 9006, stack-trace from task 9005) attach to the **same** canonical node. | See findings from separate tasks resolve to one asset id. |

### The Asset node inspector (new)
Clicking any asset row — or deep-linking `?type=<t>&inspect=<assetId>` — opens a right-side
inspector drawer showing:
- **Canonical identity** (type + `#id`).
- **Deduplication key** — the uniqueness tuple ARTEX normalizes each raw observation to
  (mirrors the `uq_av2_*` unique indexes in `db/schema.sql`); re-observations UPSERT onto the
  same canonical id.
- **Parent → child lineage** — reconstructed from the node's own fields.
- **Merged observations** — the contributing tasks (`task_ids`) that independently reported it.
- **Findings on this canonical node** — findings from any task whose `asset_ids` reference it.

---

## Use Cases 2–6 (one step each)

| # | Use case | Screen |
|---|----------|--------|
| 2 | Coverage & Blind-Spot Triage | task → Asset-coverage tab |
| 3 | Multi-Step Attack Paths | task → Exploration-graph tab |
| 4 | Proof-Backed Triage | Findings (+ evidence receipts) |
| 5 | Guardrailed Execution | System → Interception rules |
| 6 | Closing the Remediation Loop | task → Retests tab |

Each carries the same four persona-tailored sections. Chapters 2/3/6 deep-link to the seeded
`acme.com` task (id `9001`); run `scripts/demo/seed.sh` and restart `artex` so they land on
populated content.

---

## Files

| Path | Purpose |
|------|---------|
| `web/src/lib/walkthrough/usecases.ts` | Use-case & step model + all content (both personas, 4 sections). |
| `web/src/lib/walkthrough/store.ts` | Walkthrough state (active / step / persona). |
| `web/src/components/walkthrough/walkthrough.tsx` | WalkthroughCard, persona toggle, spotlight overlay, header launcher. |
| `web/src/app/(main)/function/assets/asset-inspector.tsx` | Asset node-inspector drawer (dedup key, lineage, provenance). |
| `scripts/demo/seed_demo.py` | Deterministic seed, incl. the `acme.demo.local` Use Case 1 dataset. |
