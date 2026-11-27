package db

import (
	"context"
	"testing"
	"time"
)

func TestComputeAssetPostureStatuses(t *testing.T) {
	cases := []struct {
		name string
		in   PostureInput
		want string
	}{
		{"untested leaf is a blind spot", PostureInput{Total: 1, Covered: 0}, PostureBlindSpot},
		{"tested leaf with no findings is clean", PostureInput{Total: 1, Covered: 1}, PostureValidatedClean},
		{"partially tested subtree is never clean", PostureInput{Total: 5, Covered: 4}, PostureBlindSpot},
		{"open critical wins", PostureInput{Total: 1, Covered: 1, OpenCritical: 1, ActiveRetests: 1}, PostureCriticalExposure},
		{"open high", PostureInput{Total: 1, Covered: 1, OpenHigh: 1}, PostureHighExposure},
		{"open medium counts as high exposure", PostureInput{Total: 1, Covered: 1, OpenMedium: 1}, PostureHighExposure},
		{"active retest", PostureInput{Total: 1, Covered: 1, ActiveRetests: 1}, PosturePendingRetest},
		{"untested with low finding stays a blind spot", PostureInput{Total: 1, OpenLow: 1}, PostureBlindSpot},
		{"zero total behaves like one untested asset", PostureInput{}, PostureBlindSpot},
	}
	for _, c := range cases {
		if got := ComputeAssetPosture(c.in).Status; got != c.want {
			t.Errorf("%s: status = %s, want %s", c.name, got, c.want)
		}
	}
}

func TestComputeAssetPostureScore(t *testing.T) {
	// Fully validated, nothing open → 100.
	if got := ComputeAssetPosture(PostureInput{Total: 2, Covered: 2}).Score; got != 100 {
		t.Fatalf("clean score = %d, want 100", got)
	}
	// Never validated → capped at 50 even with no findings (100 − 40 = 60 → cap 50).
	if got := ComputeAssetPosture(PostureInput{Total: 1}).Score; got != 50 {
		t.Fatalf("blind spot score = %d, want 50", got)
	}
	// One open high on a covered Tier-2 asset: 100 − 20 = 80.
	if got := ComputeAssetPosture(PostureInput{Total: 1, Covered: 1, OpenHigh: 1, Criticality: CriticalityTier2}).Score; got != 80 {
		t.Fatalf("tier-2 high score = %d, want 80", got)
	}
	// Same on Tier-1: 100 − 1.25×20 = 75; Tier-3: 100 − 0.75×20 = 85.
	if got := ComputeAssetPosture(PostureInput{Total: 1, Covered: 1, OpenHigh: 1, Criticality: CriticalityTier1}).Score; got != 75 {
		t.Fatalf("tier-1 high score = %d, want 75", got)
	}
	if got := ComputeAssetPosture(PostureInput{Total: 1, Covered: 1, OpenHigh: 1, Criticality: CriticalityTier3}).Score; got != 85 {
		t.Fatalf("tier-3 high score = %d, want 85", got)
	}
	// Penalties are capped and the score never goes below 0.
	got := ComputeAssetPosture(PostureInput{Total: 1, OpenCritical: 10, OpenHigh: 10, OpenMedium: 10, OpenLow: 10, Criticality: CriticalityTier1}).Score
	if got != 0 {
		t.Fatalf("worst case score = %d, want 0", got)
	}
	// Coverage percentage is rounded to one decimal.
	if cov := ComputeAssetPosture(PostureInput{Total: 3, Covered: 1}).CoveragePct; cov != 33.3 {
		t.Fatalf("coverage = %v, want 33.3", cov)
	}
}

