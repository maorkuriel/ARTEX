package server

// Coverage Intelligence & Blind-Spot Engine endpoints (additive).
//
//   GET    /api/coverage/summary               coverage % overall / endpoints / Tier-1, by tier,
//                                              owner team and parent domain; blind spots by reason
//   GET    /api/coverage/blind-spots           prioritized blind spots (?reason=&criticality=&owner=&company=&limit=)
//   GET    /api/assets/{id}/anchors            reverse-anchor provenance + the asset's coverage classification
//   GET    /api/coverage/policies              cadence / trigger / validation-mode policies
//   POST   /api/coverage/policies
//   DELETE /api/coverage/policies/{id}
//   POST   /api/coverage/validate-blind-spots  guardrailed validation of selected blind spots
//
// Validation never bypasses the guardrails: out-of-scope assets are rejected,
// validation runs in the asset's enforced mode (read-only for production / Tier-1
// unless a policy says otherwise), and Tier-1 assets are held for human approval
// in the regular approval queue. Every decision is written to the guard audit trail.
// With the setting coverage_simulated_validation on (demo / local mode) an allowed
// validation is executed deterministically; otherwise it is queued and the UI opens
// a prefilled, budget-bounded validation task for the operator to confirm.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/Autumn-27/artex/db"
)

const (
	coverageTTL                = 20 * time.Second
	settingCoverageSimulated   = "coverage_simulated_validation"
	coverageValidationToolName = "coverage_validation"
	maxValidateBatch           = 50
)

var (
	coverageMu   sync.Mutex
	coverageSnap *db.CoverageSnapshot
	coverageAt   time.Time
)

// coverageSnapshot returns a fresh-enough snapshot, settling approved/denied held
// requests and persisting the per-asset coverage columns on each recompute.
func (s *Server) coverageSnapshot(ctx context.Context, pg *db.DB, force bool) (*db.CoverageSnapshot, error) {
	coverageMu.Lock()
	defer coverageMu.Unlock()
	if !force && coverageSnap != nil && time.Since(coverageAt) < coverageTTL {
		return coverageSnap, nil
	}
	if settled, err := s.settleHeldValidations(ctx, pg); err != nil {
		return nil, err
	} else if settled > 0 {
		_ = s.ensurePostureRollup(ctx, pg, true)
	}
	snap, err := pg.ComputeCoverageIntelligence(ctx, time.Now())
	if err != nil {
		return nil, err
	}
	if err := pg.PersistCoverage(ctx, snap); err != nil {
		return nil, err
	}
	coverageSnap, coverageAt = snap, time.Now()
	return snap, nil
}

func companyParam(r *http.Request) int64 {
	n, _ := strconv.ParseInt(r.URL.Query().Get("company"), 10, 64)
	return n
}

func (s *Server) coverageSummary(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	snap, err := s.coverageSnapshot(r.Context(), pg, r.URL.Query().Get("refresh") == "1")
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, snap.Summary(companyParam(r)))
}

func (s *Server) coverageBlindSpots(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	snap, err := s.coverageSnapshot(r.Context(), pg, false)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	q := r.URL.Query()
	list := snap.BlindSpots(db.BlindSpotFilter{
		Reason: q.Get("reason"), Criticality: q.Get("criticality"), OwnerTeam: q.Get("owner"),
		CompanyID: companyParam(r), Limit: queryInt(r, "limit", 500),
	})
	writeJSON(w, 200, map[string]any{"blind_spots": list, "total": len(list), "computed_at": snap.Now.UTC().Format(time.RFC3339)})
}

func (s *Server) assetAnchors(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, 400, "invalid asset id")
		return
	}
	anchors, err := pg.AssetAnchors(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "asset not found")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	snap, err := s.coverageSnapshot(r.Context(), pg, false)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	cov, _ := snap.AssetCoverage(id)
	writeJSON(w, 200, map[string]any{"asset_id": id, "coverage": cov, "anchors": anchors})
}

