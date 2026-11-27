-- Coverage Intelligence & Blind-Spot Engine. Additive only: new nullable or
-- defaulted columns on assets plus two new tables; nothing existing changes.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS coverage_state TEXT NOT NULL DEFAULT 'unvalidated_blind_spot';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS blind_spot_reason TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS anchor_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS intent_anchor_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS validation_cadence_days INTEGER NOT NULL DEFAULT 14;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS next_validation_due_at TIMESTAMPTZ;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS coverage_computed_at TIMESTAMPTZ;

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_coverage_state_check;
ALTER TABLE assets ADD CONSTRAINT assets_coverage_state_check
    CHECK (coverage_state IN ('validated','partially_validated','unvalidated_blind_spot','stale_validation','out_of_scope'));
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_blind_spot_reason_check;
ALTER TABLE assets ADD CONSTRAINT assets_blind_spot_reason_check
    CHECK (blind_spot_reason IS NULL OR blind_spot_reason IN
        ('never_tested','out_of_scope','budget_exhausted','blocked_by_auth_or_waf','awaiting_guard_approval','cadence_expired'));
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_validation_cadence_days_check;
ALTER TABLE assets ADD CONSTRAINT assets_validation_cadence_days_check CHECK (validation_cadence_days BETWEEN 1 AND 365);
CREATE INDEX IF NOT EXISTS idx_assets_coverage_state ON assets(coverage_state);

-- Coverage policies: cadence, triggers and the enforced validation mode per tier / scope.
CREATE TABLE IF NOT EXISTS coverage_policies (
    id                   BIGSERIAL PRIMARY KEY,
    name                 TEXT NOT NULL,
    business_criticality TEXT CHECK (business_criticality IS NULL OR business_criticality IN
                             ('tier_1_crown_jewel','tier_2_business','tier_3_standard')),
    scope_pattern        TEXT NOT NULL DEFAULT '',   -- '' = any; else a domain/host suffix, e.g. acme.demo.local
    cadence_days         INTEGER NOT NULL CHECK (cadence_days BETWEEN 1 AND 365),
    triggers             TEXT[] NOT NULL DEFAULT '{}',
    validation_mode      TEXT NOT NULL DEFAULT 'read_only_validation'
                             CHECK (validation_mode IN ('read_only_validation','controlled_active_validation')),
    enabled              BOOLEAN NOT NULL DEFAULT true,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per blind-spot validation request (POST /api/coverage/validate-blind-spots).
CREATE TABLE IF NOT EXISTS coverage_validation_requests (
    id               BIGSERIAL PRIMARY KEY,
    asset_id         BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    status           TEXT NOT NULL CHECK (status IN ('rejected','held_for_approval','denied','queued','completed')),
    validation_mode  TEXT NOT NULL DEFAULT 'read_only_validation',
    simulated        BOOLEAN NOT NULL DEFAULT false,
    reason           TEXT NOT NULL DEFAULT '',
    pending_id       BIGINT,
    node_id          BIGINT,
    requested_by     TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cov_requests_asset ON coverage_validation_requests(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cov_requests_status ON coverage_validation_requests(status);