func TestRollupPostureHierarchy(t *testing.T) {
	now := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	// root(1) → sub(2) → service(3) → endpoints 4 (tested, open high) and 5 (untested)
	// root(1) → sub(6), tested, clean.
	facts := map[int64]*postureFacts{}
	mk := func(id int64, anchored bool) *postureFacts {
		f := &postureFacts{id: id, criticality: CriticalityTier2, anchored: anchored, open: map[int64]string{}, retesting: map[int64]bool{}}
		if anchored {
			f.lastAnchor = now.Add(time.Duration(id) * time.Minute)
		}
		facts[id] = f
		return f
	}
	mk(1, false)
	mk(2, true)
	mk(3, true)
	mk(4, true).open[900] = "high"
	mk(5, false)
	mk(6, true)
	parent := map[int64]int64{2: 1, 3: 2, 4: 3, 5: 3, 6: 1}
	out := rollupPosture(facts, parent)

	if got := out[4].Status; got != PostureHighExposure {
		t.Errorf("endpoint with open high = %s", got)
	}
	if got := out[5].Status; got != PostureBlindSpot {
		t.Errorf("untested endpoint = %s, want blind spot", got)
	}
	if got := out[6].Status; got != PostureValidatedClean {
		t.Errorf("tested clean subdomain = %s", got)
	}
	// Exposure rolls up to every ancestor.
	for _, id := range []int64{3, 2, 1} {
		if got := out[id].Status; got != PostureHighExposure {
			t.Errorf("ancestor %d = %s, want high_exposure", id, got)
		}
	}
	// Root subtree: 6 assets, 4 anchored.
	if got := out[1].CoveragePct; got != 66.7 {
		t.Errorf("root coverage = %v, want 66.7", got)
	}
	// last validated = newest anchor in the subtree (asset 6 at +6m).
	if want := now.Add(6 * time.Minute); !out[1].LastValidated.Equal(want) {
		t.Errorf("root last validated = %v, want %v", out[1].LastValidated, want)
	}

	// Once the finding is under an active retest it moves from exposure to pending_retest,
	// and the untested sibling still keeps the service from being "clean".
	facts[4].retesting[900] = true
	out = rollupPosture(facts, parent)
	if got := out[4].Status; got != PosturePendingRetest {
		t.Errorf("endpoint under retest = %s, want pending_retest", got)
	}
	if got := out[3].Status; got != PosturePendingRetest {
		t.Errorf("service with retest in subtree = %s, want pending_retest", got)
	}

	// Close the finding and finish the retest: the fully tested branch becomes clean,
	// the branch with the untested endpoint does not.
	delete(facts[4].open, 900)
	delete(facts[4].retesting, 900)
	out = rollupPosture(facts, parent)
	if got := out[4].Status; got != PostureValidatedClean {
		t.Errorf("fixed endpoint = %s, want validated_clean", got)
	}
	if got := out[3].Status; got != PostureBlindSpot {
		t.Errorf("service with an untested child = %s, want blind spot", got)
	}
}

func TestRollupNeverMarksUntestedClean(t *testing.T) {
	// No asset anywhere has an anchor: nothing may be validated_clean.
	facts := map[int64]*postureFacts{}
	parent := map[int64]int64{}
	for id := int64(1); id <= 20; id++ {
		facts[id] = &postureFacts{id: id, criticality: CriticalityTier1, open: map[int64]string{}, retesting: map[int64]bool{}}
		if id > 1 {
			parent[id] = (id - 1) / 2
			if parent[id] == 0 {
				parent[id] = 1
			}
		}
	}
	for id, r := range rollupPosture(facts, parent) {
		if r.Status == PostureValidatedClean {
			t.Fatalf("asset %d with no anchors marked validated_clean", id)
		}
		if r.Score > 50 {
			t.Fatalf("asset %d with no anchors scored %d (>50)", id, r.Score)
		}
	}
}

func TestRollupToleratesCycles(t *testing.T) {
	facts := map[int64]*postureFacts{
		1: {id: 1, anchored: true, open: map[int64]string{}, retesting: map[int64]bool{}},
		2: {id: 2, anchored: true, open: map[int64]string{}, retesting: map[int64]bool{}},
	}
	out := rollupPosture(facts, map[int64]int64{1: 2, 2: 1})
	if len(out) != 2 {
		t.Fatalf("got %d results", len(out))
	}
}

func TestEffectiveValidationMode(t *testing.T) {
	cases := []struct{ mode, env, crit, want string }{
		{"", "", CriticalityTier2, ""},
		{"", "staging", CriticalityTier2, ""},
		{"", "production", CriticalityTier2, ValidationReadOnly},
		{"", "", CriticalityTier1, ValidationReadOnly},
		{ValidationControlledActive, "production", CriticalityTier1, ValidationControlledActive},
		{"bogus", "development", CriticalityTier3, ""},
	}
	for _, c := range cases {
		if got := EffectiveValidationMode(c.mode, c.env, c.crit); got != c.want {
			t.Errorf("EffectiveValidationMode(%q,%q,%q) = %q, want %q", c.mode, c.env, c.crit, got, c.want)
		}
	}
}

// ── PostgreSQL integration ──────────────────────────────────────────────────

