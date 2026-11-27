package db

import (
	"context"
	"testing"
	"time"
)

var covNow = time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)

func cf(id int64, crit string) *CoverageFacts { return &CoverageFacts{ID: id, Criticality: crit} }

func TestClassifyAssetBlindSpotsReasons(t *testing.T) {
	facts := map[int64]*CoverageFacts{
		1: cf(1, CriticalityTier2), // never tested
		2: cf(2, CriticalityTier1), // out of scope (even if it had anchors)
		3: cf(3, CriticalityTier1), // awaiting approval
		4: cf(4, CriticalityTier2), // auth / WAF
		5: cf(5, CriticalityTier2), // budget (self)
		6: cf(6, CriticalityTier1), // stale: tier-1 default cadence 7d, validated 10d ago
		7: cf(7, CriticalityTier3), // fresh: tier-3 default cadence 30d, validated 10d ago
		8: cf(8, CriticalityTier2), // child of 5 → inherits budget exhaustion
	}
	facts[2].OutOfScope, facts[2].ValidationAnchors, facts[2].LastValidated = true, 3, covNow
	facts[3].AwaitingApproval = true
	facts[3].BlockedAuthWAF = true // approval outranks auth/WAF
	facts[4].BlockedAuthWAF = true
	facts[5].BudgetExhausted = true
	facts[6].ValidationAnchors, facts[6].LastValidated = 2, covNow.Add(-10*24*time.Hour)
	facts[7].ValidationAnchors, facts[7].LastValidated = 1, covNow.Add(-10*24*time.Hour)
	out := ClassifyAssetBlindSpots(facts, map[int64]int64{8: 5}, covNow)

	want := map[int64][2]string{
		1: {CoverageBlindSpot, ReasonNeverTested},
		2: {CoverageOutOfScope, ReasonOutOfScope},
		3: {CoverageBlindSpot, ReasonAwaitApproval},
		4: {CoverageBlindSpot, ReasonAuthWAF},
		5: {CoverageBlindSpot, ReasonBudget},
		6: {CoverageStale, ReasonCadence},
		7: {CoverageValidated, ""},
		8: {CoverageBlindSpot, ReasonBudget},
	}
	for id, w := range want {
		if got := out[id]; got.State != w[0] || got.Reason != w[1] {
			t.Errorf("asset %d = %s/%s, want %s/%s", id, got.State, got.Reason, w[0], w[1])
		}
	}
	if due := out[6].DueAt; !due.Equal(covNow.Add(-3 * 24 * time.Hour)) {
		t.Errorf("stale due = %v", due)
	}
	if due := out[7].DueAt; !due.Equal(covNow.Add(20 * 24 * time.Hour)) {
		t.Errorf("fresh due = %v", due)
	}
}

func TestClassifyHierarchyPartialAndOutOfScopeChildren(t *testing.T) {
	// root(1) → api(2, validated) → endpoints 3 (validated), 4 (never tested), 5 (out of scope)
	facts := map[int64]*CoverageFacts{}
	for id := int64(1); id <= 5; id++ {
		facts[id] = cf(id, CriticalityTier2)
	}
	for _, id := range []int64{2, 3} {
		facts[id].ValidationAnchors, facts[id].LastValidated = 1, covNow
	}
	facts[5].OutOfScope = true
	parent := map[int64]int64{2: 1, 3: 2, 4: 2, 5: 2}
	out := ClassifyAssetBlindSpots(facts, parent, covNow)
	if out[1].State != CoveragePartial || out[1].Reason != "" {
		t.Errorf("root without own anchors but validated children = %+v", out[1])
	}
	if out[2].State != CoveragePartial {
		t.Errorf("validated parent with an untested child = %s", out[2].State)
	}
	if out[4].State != CoverageBlindSpot || out[4].Reason != ReasonNeverTested {
		t.Errorf("untested endpoint = %+v", out[4])
	}
	// Once 4 is validated, the out-of-scope sibling must not keep the parent partial.
	facts[4].ValidationAnchors, facts[4].LastValidated = 1, covNow
	out = ClassifyAssetBlindSpots(facts, parent, covNow)
	if out[2].State != CoverageValidated {
		t.Errorf("parent with all in-scope children validated = %s", out[2].State)
	}
}

