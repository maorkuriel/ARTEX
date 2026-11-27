package guard

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/intercept"
)

// A worker POST against a Tier-1 / production asset is blocked by the posture
// guardrail before any rule or judge runs, and the block is written to the
// guard audit trail with its policy rule.
func TestPostureGuardBlocksMutationOnReadOnlyAssetPG(t *testing.T) {
	dsn, _, err := db.DSN()
	if err != nil {
		db.SkipPGUnavailable(t, err)
	}
	d, err := db.Open(dsn)
	if err != nil {
		db.SkipPGUnavailable(t, err)
	}
	t.Cleanup(func() { d.Close() })
	const assetID = int64(7_710_001)
	const task = "guard-posture-test"
	cleanup := func() {
		_, _ = d.Exec(`DELETE FROM guard_audit_events WHERE task_id = $1`, task)
		_, _ = d.Exec(`DELETE FROM assets WHERE id = $1`, assetID)
	}
	cleanup()
	t.Cleanup(cleanup)
	if _, err := d.Exec(`INSERT INTO assets (id, type, domain, root_domain, business_criticality, environment, owner_team)
		VALUES ($1,'subdomain','crown.guard-test.example','guard-test.example','tier_1_crown_jewel','production','Core Identity')`, assetID); err != nil {
		t.Fatal(err)
	}

	g := NewWithInterceptor(intercept.New(d))
	ctx := intercept.WithTaskContext(context.Background(), task, "worker-1", nil)
	input, _ := json.Marshal(map[string]string{"url": "https://crown.guard-test.example/api/users", "method": "POST"})
	block, msg, _ := g.Hooks().PreToolUse(ctx, "WebFetch", input)
	if !block {
		t.Fatal("POST against a read-only Tier-1 asset was not blocked")
	}
	if !strings.Contains(msg, "read_only_validation") {
		t.Fatalf("block message = %q", msg)
	}
	evs, err := d.ListGuardAuditEvents(context.Background(), db.GuardAuditFilter{TaskID: task})
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].Decision != db.GuardBlocked || evs[0].PolicyRule != intercept.PolicyReadOnly ||
		evs[0].TargetAssetID == nil || *evs[0].TargetAssetID != assetID || evs[0].Actor != "worker-1" {
		t.Fatalf("audit = %+v", evs)
	}
}