func TestPostureRollupAndMetadataPG(t *testing.T) {
	d := notifyTestDB(t)
	ctx := context.Background()
	const base = int64(7_700_000)
	cleanup := func() {
		_, _ = d.Exec(`DELETE FROM guard_audit_events WHERE target_asset_id BETWEEN $1 AND $2`, base, base+10)
		_, _ = d.Exec(`DELETE FROM assets WHERE id BETWEEN $1 AND $2`, base, base+10)
	}
	cleanup()
	t.Cleanup(cleanup)

	// Existing-style insert without any posture column: defaults must apply.
	if _, err := d.Exec(`INSERT INTO assets (id, type, domain, root_domain) VALUES
		($1,'root_domain','posture-test.example','posture-test.example'),
		($2,'subdomain','api.posture-test.example','posture-test.example')`, base, base+1); err != nil {
		t.Fatal(err)
	}
	var crit, team, status string
	var score int
	if err := d.QueryRow(`SELECT business_criticality, owner_team, posture_status, posture_score FROM assets WHERE id=$1`, base).
		Scan(&crit, &team, &status, &score); err != nil {
		t.Fatal(err)
	}
	if crit != CriticalityTier2 || team != "Unassigned" || status != PostureBlindSpot || score != 0 {
		t.Fatalf("defaults = %s/%s/%s/%d", crit, team, status, score)
	}

	if _, err := d.RollupHierarchyPosture(ctx); err != nil {
		t.Fatal(err)
	}
	det, err := d.GetAssetPosture(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	if det.Asset.PostureStatus != PostureBlindSpot {
		t.Fatalf("untested root = %s", det.Asset.PostureStatus)
	}
	if det.DownstreamTotal != 1 || det.DownstreamUntested != 1 {
		t.Fatalf("blast radius = %d/%d", det.DownstreamUntested, det.DownstreamTotal)
	}

	tier1, prod, ro := CriticalityTier1, "production", ""
	owner := "  Platform Billing "
	if err := d.UpdateAssetMetadata(ctx, base+1, AssetMetadata{BusinessCriticality: &tier1, OwnerTeam: &owner, Environment: &prod, ValidationMode: &ro}); err != nil {
		t.Fatal(err)
	}
	bad := "tier_9"
	if err := d.UpdateAssetMetadata(ctx, base+1, AssetMetadata{BusinessCriticality: &bad}); err == nil {
		t.Fatal("invalid criticality accepted")
	}
	profiles, err := d.AssetGuardProfiles(ctx, []string{"api.posture-test.example"})
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 || profiles[0].EffectiveMode != ValidationReadOnly || profiles[0].Criticality != CriticalityTier1 {
		t.Fatalf("profiles = %+v", profiles)
	}
	// Unclassified root is not returned: legacy behaviour.
	if p, _ := d.AssetGuardProfiles(ctx, []string{"posture-test.example"}); len(p) != 0 {
		t.Fatalf("unclassified asset returned: %+v", p)
	}
	assets, err := (&AssetStore{db: d}).GetByIDs([]int64{base + 1})
	if err != nil || len(assets) != 1 {
		t.Fatalf("GetByIDs: %v %d", err, len(assets))
	}
	if assets[0].OwnerTeam != "Platform Billing" || assets[0].BusinessCriticality != CriticalityTier1 || assets[0].Environment != "production" {
		t.Fatalf("asset posture fields = %+v", assets[0])
	}
}

func TestGuardAuditEventsPG(t *testing.T) {
	d := notifyTestDB(t)
	ctx := context.Background()
	t.Cleanup(func() { _, _ = d.Exec(`DELETE FROM guard_audit_events WHERE task_id = 'guard-audit-test'`) })
	if err := d.RecordGuardAuditEvent(ctx, GuardAuditEvent{TaskID: "guard-audit-test", PolicyRule: "read_only_validation", Decision: "maybe"}); err == nil {
		t.Fatal("invalid decision accepted")
	}
	if err := d.RecordGuardAuditEvent(ctx, GuardAuditEvent{Actor: "worker", TaskID: "guard-audit-test", ToolName: "WebFetch",
		Target: "api.example", Layer: 1, PolicyRule: "read_only_validation", Decision: GuardBlocked, Rationale: "POST blocked"}); err != nil {
		t.Fatal(err)
	}
	evs, err := d.ListGuardAuditEvents(ctx, GuardAuditFilter{TaskID: "guard-audit-test"})
	if err != nil || len(evs) != 1 || evs[0].Decision != GuardBlocked || evs[0].PolicyRule != "read_only_validation" {
		t.Fatalf("events = %+v err=%v", evs, err)
	}
	if _, err := d.Exec(`UPDATE guard_audit_events SET decision='allowed' WHERE task_id='guard-audit-test'`); err == nil {
		t.Fatal("audit rows must be immutable")
	}
}