func TestEffectivePolicyAndCadence(t *testing.T) {
	ps := []CoveragePolicy{
		{ID: 1, Name: "Tier 1", BusinessCriticality: CriticalityTier1, CadenceDays: 7, Enabled: true, ValidationMode: ValidationReadOnly},
		{ID: 2, Name: "acme demo", ScopePattern: "acme.demo.local", CadenceDays: 10, Enabled: true, ValidationMode: ValidationReadOnly},
		{ID: 3, Name: "acme tier1", BusinessCriticality: CriticalityTier1, ScopePattern: "acme.demo.local", CadenceDays: 3, Enabled: true},
		{ID: 4, Name: "disabled", CadenceDays: 1, Enabled: false},
	}
	if p, _ := EffectivePolicy(ps, CriticalityTier1, []string{"api.acme.demo.local"}); p.ID != 3 {
		t.Errorf("tier1 acme = policy %d, want 3", p.ID)
	}
	if p, _ := EffectivePolicy(ps, CriticalityTier2, []string{"api.acme.demo.local"}); p.ID != 2 {
		t.Errorf("tier2 acme = policy %d, want 2", p.ID)
	}
	if p, _ := EffectivePolicy(ps, CriticalityTier1, []string{"other.example"}); p.ID != 1 {
		t.Errorf("tier1 elsewhere = policy %d, want 1", p.ID)
	}
	if _, ok := EffectivePolicy(ps, CriticalityTier3, []string{"other.example"}); ok {
		t.Error("tier3 elsewhere matched a policy")
	}
	if DefaultCadenceDays(CriticalityTier1) != 7 || DefaultCadenceDays(CriticalityTier2) != 14 || DefaultCadenceDays(CriticalityTier3) != 30 {
		t.Error("default cadences changed")
	}
	bad := CoveragePolicy{Name: "x", CadenceDays: 7, Triggers: []string{"on_full_moon"}}
	if err := bad.Validate(); err == nil {
		t.Error("unknown trigger accepted")
	}
	ok := CoveragePolicy{Name: " x ", CadenceDays: 7, ScopePattern: "*.Acme.Demo.Local",
		Triggers: []string{TriggerCadence, TriggerCadence}}
	if err := ok.Validate(); err != nil || ok.ScopePattern != "acme.demo.local" || ok.ValidationMode != ValidationReadOnly || len(ok.Triggers) != 1 {
		t.Errorf("normalize = %+v err=%v", ok, err)
	}
}

func TestSummaryBuckets(t *testing.T) {
	var b CoverageBucket
	for _, s := range []string{CoverageValidated, CoverageValidated, CoverageBlindSpot, CoverageStale, CoverageOutOfScope} {
		b.add(s)
	}
	b.finish()
	if b.InScope != 4 || b.Validated != 2 || b.Pct != 50 {
		t.Fatalf("bucket = %+v", b)
	}
}

func TestIsValidationAnchor(t *testing.T) {
	cases := map[[2]string]bool{
		{"fact", "confirmed"}: true, {"finding", "confirmed"}: true, {"intent", "done"}: true,
		{"intent", "exhausted"}: false, {"intent", "running"}: false, {"hint", "active"}: false, {"fact", "dismissed"}: false,
	}
	for k, want := range cases {
		if IsValidationAnchor(k[0], k[1]) != want {
			t.Errorf("IsValidationAnchor(%s,%s) != %v", k[0], k[1], want)
		}
	}
}

