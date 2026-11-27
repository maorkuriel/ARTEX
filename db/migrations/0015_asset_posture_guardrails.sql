-- Asset-centric posture spine and the three-layer guardrail audit trail.
-- Purely additive: every new column has a safe default (or is nullable), so
-- existing rows, queries and API responses keep working unchanged.

-- Business context an operator sets per canonical asset.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS business_criticality TEXT NOT NULL DEFAULT 'tier_2_business';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_team TEXT NOT NULL DEFAULT 'Unassigned';
-- NULL = not declared. Declaring 'production' opts the asset into read-only validation.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS environment TEXT;
-- NULL = derived (read_only_validation for production or tier_1 assets, otherwise legacy behaviour).
ALTER TABLE assets ADD COLUMN IF NOT EXISTS validation_mode TEXT;

-- Rolled-up posture state, written by RollupHierarchyPosture.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS posture_status TEXT NOT NULL DEFAULT 'unvalidated_blind_spot';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS posture_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS validation_coverage_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS posture_computed_at TIMESTAMPTZ;

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_business_criticality_check;
ALTER TABLE assets ADD CONSTRAINT assets_business_criticality_check
    CHECK (business_criticality IN ('tier_1_crown_jewel','tier_2_business','tier_3_standard'));
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_environment_check;
ALTER TABLE assets ADD CONSTRAINT assets_environment_check
    CHECK (environment IS NULL OR environment IN ('production','staging','development'));
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_validation_mode_check;
ALTER TABLE assets ADD CONSTRAINT assets_validation_mode_check
    CHECK (validation_mode IS NULL OR validation_mode IN ('read_only_validation','controlled_active_validation'));
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_posture_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_posture_status_check
    CHECK (posture_status IN ('critical_exposure','high_exposure','validated_clean','unvalidated_blind_spot','pending_retest'));
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_posture_score_check;
ALTER TABLE assets ADD CONSTRAINT assets_posture_score_check CHECK (posture_score BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS idx_assets_posture_status ON assets(posture_status);
CREATE INDEX IF NOT EXISTS idx_assets_criticality ON assets(business_criticality);

-- Structured, append-only guardrail decisions (Layer 1 policy, Layer 2 budgets,
-- Layer 3 approvals). Rows cannot be updated; deletes remain possible for retention.
CREATE TABLE IF NOT EXISTS guard_audit_events (
    id               BIGSERIAL PRIMARY KEY,
    ts               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor            TEXT NOT NULL DEFAULT '',
    task_id          TEXT NOT NULL DEFAULT '',
    tool_name        TEXT NOT NULL DEFAULT '',
    target           TEXT NOT NULL DEFAULT '',
    target_asset_id  BIGINT,
    layer            SMALLINT NOT NULL DEFAULT 1 CHECK (layer BETWEEN 1 AND 3),
    policy_rule      TEXT NOT NULL,
    decision         TEXT NOT NULL CHECK (decision IN ('allowed','blocked','held_for_approval','approved','denied')),
    rationale        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_guard_audit_ts ON guard_audit_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_guard_audit_task ON guard_audit_events(task_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_guard_audit_asset ON guard_audit_events(target_asset_id) WHERE target_asset_id IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_audit_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'guard_audit_events rows are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_audit_events_immutable ON guard_audit_events;
CREATE TRIGGER trg_guard_audit_events_immutable
    BEFORE UPDATE ON guard_audit_events
    FOR EACH ROW EXECUTE FUNCTION guard_audit_events_immutable();
