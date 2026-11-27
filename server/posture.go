package server

// Asset-centric posture and guardrail endpoints (additive; existing routes unchanged).
//
//   GET   /api/posture/summary         overall posture, status counts, Tier-1 exposure,
//                                      coverage, pending approvals, retests awaiting verification
//   POST  /api/posture/recompute       force a hierarchy rollup
//   GET   /api/assets/{id}/posture     one asset: posture, blast radius, findings, anchors,
//                                      recommendations, recent guard decisions
//   PATCH /api/assets/{id}/metadata    business_criticality / owner_team / environment /
//                                      validation_mode, then recompute
//   GET   /api/guards/audit            structured guard audit trail
//   GET   /api/guards/budgets          per-task, per-host request budget state

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/Autumn-27/artex/db"
)

// postureRollupTTL bounds how often reads trigger a full hierarchy rollup.
const postureRollupTTL = 20 * time.Second

var (
	postureRollupMu   sync.Mutex
	postureRolledUpAt time.Time
)

func (s *Server) ensurePostureRollup(ctx context.Context, pg *db.DB, force bool) error {
	postureRollupMu.Lock()
	defer postureRollupMu.Unlock()
	if !force && time.Since(postureRolledUpAt) < postureRollupTTL {
		// Within the TTL, still recompute when some asset was never rolled up
		// (newly discovered, or just re-seeded).
		var stale bool
		if err := pg.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM assets WHERE posture_computed_at IS NULL)`).Scan(&stale); err != nil || !stale {
			return err
		}
	}
	if _, err := pg.RollupHierarchyPosture(ctx); err != nil {
		return err
	}
	postureRolledUpAt = time.Now()
	return nil
}

func (s *Server) postureSummary(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	if err := s.ensurePostureRollup(r.Context(), pg, r.URL.Query().Get("refresh") == "1"); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	var company int64
	if v := r.URL.Query().Get("company"); v != "" {
		company, _ = strconv.ParseInt(v, 10, 64)
	}
	sum, err := pg.PostureSummary(r.Context(), company)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, sum)
}

func (s *Server) postureRecompute(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	if err := s.ensurePostureRollup(r.Context(), pg, true); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) assetPosture(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, 400, "invalid asset id")
		return
	}
	det, err := pg.GetAssetPosture(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "asset not found")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, det)
}

func (s *Server) assetMetadata(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, 400, "invalid asset id")
		return
	}
	var req db.AssetMetadata
	if err := decode(w, r, &req); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	err := pg.UpdateAssetMetadata(r.Context(), id, req)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "asset not found")
		return
	}
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := s.ensurePostureRollup(r.Context(), pg, true); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	det, err := pg.GetAssetPosture(r.Context(), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, det)
}

func (s *Server) guardAudit(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	q := r.URL.Query()
	f := db.GuardAuditFilter{TaskID: q.Get("task"), Decision: q.Get("decision"), Limit: queryInt(r, "limit", 100)}
	if v := q.Get("asset"); v != "" {
		f.AssetID, _ = strconv.ParseInt(v, 10, 64)
	}
	f.Layer = queryInt(r, "layer", 0)
	events, err := pg.ListGuardAuditEvents(r.Context(), f)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	counts, err := pg.GuardAuditCounts(r.Context(), time.Now().Add(-30*24*time.Hour))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"events": events, "counts_30d": counts})
}

func (s *Server) guardBudgets(w http.ResponseWriter, r *http.Request) {
	if s.m == nil || s.m.interceptor == nil {
		writeJSON(w, 200, map[string]any{"budget": 0, "hosts": []any{}})
		return
	}
	writeJSON(w, 200, map[string]any{
		"budget": s.m.interceptor.HostRequestBudget(),
		"hosts":  s.m.interceptor.BudgetState(),
	})
}