// End to end against PostgreSQL: every reason is derived from real rows.
func TestCoverageIntelligencePG(t *testing.T) {
	d := notifyTestDB(t)
	ctx := context.Background()
	const base = int64(7_730_000)
	cleanup := func() {
		_, _ = d.Exec(`DELETE FROM intercept_pending WHERE agent_name = 'coverage-test'`)
		_, _ = d.Exec(`DELETE FROM intercept_rules WHERE name = 'coverage-test deny'`)
		_, _ = d.Exec(`DELETE FROM coverage_ledger WHERE surface LIKE '%cov-test.example%'`)
		_, _ = d.Exec(`DELETE FROM coverage_policies WHERE name LIKE 'coverage-test%'`)
		_, _ = d.Exec(`DELETE FROM tasks WHERE id = $1`, base)
		_, _ = d.Exec(`DELETE FROM explorations WHERE id = $1`, base)
		_, _ = d.Exec(`DELETE FROM assets WHERE id BETWEEN $1 AND $2`, base, base+20)
	}
	cleanup()
	t.Cleanup(cleanup)
	mustExec := func(q string, args ...any) {
		t.Helper()
		if _, err := d.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	mustExec(`INSERT INTO explorations (id, goal) VALUES ($1, 'coverage test')`, base)
	mustExec(`INSERT INTO tasks (id, description, goal, exploration_id) VALUES ($1, 'coverage test', 'g', $1)`, base)
	mustExec(`INSERT INTO assets (id, type, domain, root_domain, task_ids, business_criticality) VALUES
		($1,'root_domain','cov-test.example','cov-test.example','{}','tier_2_business'),
		($2,'subdomain','api.cov-test.example','cov-test.example',ARRAY[$1::bigint],'tier_1_crown_jewel'),
		($3,'subdomain','prod-db.cov-test.example','cov-test.example','{}','tier_1_crown_jewel'),
		($4,'subdomain','new.cov-test.example','cov-test.example','{}','tier_3_standard'),
		($5,'subdomain','sso.cov-test.example','cov-test.example','{}','tier_2_business'),
		($6,'subdomain','old.cov-test.example','cov-test.example',ARRAY[$1::bigint],'tier_1_crown_jewel')`,
		base, base+1, base+2, base+3, base+4, base+5)
	// api: validated now; old: validated 20 days ago (tier-1 cadence 7d → stale).
	mustExec(`INSERT INTO exploration_nodes (id, exploration_id, kind, payload, state, created_at) VALUES
		($1, $3, 'fact', '{"summary":"api ok"}', 'confirmed', now()),
		($2, $3, 'fact', '{"summary":"old ok"}', 'confirmed', now() - interval '20 days')`, base+10, base+11, base)
	mustExec(`INSERT INTO exploration_anchors (node_id, asset_id) VALUES ($1,$2),($3,$4)`, base+10, base+1, base+11, base+5)
	mustExec(`INSERT INTO intercept_rules (name, enabled, priority, match_target, match_type, pattern, action)
		VALUES ('coverage-test deny', true, 1, 'tool_input', 'string', 'prod-db.cov-test.example', 'deny')`)
	if _, err := d.CreateInterceptPending(0, 0, "", "coverage-test", "WebFetch",
		[]byte(`{"url":"https://sso.cov-test.example/login","method":"GET"}`), "tier-1 approval"); err != nil {
		t.Fatal(err)
	}
	mustExec(`INSERT INTO coverage_ledger (task_id, surface, risk_area, outcome, reason)
		VALUES ($1, 'https://new.cov-test.example/', 'access control', 'needs_follow_up', 'HTTP 403 from WAF; no valid credentials')`, base)

	snap, err := d.ComputeCoverageIntelligence(ctx, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	want := map[int64][2]string{
		base:     {CoveragePartial, ""},
		base + 1: {CoverageValidated, ""},
		base + 2: {CoverageOutOfScope, ReasonOutOfScope},
		base + 3: {CoverageBlindSpot, ReasonAuthWAF},
		base + 4: {CoverageBlindSpot, ReasonAwaitApproval},
		base + 5: {CoverageStale, ReasonCadence},
	}
	for id, w := range want {
		if got := snap.Results[id]; got.State != w[0] || got.Reason != w[1] {
			t.Errorf("asset %d = %s/%s, want %s/%s", id, got.State, got.Reason, w[0], w[1])
		}
	}
	if err := d.PersistCoverage(ctx, snap); err != nil {
		t.Fatal(err)
	}
	var state, reason string
	var cadence, anchors int
	if err := d.QueryRow(`SELECT coverage_state, COALESCE(blind_spot_reason,''), validation_cadence_days, anchor_count FROM assets WHERE id=$1`, base+5).
		Scan(&state, &reason, &cadence, &anchors); err != nil {
		t.Fatal(err)
	}
	if state != CoverageStale || reason != ReasonCadence || cadence != 7 || anchors != 1 {
		t.Fatalf("persisted = %s/%s/%d/%d", state, reason, cadence, anchors)
	}

	// A scoped policy lengthens the cadence: old is no longer stale.
	if _, err := d.CreateCoveragePolicy(ctx, CoveragePolicy{Name: "coverage-test tier1", BusinessCriticality: CriticalityTier1,
		ScopePattern: "cov-test.example", CadenceDays: 30, Triggers: []string{TriggerCadence}, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	snap, err = d.ComputeCoverageIntelligence(ctx, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if got := snap.Results[base+5]; got.State != CoverageValidated {
		t.Errorf("with a 30-day policy, old = %s", got.State)
	}

	// Simulated safe validation anchors the never-validated asset linked to the task.
	if _, err := d.SimulateSafeValidation(ctx, base+3, "new.cov-test.example", ValidationReadOnly); err == nil {
		t.Error("simulation on an asset with no engagement should fail")
	}
	mustExec(`UPDATE assets SET task_ids = ARRAY[$1::bigint] WHERE id = $2`, base, base+3)
	if _, err := d.SimulateSafeValidation(ctx, base+3, "new.cov-test.example", ValidationReadOnly); err != nil {
		t.Fatal(err)
	}
	prov, err := d.AssetAnchors(ctx, base+3)
	if err != nil || len(prov) != 2 || !prov[0].Validation || prov[0].TaskID != base {
		t.Fatalf("provenance = %+v err=%v", prov, err)
	}
	snap, _ = d.ComputeCoverageIntelligence(ctx, time.Now())
	if got := snap.Results[base+3]; got.State != CoverageValidated {
		t.Errorf("after simulated validation = %s/%s", got.State, got.Reason)
	}
	sum := snap.Summary(0)
	if sum.Overall.InScope == 0 || sum.Tier1.InScope == 0 {
		t.Errorf("summary = %+v", sum.Overall)
	}
	if _, err := d.AssetAnchors(ctx, base+19); err == nil {
		t.Error("anchors of a missing asset should be ErrNoRows")
	}
}

func TestEvidenceMatchingIsPathScoped(t *testing.T) {
	host := &coverageAsset{hosts: []string{"portal.acme.demo.local"}}
	ep := &coverageAsset{hosts: []string{"portal.acme.demo.local"}, urlPrefix: urlPrefixOf("https://portal.acme.demo.local/internal/export")}
	export := "https://portal.acme.demo.local/internal/export HTTP 403 from the WAF"
	if host.matchesEvidence(export) {
		t.Error("a 403 on one endpoint marked the whole host")
	}
	if !ep.matchesEvidence(export) {
		t.Error("the endpoint itself was not matched")
	}
	if !host.matchesEvidence(`{"url":"https://portal.acme.demo.local/"}`) {
		t.Error("host-level evidence not matched")
	}
	if !host.matchesEvidence(`{"command":"nmap -sV portal.acme.demo.local"}`) {
		t.Error("bare host in a command not matched")
	}
	tmpl := &coverageAsset{hosts: []string{"api.acme.demo.local"}, urlPrefix: urlPrefixOf("https://api.acme.demo.local/api/v2/invoices/{id}")}
	if !tmpl.matchesEvidence(`{"url":"https://api.acme.demo.local/api/v2/invoices/1002"}`) {
		t.Error("templated endpoint did not match a concrete request")
	}
}
