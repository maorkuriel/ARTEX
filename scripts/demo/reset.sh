#!/usr/bin/env bash
# Remove the ARTEX demo dataset (rows id >= 9000 / 'demo-' prefix) and its evidence blobs.
# Leaves auth, user-created tasks and config untouched.
set -euo pipefail
cd "$(dirname "$0")/../.."
PROJECT_ROOT="$(pwd)"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
PG_USER="${POSTGRES_USER:-artex}"; PG_DB="${POSTGRES_DB:-artex}"; PG_SERVICE="${ARTEX_PG_SERVICE:-postgres}"

echo "==> Deleting demo rows from '$PG_DB'"
docker compose exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;
DELETE FROM finding_traffic_bindings WHERE finding_id >= 9000;
DELETE FROM traffic_evidence_snapshots WHERE id LIKE 'demo-%';
DELETE FROM finding_retests WHERE id >= 9000 OR conversation_id >= 9000;
DELETE FROM findings WHERE id >= 9000;
DELETE FROM coverage_ledger_history WHERE task_id >= 9000;
DELETE FROM coverage_ledger WHERE task_id >= 9000;
DELETE FROM activity WHERE exploration_id >= 9000;
DELETE FROM task_constraints WHERE exploration_id >= 9000;
DELETE FROM exploration_anchors WHERE node_id >= 9000;
DELETE FROM exploration_edges WHERE exploration_id >= 9000;
DELETE FROM task_scope WHERE task_id >= 9000;
DELETE FROM task_asset_links WHERE task_id >= 9000;
DELETE FROM intercept_pending WHERE id >= 9000;
DELETE FROM intercept_rules WHERE id >= 9000;
DELETE FROM target_pins WHERE id >= 9000;
DELETE FROM tasks WHERE id >= 9000;
DELETE FROM exploration_nodes WHERE id >= 9000;
DELETE FROM explorations WHERE id >= 9000;
DELETE FROM company_scope WHERE company_id >= 9000;
DELETE FROM assets WHERE id >= 9000;
DELETE FROM companies WHERE id >= 9000;
DELETE FROM conversations WHERE id >= 9000;
DELETE FROM llm_profiles WHERE id >= 9000;
COMMIT;
SQL
echo "==> Removing demo evidence blobs"
# Only blobs referenced exclusively by the demo are GC'd by the server; here we just
# leave the content-addressed store intact (harmless) unless you want a full wipe:
# rm -rf "$PROJECT_ROOT/data/evidence/blobs"   # uncomment for a hard wipe
echo "==> Demo data removed."