func (s *Server) coveragePolicies(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	list, err := pg.ListCoveragePolicies(r.Context())
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"policies": list, "default_cadence_days": map[string]int{
		db.CriticalityTier1: db.DefaultCadenceDays(db.CriticalityTier1),
		db.CriticalityTier2: db.DefaultCadenceDays(db.CriticalityTier2),
		db.CriticalityTier3: db.DefaultCadenceDays(db.CriticalityTier3),
	}})
}

func (s *Server) createCoveragePolicy(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	p := db.CoveragePolicy{Enabled: true}
	if err := decode(w, r, &p); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	out, err := pg.CreateCoveragePolicy(r.Context(), p)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	_, _ = s.coverageSnapshot(r.Context(), pg, true)
	writeJSON(w, 201, out)
}

func (s *Server) deleteCoveragePolicy(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathInt(r, "id")
	if !ok {
		writeErr(w, 400, "invalid policy id")
		return
	}
	if err := pg.DeleteCoveragePolicy(r.Context(), id); errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "policy not found")
		return
	} else if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	_, _ = s.coverageSnapshot(r.Context(), pg, true)
	writeJSON(w, 200, map[string]any{"deleted": id})
}

// TaskDraft is a prefilled, budget-bounded validation task for live mode.
type TaskDraft struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Goal        string `json:"goal"`
}

// ValidationResult is the outcome for one requested asset.
type ValidationResult struct {
	db.CoverageValidationRequest
	Draft *TaskDraft `json:"task_draft,omitempty"`
}

func validationDraft(b db.BlindSpot) *TaskDraft {
	return &TaskDraft{
		Name: "Blind-spot validation: " + b.Label,
		Description: fmt.Sprintf("Scoped, budget-bounded %s of %s (%s, owner %s). Non-mutating probes only unless the asset's policy allows controlled active validation; every call passes the three-layer guardrails.",
			b.ValidationMode, b.Label, b.Type, b.OwnerTeam),
		Goal: fmt.Sprintf("Exercise %s safely, record exploration anchors for every asset touched, and attach HTTP evidence to anything confirmed.", b.Label),
	}
}

func (s *Server) simulatedValidation(pg *db.DB) bool {
	return pg.GetBool(settingCoverageSimulated, false)
}

// executeValidation runs (simulated) or queues one allowed validation.
func (s *Server) executeValidation(ctx context.Context, pg *db.DB, b db.BlindSpot, req *db.CoverageValidationRequest) (*TaskDraft, error) {
	if s.simulatedValidation(pg) {
		nodeID, err := pg.SimulateSafeValidation(ctx, b.AssetID, b.Label, b.ValidationMode)
		if err != nil {
			req.Status, req.Reason = "rejected", err.Error()
			return nil, nil
		}
		req.Status, req.Simulated, req.NodeID = "completed", true, &nodeID
		req.Reason = "Validated with non-mutating probes (simulated execution); anchors recorded"
		return nil, nil
	}
	req.Status = "queued"
	req.Reason = "Queued: confirm the prefilled, budget-bounded validation task"
	return validationDraft(b), nil
}

