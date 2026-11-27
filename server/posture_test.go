package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Autumn-27/artex/db"
)

func postureTestServer(t *testing.T) (*Server, *db.DB) {
	t.Helper()
	dsn, _, err := db.DSN()
	if err != nil {
		db.SkipPGUnavailable(t, err)
	}
	pg, err := db.Open(dsn)
	if err != nil {
		db.SkipPGUnavailable(t, err)
	}
	t.Cleanup(func() { pg.Close() })
	return &Server{m: &Manager{pg: pg}}, pg
}

func TestPostureEndpointsPG(t *testing.T) {
	s, pg := postureTestServer(t)
	const id = int64(7_720_001)
	cleanup := func() { _, _ = pg.Exec(`DELETE FROM assets WHERE id = $1`, id) }
	cleanup()
	t.Cleanup(cleanup)
	if _, err := pg.Exec(`INSERT INTO assets (id, type, domain, root_domain) VALUES ($1,'root_domain','posture-api.example','posture-api.example')`, id); err != nil {
		t.Fatal(err)
	}

	// Summary.
	rec := httptest.NewRecorder()
	s.postureSummary(rec, httptest.NewRequest(http.MethodGet, "/api/posture/summary?refresh=1", nil))
	if rec.Code != 200 {
		t.Fatalf("summary %d: %s", rec.Code, rec.Body.String())
	}
	var sum db.PostureSummary
	if err := json.Unmarshal(rec.Body.Bytes(), &sum); err != nil {
		t.Fatal(err)
	}
	if sum.AssetTotal < 1 || sum.ByStatus[db.PostureBlindSpot] < 1 {
		t.Fatalf("summary = %+v", sum)
	}

	// Metadata: invalid value → 400, unknown asset → 404, valid → 200 with recomputed posture.
	patch := func(assetID string, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPatch, "/api/assets/"+assetID+"/metadata", strings.NewReader(body))
		req.SetPathValue("id", assetID)
		s.assetMetadata(rec, req)
		return rec
	}
	if rec := patch("7720001", `{"business_criticality":"tier_0"}`); rec.Code != 400 {
		t.Fatalf("invalid criticality: %d", rec.Code)
	}
	if rec := patch("7720999", `{"owner_team":"x"}`); rec.Code != 404 {
		t.Fatalf("unknown asset: %d", rec.Code)
	}
	rec = patch("7720001", `{"business_criticality":"tier_1_crown_jewel","owner_team":"Core Identity","environment":"production"}`)
	if rec.Code != 200 {
		t.Fatalf("patch %d: %s", rec.Code, rec.Body.String())
	}
	var det db.AssetPostureDetail
	if err := json.Unmarshal(rec.Body.Bytes(), &det); err != nil {
		t.Fatal(err)
	}
	if det.Asset.BusinessCriticality != db.CriticalityTier1 || det.Asset.OwnerTeam != "Core Identity" ||
		det.EffectiveValidationMode != db.ValidationReadOnly || det.Asset.PostureStatus != db.PostureBlindSpot {
		t.Fatalf("detail = %+v", det)
	}

	// Posture detail and a 404.
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/assets/7720999/posture", nil)
	req.SetPathValue("id", "7720999")
	s.assetPosture(rec, req)
	if rec.Code != 404 {
		t.Fatalf("missing asset posture: %d", rec.Code)
	}

	// Guard audit endpoint answers with the documented shape.
	rec = httptest.NewRecorder()
	s.guardAudit(rec, httptest.NewRequest(http.MethodGet, "/api/guards/audit?limit=5", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"events"`) {
		t.Fatalf("guard audit %d: %s", rec.Code, rec.Body.String())
	}
}

// Without PostgreSQL the new endpoints answer 503 like every other management route,
// and the budget endpoint degrades to an empty state.
func TestPostureEndpointsWithoutPG(t *testing.T) {
	s := &Server{m: &Manager{}}
	rec := httptest.NewRecorder()
	s.postureSummary(rec, httptest.NewRequest(http.MethodGet, "/api/posture/summary", nil))
	if rec.Code != 503 {
		t.Fatalf("summary without pg: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	s.guardBudgets(rec, httptest.NewRequest(http.MethodGet, "/api/guards/budgets", nil))
	if rec.Code != 200 {
		t.Fatalf("budgets without interceptor: %d", rec.Code)
	}
}
