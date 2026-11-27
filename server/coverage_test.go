package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Autumn-27/artex/db"
)

// Guardrailed blind-spot validation: out-of-scope is rejected, Tier-1 is held in
// the approval queue and only runs after approval, other assets run directly
// (simulated mode), and every decision lands in the guard audit trail.
func TestValidateBlindSpotsGuardrailsPG(t *testing.T) {
	s, pg := postureTestServer(t)
	const base = int64(7_740_000)
	prevSim, hadSim, _ := pg.GetSetting(settingCoverageSimulated)
	cleanup := func() {
		_, _ = pg.Exec(`DELETE FROM guard_audit_events WHERE target_asset_id BETWEEN $1 AND $2`, base, base+10)
		_, _ = pg.Exec(`DELETE FROM intercept_pending WHERE agent_name = 'coverage-engine' AND tool_input->>'target' LIKE '%val-test.example%'`)
		_, _ = pg.Exec(`DELETE FROM intercept_rules WHERE name = 'val-test deny'`)
		_, _ = pg.Exec(`DELETE FROM tasks WHERE id = $1`, base)
		_, _ = pg.Exec(`DELETE FROM explorations WHERE id = $1`, base)
		_, _ = pg.Exec(`DELETE FROM assets WHERE id BETWEEN $1 AND $2`, base, base+10)
	}
	cleanup()
	t.Cleanup(func() {
		cleanup()
		if hadSim {
			_ = pg.SetSetting(settingCoverageSimulated, prevSim)
		} else {
			_, _ = pg.Exec(`DELETE FROM settings WHERE key = $1`, settingCoverageSimulated)
		}
	})
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pg.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO explorations (id, goal) VALUES ($1, 'validation test')`, base)
	exec(`INSERT INTO tasks (id, description, goal, exploration_id) VALUES ($1, 'validation test', 'g', $1)`, base)
	exec(`INSERT INTO assets (id, type, domain, root_domain, task_ids, business_criticality) VALUES
		($1,'subdomain','web.val-test.example','val-test.example',ARRAY[$4::bigint],'tier_2_business'),
		($2,'subdomain','crown.val-test.example','val-test.example',ARRAY[$4::bigint],'tier_1_crown_jewel'),
		($3,'subdomain','prod-db.val-test.example','val-test.example',ARRAY[$4::bigint],'tier_2_business')`,
		base+1, base+2, base+3, base)
	exec(`INSERT INTO intercept_rules (name, enabled, priority, match_target, match_type, pattern, action)
		VALUES ('val-test deny', true, 1, 'tool_input', 'string', 'prod-db.val-test.example', 'deny')`)
	if err := pg.SetSetting(settingCoverageSimulated, "true"); err != nil {
		t.Fatal(err)
	}

	call := func(body string) map[string]any {
		t.Helper()
		rec := httptest.NewRecorder()
		s.validateBlindSpots(rec, httptest.NewRequest(http.MethodPost, "/api/coverage/validate-blind-spots", strings.NewReader(body)))
		if rec.Code != 200 {
			t.Fatalf("validate %d: %s", rec.Code, rec.Body.String())
		}
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	statusOf := func(out map[string]any) map[float64]map[string]any {
		m := map[float64]map[string]any{}
		for _, r := range out["results"].([]any) {
			row := r.(map[string]any)
			m[row["asset_id"].(float64)] = row
		}
		return m
	}

	// Bad requests.
	rec := httptest.NewRecorder()
	s.validateBlindSpots(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"asset_ids":[]}`)))
	if rec.Code != 400 {
		t.Fatalf("empty ids: %d", rec.Code)
	}

	res := statusOf(call(`{"asset_ids":[7740001,7740002,7740003]}`))
	if res[float64(base+1)]["status"] != "completed" {
		t.Errorf("tier-2 asset = %v", res[float64(base+1)])
	}
	if res[float64(base+2)]["status"] != "held_for_approval" || res[float64(base+2)]["pending_id"] == nil {
		t.Errorf("tier-1 asset = %v", res[float64(base+2)])
	}
	if res[float64(base+3)]["status"] != "rejected" {
		t.Errorf("out-of-scope asset = %v", res[float64(base+3)])
	}

	// The Tier-1 asset is still a blind spot (not validated before approval).
	snap, err := s.coverageSnapshot(t.Context(), pg, true)
	if err != nil {
		t.Fatal(err)
	}
	if st := snap.Results[base+2].State; st == db.CoverageValidated {
		t.Fatal("tier-1 asset validated before approval")
	}
	if st := snap.Results[base+1].State; st != db.CoverageValidated {
		t.Fatalf("tier-2 asset after validation = %s", st)
	}

	// Approve in the approval queue → the next coverage read executes it.
	pid := int64(res[float64(base+2)]["pending_id"].(float64))
	if _, err := pg.ResolveIntercept(pid, "allowed", "allow", "approved in test", "human"); err != nil {
		t.Fatal(err)
	}
	snap, err = s.coverageSnapshot(t.Context(), pg, true)
	if err != nil {
		t.Fatal(err)
	}
	if st := snap.Results[base+2].State; st != db.CoverageValidated {
		t.Fatalf("tier-1 asset after approval = %s", st)
	}

	evs, err := pg.ListGuardAuditEvents(t.Context(), db.GuardAuditFilter{AssetID: base + 2})
	if err != nil {
		t.Fatal(err)
	}
	decisions := map[string]bool{}
	for _, e := range evs {
		decisions[e.Decision] = true
	}
	if !decisions[db.GuardHeldForApproval] || !decisions[db.GuardApproved] {
		t.Fatalf("tier-1 audit = %+v", evs)
	}
	if evs, _ := pg.ListGuardAuditEvents(t.Context(), db.GuardAuditFilter{AssetID: base + 3}); len(evs) != 1 || evs[0].Decision != db.GuardBlocked {
		t.Fatalf("out-of-scope audit = %+v", evs)
	}

	// Read endpoints answer.
	for _, path := range []string{"/api/coverage/summary", "/api/coverage/blind-spots?reason=never_tested"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if strings.Contains(path, "summary") {
			s.coverageSummary(rec, req)
		} else {
			s.coverageBlindSpots(rec, req)
		}
		if rec.Code != 200 {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/assets/7740001/anchors", nil)
	req.SetPathValue("id", "7740001")
	s.assetAnchors(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"counts_as_validation":true`) {
		t.Fatalf("anchors: %d %s", rec.Code, rec.Body.String())
	}
	// Policies: invalid → 400, valid → 201.
	rec = httptest.NewRecorder()
	s.createCoveragePolicy(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"x","cadence_days":0}`)))
	if rec.Code != 400 {
		t.Fatalf("invalid policy: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	s.createCoveragePolicy(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(
		`{"name":"val-test policy","business_criticality":"tier_3_standard","scope_pattern":"val-test.example","cadence_days":45,"triggers":["on_cadence_expired"]}`)))
	if rec.Code != 201 {
		t.Fatalf("create policy: %d %s", rec.Code, rec.Body.String())
	}
	_, _ = pg.Exec(`DELETE FROM coverage_policies WHERE name = 'val-test policy'`)
}