func (s *Server) validateBlindSpots(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	var body struct {
		AssetIDs []int64 `json:"asset_ids"`
	}
	if err := decode(w, r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	seen := map[int64]bool{}
	ids := []int64{}
	for _, id := range body.AssetIDs {
		if id > 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || len(ids) > maxValidateBatch {
		writeErr(w, 400, fmt.Sprintf("asset_ids must hold 1-%d asset ids", maxValidateBatch))
		return
	}
	ctx := r.Context()
	snap, err := s.coverageSnapshot(ctx, pg, true)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	results := make([]ValidationResult, 0, len(ids))
	changed := false
	for _, id := range ids {
		b, ok := snap.AssetCoverage(id)
		res := ValidationResult{CoverageValidationRequest: db.CoverageValidationRequest{AssetID: id, Label: b.Label, ValidationMode: b.ValidationMode}}
		if !ok {
			res.Status, res.Reason = "rejected", "asset not found"
			results = append(results, res)
			continue
		}
		assetID := id
		audit := func(layer int, rule, decision, why string) {
			_ = pg.RecordGuardAuditEvent(context.WithoutCancel(ctx), db.GuardAuditEvent{
				Actor: "coverage-engine", ToolName: coverageValidationToolName, Target: b.Label,
				TargetAssetID: &assetID, Layer: layer, PolicyRule: rule, Decision: decision, Rationale: why})
		}
		switch {
		case b.CoverageState == db.CoverageOutOfScope:
			res.Status, res.Reason = "rejected", "Out of scope: a scope rule or the asset blocklist excludes this asset"
			audit(1, "scope_rule", db.GuardBlocked, res.Reason)
		case b.Reason == db.ReasonAwaitApproval:
			res.Status, res.Reason = "rejected", "Already waiting on a guard approval for this asset; decide it in Approvals"
		case b.Reason == db.ReasonAuthWAF:
			res.Status, res.Reason = "rejected", "Blocked by auth/WAF: configure an auth profile or WAF allow-list before re-validating"
		case b.NeedsApproval:
			input, _ := json.Marshal(map[string]any{"asset_id": id, "target": b.Label, "validation_mode": b.ValidationMode,
				"reason": "blind-spot validation requested from Coverage Status"})
			why := fmt.Sprintf("%s is a Tier-1 crown-jewel asset: a human must approve validation against it (%s)", b.Label, b.ValidationMode)
			pid, err := pg.CreateInterceptPending(0, 0, "", "coverage-engine", coverageValidationToolName, input, why)
			if err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			res.Status, res.Reason, res.PendingID = "held_for_approval", why, &pid
			audit(3, "tier_1_crown_jewel_approval", db.GuardHeldForApproval, why)
		default:
			draft, err := s.executeValidation(ctx, pg, b, &res.CoverageValidationRequest)
			if err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			res.Draft = draft
			if res.Status != "rejected" {
				audit(1, "classified_target", db.GuardAllowed, fmt.Sprintf("blind-spot validation within the asset's %s policy", b.ValidationMode))
				changed = changed || res.Status == "completed"
			}
		}
		if err := pg.InsertCoverageRequest(ctx, &res.CoverageValidationRequest, "operator"); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		results = append(results, res)
	}
	if changed {
		_ = s.ensurePostureRollup(ctx, pg, true)
	}
	_, _ = s.coverageSnapshot(ctx, pg, true)
	writeJSON(w, 200, map[string]any{"results": results, "simulated": s.simulatedValidation(pg)})
}

// settleHeldValidations executes approved held requests and closes denied ones.
func (s *Server) settleHeldValidations(ctx context.Context, pg *db.DB) (int, error) {
	held, err := pg.HeldCoverageRequests(ctx)
	if err != nil || len(held) == 0 {
		return 0, err
	}
	var snap *db.CoverageSnapshot
	settled := 0
	for _, h := range held {
		switch h.Pending {
		case "pending":
			continue
		case "allowed":
			if snap == nil {
				if snap, err = pg.ComputeCoverageIntelligence(ctx, time.Now()); err != nil {
					return settled, err
				}
			}
			b, ok := snap.AssetCoverage(h.AssetID)
			if !ok {
				continue
			}
			req := db.CoverageValidationRequest{AssetID: h.AssetID, ValidationMode: h.Mode}
			if _, err := s.executeValidation(ctx, pg, b, &req); err != nil {
				return settled, err
			}
			assetID := h.AssetID
			_ = pg.RecordGuardAuditEvent(ctx, db.GuardAuditEvent{Actor: "coverage-engine", ToolName: coverageValidationToolName,
				Target: b.Label, TargetAssetID: &assetID, Layer: 3, PolicyRule: "tier_1_crown_jewel_approval",
				Decision: db.GuardApproved, Rationale: "approved in the approval queue; " + req.Reason})
			if err := pg.UpdateCoverageRequest(ctx, h.ID, req.Status, req.Reason, req.NodeID); err != nil {
				return settled, err
			}
		default: // denied / timeout
			if err := pg.UpdateCoverageRequest(ctx, h.ID, "denied", "approval "+h.Pending, nil); err != nil {
				return settled, err
			}
		}
		settled++
	}
	return settled, nil
}
