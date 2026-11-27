package db

// Asset-centric posture spine (VMDR / CTEM).
//
// Every canonical asset carries business context (criticality, owner team,
// environment, validation mode) and a rolled-up posture: a status, a 0–100
// score, the share of its subtree that was actually validated, and when it was
// last validated. The rollup walks the asset hierarchy
// (endpoint → service → subdomain/ip → root_domain, the same parent rules as the
// findings asset tree) and aggregates child findings, exploration_anchors and
// retests upward.
//
// Rules (deterministic, see ComputeAssetPosture):
//   - an open critical finding in the subtree        → critical_exposure
//   - an open high/medium finding in the subtree     → high_exposure
//   - an active retest in the subtree                → pending_retest
//   - every asset in the subtree anchored, none open → validated_clean
//   - anything else (any untested asset)             → unvalidated_blind_spot
//
// An asset with zero exploration_anchors is never reported as validated_clean.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Business criticality tiers.
const (
	CriticalityTier1 = "tier_1_crown_jewel"
	CriticalityTier2 = "tier_2_business"
	CriticalityTier3 = "tier_3_standard"
)

// Posture statuses.
const (
	PostureCriticalExposure = "critical_exposure"
	PostureHighExposure     = "high_exposure"
	PostureValidatedClean   = "validated_clean"
	PostureBlindSpot        = "unvalidated_blind_spot"
	PosturePendingRetest    = "pending_retest"
)

// Validation modes (guardrail Layer 1).
const (
	ValidationReadOnly         = "read_only_validation"
	ValidationControlledActive = "controlled_active_validation"
)

var (
	validCriticality = map[string]bool{CriticalityTier1: true, CriticalityTier2: true, CriticalityTier3: true}
	validEnvironment = map[string]bool{"production": true, "staging": true, "development": true}
	validMode        = map[string]bool{ValidationReadOnly: true, ValidationControlledActive: true}
)

// ValidCriticality reports whether s is a known criticality tier.
func ValidCriticality(s string) bool { return validCriticality[s] }

// ValidEnvironment reports whether s is a known environment ("" = undeclared is also accepted by callers).
func ValidEnvironment(s string) bool { return validEnvironment[s] }

// ValidValidationMode reports whether s is a known validation mode.
func ValidValidationMode(s string) bool { return validMode[s] }

// EffectiveValidationMode resolves an asset's validation mode. An explicit mode
// wins; otherwise production and Tier-1 assets default to read-only validation;
// anything else returns "" (legacy behaviour: only the existing rules apply), so
// assets nobody classified keep working exactly as before.
func EffectiveValidationMode(mode, environment, criticality string) string {
	if validMode[mode] {
		return mode
	}
	if environment == "production" || criticality == CriticalityTier1 {
		return ValidationReadOnly
	}
	return ""
}

// PostureInput is the aggregated subtree state of one asset.
type PostureInput struct {
	Criticality   string
	OpenCritical  int
	OpenHigh      int
	OpenMedium    int
	OpenLow       int
	Total         int // assets in the subtree, self included
	Covered       int // of those, assets with at least one exploration anchor
	ActiveRetests int
}

// PostureResult is the computed posture of one asset.
type PostureResult struct {
	Status      string  `json:"posture_status"`
	Score       int     `json:"posture_score"`
	CoveragePct float64 `json:"validation_coverage_pct"`
}

func criticalityWeight(c string) float64 {
	switch c {
	case CriticalityTier1:
		return 1.25
	case CriticalityTier3:
		return 0.75
	}
	return 1.0
}

// ComputeAssetPosture is the deterministic posture calculation.
//
// score = 100 − weight × (finding penalty + 0.4 × untested %), clamped to 0–100,
// where the finding penalty is 40 per critical (max 80), 20 per high (max 60),
// 8 per medium (max 24) and 2 per low (max 6), and weight is 1.25 for Tier-1,
// 1.0 for Tier-2 and 0.75 for Tier-3. A subtree with no validation at all is
// capped at 50, so a blind spot never looks healthy.
func ComputeAssetPosture(in PostureInput) PostureResult {
	total := in.Total
	if total < 1 {
		total = 1
	}
	covered := min(max(in.Covered, 0), total)
	cov := float64(covered) / float64(total) * 100
	cov = math.Round(cov*10) / 10

	penalty := math.Min(80, 40*float64(in.OpenCritical)) +
		math.Min(60, 20*float64(in.OpenHigh)) +
		math.Min(24, 8*float64(in.OpenMedium)) +
		math.Min(6, 2*float64(in.OpenLow)) +
		0.4*(100-cov)
	score := 100 - criticalityWeight(in.Criticality)*penalty
	if covered == 0 {
		score = math.Min(score, 50)
	}
	s := int(math.Round(math.Max(0, math.Min(100, score))))

	var status string
	switch {
	case in.OpenCritical > 0:
		status = PostureCriticalExposure
	case in.OpenHigh+in.OpenMedium > 0:
		status = PostureHighExposure
	case in.ActiveRetests > 0:
		status = PosturePendingRetest
	case covered == total && covered > 0:
		status = PostureValidatedClean
	default:
		status = PostureBlindSpot
	}
	return PostureResult{Status: status, Score: s, CoveragePct: cov}
}

