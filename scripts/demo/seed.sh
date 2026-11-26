#!/usr/bin/env bash
# Seed the local ARTEX database with the deterministic demo dataset and evidence blobs.
#
#   scripts/demo/seed.sh
#
# Prereqs: the docker compose stack is up (`docker compose up -d`) and the artex
# service has initialised the schema (it runs db/schema.sql on first start).
# Safe to re-run: it only replaces its own demo rows (id >= 9000 / 'demo-' prefix).
set -euo pipefail

cd "$(dirname "$0")/../.."          # project root
PROJECT_ROOT="$(pwd)"

# Load POSTGRES_* from .env if present (so psql hits the right db/user).
if [ -f .env ]; then set -a; . ./.env; set +a; fi
PG_USER="${POSTGRES_USER:-artex}"
PG_DB="${POSTGRES_DB:-artex}"
PG_SERVICE="${ARTEX_PG_SERVICE:-postgres}"

PY="$(command -v python3 || true)"
[ -n "$PY" ] || { echo "python3 is required to generate the seed" >&2; exit 1; }

echo "==> Generating evidence blobs (-> data/evidence) and SQL"
mkdir -p "$PROJECT_ROOT/data/evidence"
SQL_FILE="$PROJECT_ROOT/scripts/demo/seed_demo.generated.sql"
ARTEX_EVIDENCE_DIR="$PROJECT_ROOT/data/evidence" "$PY" scripts/demo/seed_demo.py > "$SQL_FILE"

echo "==> Applying seed to database '$PG_DB' (user '$PG_USER') via compose service '$PG_SERVICE'"
if ! docker compose exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$PG_DB" -c "SELECT 1 FROM companies LIMIT 1" >/dev/null 2>&1; then
  echo "ERROR: cannot reach the schema. Is the stack up and has artex initialised the DB?" >&2
  echo "       docker compose up -d   # then wait for the artex container to be healthy" >&2
  exit 1
fi
docker compose exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q -f - < "$SQL_FILE"

echo "==> Done. Demo data loaded:"
docker compose exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$PG_DB" -At -c "
SELECT 'companies='||count(*) FROM companies WHERE id>=9000
UNION ALL SELECT 'assets='||count(*) FROM assets WHERE id>=9000
UNION ALL SELECT 'tasks='||count(*) FROM tasks WHERE id>=9000
UNION ALL SELECT 'exploration_nodes='||count(*) FROM exploration_nodes WHERE id>=9000
UNION ALL SELECT 'findings='||count(*) FROM findings WHERE id>=9000
UNION ALL SELECT 'evidence_snapshots='||count(*) FROM traffic_evidence_snapshots WHERE id LIKE 'demo-%'
UNION ALL SELECT 'pending_approvals='||count(*) FROM intercept_pending WHERE id>=9000 AND status='pending';"
echo "    Open http://localhost:8787 and explore Tasks / Assets / Findings / Traffic."