// ── Rollup ───────────────────────────────────────────────────────────────────

// postureFacts are the per-asset facts the rollup aggregates.
type postureFacts struct {
	id          int64
	criticality string
	anchored    bool
	lastAnchor  time.Time
	// open findings attached directly to this asset, by finding id → severity
	open map[int64]string
	// findings of this asset with an active retest
	retesting  map[int64]bool
	lastRetest time.Time
}

// postureRollup is the result of one rollup for one asset.
type postureRollup struct {
	PostureResult
	LastValidated time.Time
	OpenFindings  map[int64]string
}

// rollupPosture aggregates facts up the hierarchy. parent maps a child asset id
// to its parent asset id. It is pure, so the math is unit-testable.
func rollupPosture(facts map[int64]*postureFacts, parent map[int64]int64) map[int64]postureRollup {
	children := map[int64][]int64{}
	for c, p := range parent {
		if _, ok := facts[p]; ok && c != p {
			children[p] = append(children[p], c)
		}
	}
	type agg struct {
		open          map[int64]string
		retesting     map[int64]bool
		total         int
		covered       int
		lastValidated time.Time
	}
	memo := map[int64]*agg{}
	visiting := map[int64]bool{}
	var walk func(id int64) *agg
	walk = func(id int64) *agg {
		if a, ok := memo[id]; ok {
			return a
		}
		f := facts[id]
		a := &agg{open: map[int64]string{}, retesting: map[int64]bool{}, total: 1}
		if visiting[id] { // defensive: a cycle contributes only the node itself
			return a
		}
		visiting[id] = true
		for fid, sev := range f.open {
			a.open[fid] = sev
		}
		for fid := range f.retesting {
			a.retesting[fid] = true
		}
		if f.anchored {
			a.covered = 1
		}
		a.lastValidated = laterOf(f.lastAnchor, f.lastRetest)
		for _, c := range children[id] {
			ca := walk(c)
			for fid, sev := range ca.open {
				a.open[fid] = sev
			}
			for fid := range ca.retesting {
				a.retesting[fid] = true
			}
			a.total += ca.total
			a.covered += ca.covered
			a.lastValidated = laterOf(a.lastValidated, ca.lastValidated)
		}
		delete(visiting, id)
		memo[id] = a
		return a
	}

	out := make(map[int64]postureRollup, len(facts))
	for id, f := range facts {
		a := walk(id)
		in := PostureInput{Criticality: f.criticality, Total: a.total, Covered: a.covered, ActiveRetests: len(a.retesting)}
		for fid, sev := range a.open {
			if a.retesting[fid] {
				continue // under active retest: counted as pending verification, not open exposure
			}
			switch sev {
			case "critical":
				in.OpenCritical++
			case "high":
				in.OpenHigh++
			case "medium":
				in.OpenMedium++
			default:
				in.OpenLow++
			}
		}
		out[id] = postureRollup{PostureResult: ComputeAssetPosture(in), LastValidated: a.lastValidated, OpenFindings: a.open}
	}
	return out
}

func laterOf(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}

// openFindingStatuses are triage states that still represent live exposure.
// "pending" (not yet validated) is deliberately excluded: posture only counts
// verified exposure.
var openFindingStatuses = map[string]bool{"confirmed": true, "in_progress": true}

// postureSnapshot is everything one rollup loaded; it is also what the detail
// endpoint reads, so both always agree.
type postureSnapshot struct {
	rows    map[int64]*assetRow
	facts   map[int64]*postureFacts
	parent  map[int64]int64
	results map[int64]postureRollup
}

func (d *DB) loadPostureSnapshot(ctx context.Context) (*postureSnapshot, error) {
	rows, err := d.QueryContext(ctx, `SELECT `+findingAssetSelectCols+`, a.business_criticality FROM assets a`)
	if err != nil {
		return nil, err
	}
	byID := map[int64]*assetRow{}
	facts := map[int64]*postureFacts{}
	for rows.Next() {
		a := &assetRow{}
		var crit string
		if err := rows.Scan(&a.id, &a.kind, &a.companyID, &a.domain, &a.rootDomain,
			&a.ip, &a.url, &a.port, &a.serviceType, &a.appName, &crit); err != nil {
			rows.Close()
			return nil, err
		}
		byID[a.id] = a
		facts[a.id] = &postureFacts{id: a.id, criticality: crit, open: map[int64]string{}, retesting: map[int64]bool{}}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// exploration_anchors: tested assets and when they were last exercised.
	arows, err := d.QueryContext(ctx, `SELECT ea.asset_id, MAX(n.created_at)
		FROM exploration_anchors ea JOIN exploration_nodes n ON n.id = ea.node_id
		WHERE ((n.kind IN ('fact','finding') AND n.state = 'confirmed') OR (n.kind = 'intent' AND n.state = 'done')) GROUP BY ea.asset_id`)
	if err != nil {
		return nil, err
	}
	for arows.Next() {
		var id int64
		var ts time.Time
		if err := arows.Scan(&id, &ts); err != nil {
			arows.Close()
			return nil, err
		}
		if f := facts[id]; f != nil {
			f.anchored = true
			f.lastAnchor = ts
		}
	}
	arows.Close()
	if err := arows.Err(); err != nil {
		return nil, err
	}

	// Retests per finding: active or not, and when the last one finished.
	type retestInfo struct {
		active   bool
		finished time.Time
	}
	retests := map[int64]retestInfo{}
	rrows, err := d.QueryContext(ctx, `SELECT finding_id, bool_or(status IN ('pending','running')), MAX(finished_at)
		FROM finding_retests GROUP BY finding_id`)
	if err != nil {
		return nil, err
	}
	for rrows.Next() {
		var fid int64
		var active bool
		var fin sql.NullTime
		if err := rrows.Scan(&fid, &active, &fin); err != nil {
			rrows.Close()
			return nil, err
		}
		retests[fid] = retestInfo{active: active, finished: fin.Time}
	}
	rrows.Close()
	if err := rrows.Err(); err != nil {
		return nil, err
	}

	frows, err := d.QueryContext(ctx, `SELECT id, COALESCE(severity,''), status, asset_ids::text FROM findings
		WHERE jsonb_array_length(asset_ids) > 0`)
	if err != nil {
		return nil, err
	}
	for frows.Next() {
		var fid int64
		var sev, status, raw string
		if err := frows.Scan(&fid, &sev, &status, &raw); err != nil {
			frows.Close()
			return nil, err
		}
		var ids []int64
		_ = json.Unmarshal([]byte(raw), &ids)
		rt := retests[fid]
		for _, aid := range ids {
			f := facts[aid]
			if f == nil {
				continue
			}
			if openFindingStatuses[status] {
				f.open[fid] = strings.ToLower(sev)
			}
			if rt.active {
				f.retesting[fid] = true
			}
			f.lastRetest = laterOf(f.lastRetest, rt.finished)
		}
	}
	frows.Close()
	if err := frows.Err(); err != nil {
		return nil, err
	}

	// Validation only counts while it is inside the asset's cadence window: a stale
	// validation (coverage_state stale_validation) is not proof of a clean asset today.
	if cov, err := d.ComputeCoverageIntelligence(ctx, time.Now()); err == nil {
		for id, f := range facts {
			if r, ok := cov.Results[id]; ok && f.anchored && !r.FreshlyValidated {
				f.anchored = false
			}
		}
	} else {
		return nil, err
	}

	_, parentOf := d.assembleFindingAssetNodes(byID)
	parent := map[int64]int64{}
	for ck, pk := range parentOf {
		c, okc := assetIDFromKey(ck)
		p, okp := assetIDFromKey(pk)
		if okc && okp {
			parent[c] = p
		}
	}
	return &postureSnapshot{rows: byID, facts: facts, parent: parent, results: rollupPosture(facts, parent)}, nil
}

func assetIDFromKey(k string) (int64, bool) {
	if !strings.HasPrefix(k, "a:") {
		return 0, false
	}
	id, err := strconv.ParseInt(k[2:], 10, 64)
	return id, err == nil
}

var postureMu sync.Mutex

// RollupHierarchyPosture recomputes and persists posture for every asset. It
// returns the number of assets updated.
func (d *DB) RollupHierarchyPosture(ctx context.Context) (int, error) {
	postureMu.Lock()
	defer postureMu.Unlock()
	snap, err := d.loadPostureSnapshot(ctx)
	if err != nil {
		return 0, err
	}
	if len(snap.results) == 0 {
		return 0, nil
	}
	ids := make([]int64, 0, len(snap.results))
	for id := range snap.results {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	statuses := make([]string, len(ids))
	scores := make([]int64, len(ids))
	covs := make([]float64, len(ids))
	lvs := make([]string, len(ids))
	for i, id := range ids {
		r := snap.results[id]
		statuses[i], scores[i], covs[i] = r.Status, int64(r.Score), r.CoveragePct
		if !r.LastValidated.IsZero() {
			lvs[i] = r.LastValidated.UTC().Format(time.RFC3339Nano)
		}
	}
	_, err = d.ExecContext(ctx, `UPDATE assets AS a SET
		posture_status = u.status, posture_score = u.score, validation_coverage_pct = u.cov,
		last_validated_at = NULLIF(u.lv, '')::timestamptz, posture_computed_at = now()
		FROM unnest($1::bigint[], $2::text[], $3::bigint[], $4::float8[], $5::text[]) AS u(id, status, score, cov, lv)
		WHERE a.id = u.id`,
		ids, statuses, scores, covs, lvs)
	if err != nil {
		return 0, fmt.Errorf("persist posture: %w", err)
	}
	return len(ids), nil
}

// ── Reads ────────────────────────────────────────────────────────────────────

// AssetMetadata is the operator-editable business context of an asset.
type AssetMetadata struct {
	BusinessCriticality *string `json:"business_criticality,omitempty"`
	OwnerTeam           *string `json:"owner_team,omitempty"`
	Environment         *string `json:"environment,omitempty"`     // "" clears it
	ValidationMode      *string `json:"validation_mode,omitempty"` // "" = derived
}

// UpdateAssetMetadata validates and stores business context. Unset fields are kept.
func (d *DB) UpdateAssetMetadata(ctx context.Context, id int64, m AssetMetadata) error {
	sets := []string{}
	args := []any{}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if m.BusinessCriticality != nil {
		if !ValidCriticality(*m.BusinessCriticality) {
			return fmt.Errorf("invalid business_criticality %q", *m.BusinessCriticality)
		}
		add("business_criticality", *m.BusinessCriticality)
	}
	if m.OwnerTeam != nil {
		team := strings.TrimSpace(*m.OwnerTeam)
		if team == "" {
			team = "Unassigned"
		}
		if len(team) > 120 {
			return fmt.Errorf("owner_team too long")
		}
		add("owner_team", team)
	}
	if m.Environment != nil {
		if *m.Environment != "" && !ValidEnvironment(*m.Environment) {
			return fmt.Errorf("invalid environment %q", *m.Environment)
		}
		add("environment", nullIfEmpty(*m.Environment))
	}
	if m.ValidationMode != nil {
		if *m.ValidationMode != "" && !ValidValidationMode(*m.ValidationMode) {
			return fmt.Errorf("invalid validation_mode %q", *m.ValidationMode)
		}
		add("validation_mode", nullIfEmpty(*m.ValidationMode))
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	res, err := d.ExecContext(ctx, `UPDATE assets SET `+strings.Join(sets, ", ")+
		fmt.Sprintf(", updated_at = now() WHERE id = $%d", len(args)), args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}


// PostureAssetRef is a compact asset reference used in posture responses.
type PostureAssetRef struct {
	ID                  int64   `json:"id"`
	Type                string  `json:"type"`
	Label               string  `json:"label"`
	BusinessCriticality string  `json:"business_criticality"`
	OwnerTeam           string  `json:"owner_team"`
	Environment         string  `json:"environment,omitempty"`
	PostureStatus       string  `json:"posture_status"`
	PostureScore        int     `json:"posture_score"`
	CoveragePct         float64 `json:"validation_coverage_pct"`
}

// PostureSummary is the overall posture picture for GET /api/posture/summary.
type PostureSummary struct {
	OverallScore      int            `json:"overall_score"`
	AssetTotal        int            `json:"asset_total"`
	ByStatus          map[string]int `json:"by_status"`
	ByCriticality     map[string]int `json:"by_criticality"`
	CoveragePct       float64        `json:"coverage_pct"`
	ValidatedAssets   int            `json:"validated_assets"`
	BlindSpots        int            `json:"blind_spots"`
	Tier1             Tier1Summary   `json:"tier1"`
	PendingApprovals  int            `json:"pending_approvals"`
	AwaitingRetest    int            `json:"fixes_awaiting_verification"`
	OverdueRetests    int            `json:"overdue_retests"`
	ComputedAt        string         `json:"computed_at"`
	HighValueBlind    []PostureAssetRef     `json:"high_value_blind_spots"`
	TopExposedAssets  []PostureAssetRef     `json:"top_exposed_assets"`
}

// Tier1Summary summarizes crown-jewel exposure.
type Tier1Summary struct {
	Total      int `json:"total"`
	Critical   int `json:"critical_exposures"`
	High       int `json:"high_exposures"`
	BlindSpots int `json:"blind_spots"`
}

// assetPostureCols are the columns loadAssetRefs reads.
const assetRefCols = `a.id, a.type, COALESCE(a.domain,''), COALESCE(a.ip,''), COALESCE(a.url,''),
	COALESCE(a.method,''), COALESCE(a.app_name,''), COALESCE(a.port,0), a.business_criticality, a.owner_team,
	COALESCE(a.environment,''), a.posture_status, a.posture_score, a.validation_coverage_pct`

func scanAssetRef(rows *sql.Rows) (PostureAssetRef, error) {
	var r PostureAssetRef
	var domain, ip, url, method, app string
	var port int
	var cov float32
	if err := rows.Scan(&r.ID, &r.Type, &domain, &ip, &url, &method, &app, &port,
		&r.BusinessCriticality, &r.OwnerTeam, &r.Environment, &r.PostureStatus, &r.PostureScore, &cov); err != nil {
		return r, err
	}
	r.CoveragePct = float64(cov)
	r.Label = refLabel(r.Type, domain, ip, url, method, app, port)
	return r, nil
}

func refLabel(kind, domain, ip, url, method, app string, port int) string {
	switch kind {
	case "endpoint":
		if method != "" {
			return method + " " + url
		}
		return url
	case "service":
		if url != "" {
			return url
		}
		host := domain
		if host == "" {
			host = ip
		}
		if port > 0 {
			return host + ":" + strconv.Itoa(port)
		}
		return host
	case "app":
		return app
	case "ip":
		return ip
	}
	if domain != "" {
		return domain
	}
	return ip
}

// PostureSummary aggregates the persisted posture (call RollupHierarchyPosture first).
// companyID 0 = all companies.
func (d *DB) PostureSummary(ctx context.Context, companyID int64) (*PostureSummary, error) {
	where := ""
	args := []any{}
	if companyID > 0 {
		where = " WHERE a.company_id = $1"
		args = append(args, companyID)
	}
	rows, err := d.QueryContext(ctx, `SELECT `+assetRefCols+` FROM assets a`+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	s := &PostureSummary{ByStatus: map[string]int{}, ByCriticality: map[string]int{}}
	var weighted, weights float64
	var all []PostureAssetRef
	for rows.Next() {
		r, err := scanAssetRef(rows)
		if err != nil {
			return nil, err
		}
		all = append(all, r)
		s.AssetTotal++
		s.ByStatus[r.PostureStatus]++
		s.ByCriticality[r.BusinessCriticality]++
		w := 2.0
		switch r.BusinessCriticality {
		case CriticalityTier1:
			w = 3
		case CriticalityTier3:
			w = 1
		}
		weighted += w * float64(r.PostureScore)
		weights += w
		if r.BusinessCriticality == CriticalityTier1 {
			s.Tier1.Total++
			switch r.PostureStatus {
			case PostureCriticalExposure:
				s.Tier1.Critical++
			case PostureHighExposure:
				s.Tier1.High++
			case PostureBlindSpot:
				s.Tier1.BlindSpots++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if weights > 0 {
		s.OverallScore = int(math.Round(weighted / weights))
	}

	// Coverage = assets with their own anchor / all assets (not the subtree rollup).
	cq := `SELECT COUNT(DISTINCT ea.asset_id) FROM exploration_anchors ea JOIN assets a ON a.id = ea.asset_id
		JOIN exploration_nodes n ON n.id = ea.node_id` + validationWhere(where)
	if err := d.QueryRowContext(ctx, cq, args...).Scan(&s.ValidatedAssets); err != nil {
		return nil, err
	}
	s.BlindSpots = s.AssetTotal - s.ValidatedAssets
	if s.AssetTotal > 0 {
		s.CoveragePct = math.Round(float64(s.ValidatedAssets)/float64(s.AssetTotal)*1000) / 10
	}

	// High-value blind spots: Tier-1/Tier-2 assets with no anchors of their own.
	anchored := map[int64]bool{}
	arows, err := d.QueryContext(ctx, `SELECT DISTINCT ea.asset_id FROM exploration_anchors ea
		JOIN exploration_nodes n ON n.id = ea.node_id WHERE ((n.kind IN ('fact','finding') AND n.state = 'confirmed') OR (n.kind = 'intent' AND n.state = 'done'))`)
	if err != nil {
		return nil, err
	}
	for arows.Next() {
		var id int64
		if err := arows.Scan(&id); err == nil {
			anchored[id] = true
		}
	}
	arows.Close()
	tierRank := map[string]int{CriticalityTier1: 0, CriticalityTier2: 1, CriticalityTier3: 2}
	for _, r := range all {
		if !anchored[r.ID] && r.BusinessCriticality != CriticalityTier3 {
			s.HighValueBlind = append(s.HighValueBlind, r)
		}
		if r.PostureStatus == PostureCriticalExposure || r.PostureStatus == PostureHighExposure {
			s.TopExposedAssets = append(s.TopExposedAssets, r)
		}
	}
	sort.SliceStable(s.HighValueBlind, func(i, j int) bool {
		a, b := s.HighValueBlind[i], s.HighValueBlind[j]
		if tierRank[a.BusinessCriticality] != tierRank[b.BusinessCriticality] {
			return tierRank[a.BusinessCriticality] < tierRank[b.BusinessCriticality]
		}
		return a.ID < b.ID
	})
	if len(s.HighValueBlind) > 10 {
		s.HighValueBlind = s.HighValueBlind[:10]
	}
	sort.SliceStable(s.TopExposedAssets, func(i, j int) bool {
		return s.TopExposedAssets[i].PostureScore < s.TopExposedAssets[j].PostureScore
	})
	if len(s.TopExposedAssets) > 10 {
		s.TopExposedAssets = s.TopExposedAssets[:10]
	}

	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM intercept_pending WHERE status = 'pending'`).Scan(&s.PendingApprovals); err != nil {
		return nil, err
	}
	// Fixes awaiting verification: resolved/fixed findings whose latest retest did not say "fixed";
	// overdue when reported more than 7 days ago.
	err = d.QueryRowContext(ctx, `SELECT COUNT(*), COUNT(*) FILTER (WHERE f.created_at < now() - interval '7 days')
		FROM findings f
		LEFT JOIN LATERAL (SELECT verdict FROM finding_retests r WHERE r.finding_id = f.id ORDER BY r.id DESC LIMIT 1) lr ON true
		WHERE f.status IN ('resolved','fixed') AND COALESCE(lr.verdict,'') <> 'fixed'`).Scan(&s.AwaitingRetest, &s.OverdueRetests)
	if err != nil {
		return nil, err
	}
	s.ComputedAt = time.Now().UTC().Format(time.RFC3339)
	return s, nil
}

// AssetPostureDetail is GET /api/assets/:id/posture.
type AssetPostureDetail struct {
	Asset                   PostureAssetRef          `json:"asset"`
	ValidationMode          string            `json:"validation_mode"`           // explicit mode, "" = derived
	EffectiveValidationMode string            `json:"effective_validation_mode"` // "" = legacy (existing rules only)
	LastValidatedAt         string            `json:"last_validated_at,omitempty"`
	Upstream                []PostureAssetRef        `json:"upstream"`
	Downstream              []PostureAssetRef        `json:"downstream"`
	DownstreamTotal         int               `json:"downstream_total"`
	DownstreamUntested      int               `json:"downstream_untested"`
	Anchors                 int               `json:"anchors"`
	Findings                []PostureFinding  `json:"findings"`
	Recommendations         []string          `json:"recommendations"`
	GuardEvents             []GuardAuditEvent `json:"guard_events"`
}

// PostureFinding is a finding linked to an asset's subtree.
type PostureFinding struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	VulnClass    string `json:"vulnclass"`
	Severity     string `json:"severity"`
	Status       string `json:"status"`
	AssetID      int64  `json:"asset_id"`
	Receipts     int    `json:"evidence_receipts"`
	LatestRetest string `json:"latest_retest_verdict,omitempty"`
}

// GetAssetPosture returns the posture breakdown of one asset (after a rollup).
func (d *DB) GetAssetPosture(ctx context.Context, id int64) (*AssetPostureDetail, error) {
	snap, err := d.loadPostureSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	if snap.rows[id] == nil {
		return nil, sql.ErrNoRows
	}
	refs, err := d.assetRefs(ctx)
	if err != nil {
		return nil, err
	}
	det := &AssetPostureDetail{Asset: refs[id], Upstream: []PostureAssetRef{}, Downstream: []PostureAssetRef{}, Findings: []PostureFinding{}}
	// Live values from the snapshot (persisted values may lag a write by one rollup).
	if r, ok := snap.results[id]; ok {
		det.Asset.PostureStatus, det.Asset.PostureScore, det.Asset.CoveragePct = r.Status, r.Score, r.CoveragePct
		if !r.LastValidated.IsZero() {
			det.LastValidatedAt = r.LastValidated.UTC().Format(time.RFC3339)
		}
	}
	var mode, env sql.NullString
	if err := d.QueryRowContext(ctx, `SELECT validation_mode, environment FROM assets WHERE id = $1`, id).Scan(&mode, &env); err != nil {
		return nil, err
	}
	det.ValidationMode = mode.String
	det.EffectiveValidationMode = EffectiveValidationMode(mode.String, env.String, det.Asset.BusinessCriticality)

	// Upstream chain.
	seen := map[int64]bool{id: true}
	for p, ok := snap.parent[id]; ok && !seen[p]; p, ok = snap.parent[p] {
		seen[p] = true
		det.Upstream = append(det.Upstream, refs[p])
	}
	// Downstream subtree (blast radius).
	children := map[int64][]int64{}
	for c, p := range snap.parent {
		children[p] = append(children[p], c)
	}
	queue := append([]int64(nil), children[id]...)
	visited := map[int64]bool{id: true}
	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		if visited[c] {
			continue
		}
		visited[c] = true
		det.DownstreamTotal++
		if f := snap.facts[c]; f != nil && !f.anchored {
			det.DownstreamUntested++
		}
		if len(det.Downstream) < 50 {
			det.Downstream = append(det.Downstream, refs[c])
		}
		queue = append(queue, children[c]...)
	}
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM exploration_anchors ea JOIN exploration_nodes n ON n.id = ea.node_id
		WHERE ea.asset_id = $1 AND ((n.kind IN ('fact','finding') AND n.state = 'confirmed') OR (n.kind = 'intent' AND n.state = 'done'))`, id).Scan(&det.Anchors); err != nil {
		return nil, err
	}

	// Findings anywhere in the subtree.
	subtree := make([]int64, 0, len(visited))
	for a := range visited {
		subtree = append(subtree, a)
	}
	frows, err := d.QueryContext(ctx, `SELECT f.id, COALESCE(f.name,''), f.vulnclass, COALESCE(f.severity,''), f.status, f.asset_ids::text,
		(SELECT COUNT(*) FROM finding_traffic_bindings b WHERE b.finding_id = f.id),
		COALESCE((SELECT verdict FROM finding_retests r WHERE r.finding_id = f.id ORDER BY r.id DESC LIMIT 1),'')
		FROM findings f
		WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(f.asset_ids) e WHERE e::bigint = ANY($1::bigint[]))
		ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, f.id`,
		subtree)
	if err != nil {
		return nil, err
	}
	defer frows.Close()
	openCount := 0
	for frows.Next() {
		var f PostureFinding
		var raw string
		if err := frows.Scan(&f.ID, &f.Name, &f.VulnClass, &f.Severity, &f.Status, &raw, &f.Receipts, &f.LatestRetest); err != nil {
			return nil, err
		}
		var ids []int64
		_ = json.Unmarshal([]byte(raw), &ids)
		for _, a := range ids {
			if visited[a] {
				f.AssetID = a
				break
			}
		}
		if openFindingStatuses[f.Status] {
			openCount++
		}
		det.Findings = append(det.Findings, f)
	}
	if err := frows.Err(); err != nil {
		return nil, err
	}

	det.Recommendations = postureRecommendations(det, openCount)
	det.GuardEvents, err = d.ListGuardAuditEvents(ctx, GuardAuditFilter{AssetID: id, Limit: 20})
	if err != nil {
		return nil, err
	}
	return det, nil
}

func postureRecommendations(det *AssetPostureDetail, open int) []string {
	var out []string
	for _, f := range det.Findings {
		if !openFindingStatuses[f.Status] {
			if (f.Status == "resolved" || f.Status == "fixed") && f.LatestRetest != "fixed" {
				out = append(out, fmt.Sprintf("Verify the fix for finding #%d (%s) with a targeted retest.", f.ID, nameOr(f)))
			}
			continue
		}
		out = append(out, fmt.Sprintf("Mitigate now, then remediate %s finding #%d (%s); open it for class-specific steps and its HTTP evidence.", f.Severity, f.ID, nameOr(f)))
	}
	if det.Anchors == 0 {
		out = append(out, "This asset has never been validated: schedule a safe (read-only) validation before treating it as clean.")
	}
	if det.DownstreamUntested > 0 {
		out = append(out, fmt.Sprintf("%d of %d child assets are untested blind spots; schedule safe validation for them.", det.DownstreamUntested, det.DownstreamTotal))
	}
	if det.Asset.BusinessCriticality == CriticalityTier1 && det.EffectiveValidationMode == ValidationReadOnly {
		out = append(out, "Crown-jewel asset: validation is read-only and every action needs human approval.")
	}
	if open == 0 && det.Anchors > 0 && det.DownstreamUntested == 0 && len(out) == 0 {
		out = append(out, "Validated clean: keep it in the regular retest cycle.")
	}
	return out
}

func nameOr(f PostureFinding) string {
	if f.Name != "" {
		return f.Name
	}
	return f.VulnClass
}

func (d *DB) assetRefs(ctx context.Context) (map[int64]PostureAssetRef, error) {
	rows, err := d.QueryContext(ctx, `SELECT `+assetRefCols+` FROM assets a`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]PostureAssetRef{}
	for rows.Next() {
		r, err := scanAssetRef(rows)
		if err != nil {
			return nil, err
		}
		out[r.ID] = r
	}
	return out, rows.Err()
}

// AssetGuardProfile is what the guardrail policy needs to know about a target asset.
type AssetGuardProfile struct {
	ID             int64
	Label          string
	Criticality    string
	Environment    string
	ValidationMode string // explicit, "" = derived
	EffectiveMode  string
}

// AssetGuardProfiles returns the classified assets matching any of the given
// hosts (domain or IP, lower case). Assets with no explicit classification and
// an effective mode of "" are omitted: they keep legacy behaviour.
func (d *DB) AssetGuardProfiles(ctx context.Context, hosts []string) ([]AssetGuardProfile, error) {
	if len(hosts) == 0 {
		return nil, nil
	}
	rows, err := d.QueryContext(ctx, `SELECT a.id, a.type, COALESCE(a.domain,''), COALESCE(a.ip,''), COALESCE(a.url,''),
		COALESCE(a.method,''), COALESCE(a.app_name,''), COALESCE(a.port,0),
		a.business_criticality, COALESCE(a.environment,''), COALESCE(a.validation_mode,'')
		FROM assets a
		WHERE (lower(a.domain) = ANY($1::text[]) OR a.ip = ANY($1::text[]))
		  AND (a.business_criticality = 'tier_1_crown_jewel' OR a.environment IS NOT NULL OR a.validation_mode IS NOT NULL)
		ORDER BY a.id`, hosts)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AssetGuardProfile
	for rows.Next() {
		var p AssetGuardProfile
		var kind, domain, ip, url, method, app string
		var port int
		if err := rows.Scan(&p.ID, &kind, &domain, &ip, &url, &method, &app, &port, &p.Criticality, &p.Environment, &p.ValidationMode); err != nil {
			return nil, err
		}
		p.Label = refLabel(kind, domain, ip, url, method, app, port)
		p.EffectiveMode = EffectiveValidationMode(p.ValidationMode, p.Environment, p.Criticality)
		if p.EffectiveMode == "" && p.Criticality != CriticalityTier1 {
			continue
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// validationAnchorSQL restricts an anchors join (alias n) to proof of validation:
// confirmed facts and findings, and completed intents (see IsValidationAnchor).
const validationAnchorSQL = `((n.kind IN ('fact','finding') AND n.state = 'confirmed') OR (n.kind = 'intent' AND n.state = 'done'))`

func validationWhere(where string) string {
	if where == "" {
		return " WHERE " + validationAnchorSQL
	}
	return where + " AND " + validationAnchorSQL
}
