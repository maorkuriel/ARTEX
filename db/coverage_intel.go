package db

// Coverage Intelligence & Blind-Spot Engine.
//
// exploration_anchors(node_id, asset_id) are the proof that an asset was actively
// exercised. This engine turns them into a per-asset coverage state, explains every
// gap with a concrete blind-spot reason, applies validation-cadence policies, and
// rolls coverage up by criticality tier, owner team and parent domain.
//
// Validation anchors are anchors from confirmed facts, confirmed findings and
// completed intents. Hints, goals and intents that never finished (exhausted,
// blocked, stopped, deleted) are counted in anchor_count but are not proof of
// validation.
//
// Per-asset classification (ClassifyAssetBlindSpots):
//   out of scope (asset blocklist / deny rule)          → out_of_scope (reason out_of_scope)
//   validated, cadence window passed                     → stale_validation (cadence_expired)
//   validated, some in-scope descendant not validated    → partially_validated
//   validated                                            → validated
//   not validated, some descendant validated             → partially_validated
//   otherwise                                            → unvalidated_blind_spot, with reason
//        awaiting_guard_approval > blocked_by_auth_or_waf > budget_exhausted > never_tested

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Coverage states.
const (
	CoverageValidated   = "validated"
	CoveragePartial     = "partially_validated"
	CoverageBlindSpot   = "unvalidated_blind_spot"
	CoverageStale       = "stale_validation"
	CoverageOutOfScope  = "out_of_scope"
	ReasonNeverTested   = "never_tested"
	ReasonOutOfScope    = "out_of_scope"
	ReasonBudget        = "budget_exhausted"
	ReasonAuthWAF       = "blocked_by_auth_or_waf"
	ReasonAwaitApproval = "awaiting_guard_approval"
	ReasonCadence       = "cadence_expired"
)

// Coverage policy triggers.
const (
	TriggerNewEndpoint  = "on_new_endpoint_discovered"
	TriggerCadence      = "on_cadence_expired"
	TriggerPriorityCVE  = "on_high_priority_cve_ingested"
	defaultCadenceTier1 = 7
	defaultCadenceTier2 = 14
	defaultCadenceTier3 = 30
)

var validTriggers = map[string]bool{TriggerNewEndpoint: true, TriggerCadence: true, TriggerPriorityCVE: true}

// DefaultCadenceDays is the cadence used when no policy matches.
func DefaultCadenceDays(criticality string) int {
	switch criticality {
	case CriticalityTier1:
		return defaultCadenceTier1
	case CriticalityTier3:
		return defaultCadenceTier3
	}
	return defaultCadenceTier2
}

// CoverageFacts are the per-asset inputs of the classification.
type CoverageFacts struct {
	ID                int64
	Criticality       string
	ValidationAnchors int
	LastValidated     time.Time
	CadenceDays       int
	OutOfScope        bool
	AwaitingApproval  bool
	BlockedAuthWAF    bool
	BudgetExhausted   bool // an exhausted intent anchored to this asset
}

// CoverageResult is the classification of one asset.
type CoverageResult struct {
	State  string
	Reason string // "" when the asset is not a blind spot
	DueAt  time.Time
	// FreshlyValidated: has validation anchors within its cadence window.
	FreshlyValidated bool
}

func reasonPriority(r string) int {
	switch r {
	case ReasonAwaitApproval:
		return 0
	case ReasonCadence:
		return 1
	case ReasonNeverTested:
		return 2
	case ReasonAuthWAF:
		return 3
	case ReasonBudget:
		return 4
	case ReasonOutOfScope:
		return 6
	}
	return 5
}

// ClassifyAssetBlindSpots classifies every asset. parent maps child → parent. Pure.
func ClassifyAssetBlindSpots(facts map[int64]*CoverageFacts, parent map[int64]int64, now time.Time) map[int64]CoverageResult {
	children := map[int64][]int64{}
	for c, p := range parent {
		if _, ok := facts[p]; ok && c != p {
			children[p] = append(children[p], c)
		}
	}
	fresh := map[int64]bool{}
	due := map[int64]time.Time{}
	for id, f := range facts {
		if f.ValidationAnchors > 0 && !f.LastValidated.IsZero() {
			cad := f.CadenceDays
			if cad <= 0 {
				cad = DefaultCadenceDays(f.Criticality)
			}
			d := f.LastValidated.Add(time.Duration(cad) * 24 * time.Hour)
			due[id] = d
			fresh[id] = !f.OutOfScope && !now.After(d)
		}
	}
	// Budget exhaustion is inherited from ancestors (the run that would have reached it stopped).
	budget := func(id int64) bool {
		seen := map[int64]bool{}
		for cur, ok := id, true; ok && !seen[cur]; cur, ok = parent[cur] {
			seen[cur] = true
			if f := facts[cur]; f != nil && f.BudgetExhausted {
				return true
			}
		}
		return false
	}
	// Descendant counts: in-scope descendants and freshly validated descendants.
	type agg struct{ inScope, validated int }
	memo := map[int64]agg{}
	visiting := map[int64]bool{}
	var walk func(id int64) agg
	walk = func(id int64) agg {
		if a, ok := memo[id]; ok {
			return a
		}
		if visiting[id] {
			return agg{}
		}
		visiting[id] = true
		var a agg
		for _, c := range children[id] {
			if !facts[c].OutOfScope {
				a.inScope++
				if fresh[c] {
					a.validated++
				}
			}
			ca := walk(c)
			a.inScope += ca.inScope
			a.validated += ca.validated
		}
		delete(visiting, id)
		memo[id] = a
		return a
	}

	out := make(map[int64]CoverageResult, len(facts))
	for id, f := range facts {
		r := CoverageResult{DueAt: due[id], FreshlyValidated: fresh[id]}
		desc := walk(id)
		switch {
		case f.OutOfScope:
			r.State, r.Reason = CoverageOutOfScope, ReasonOutOfScope
		case f.ValidationAnchors > 0 && !fresh[id]:
			r.State, r.Reason = CoverageStale, ReasonCadence
		case f.ValidationAnchors > 0 && desc.validated < desc.inScope:
			r.State = CoveragePartial
		case f.ValidationAnchors > 0:
			r.State = CoverageValidated
		case desc.validated > 0:
			r.State = CoveragePartial
		default:
			r.State = CoverageBlindSpot
			switch {
			case f.AwaitingApproval:
				r.Reason = ReasonAwaitApproval
			case f.BlockedAuthWAF:
				r.Reason = ReasonAuthWAF
			case budget(id):
				r.Reason = ReasonBudget
			default:
				r.Reason = ReasonNeverTested
			}
		}
		out[id] = r
	}
	return out
}

// ── Policies ─────────────────────────────────────────────────────────────────

// CoveragePolicy defines cadence, triggers and the enforced validation mode.
type CoveragePolicy struct {
	ID                  int64    `json:"id"`
	Name                string   `json:"name"`
	BusinessCriticality string   `json:"business_criticality,omitempty"` // "" = any tier
	ScopePattern        string   `json:"scope_pattern"`                  // "" = any; else host suffix
	CadenceDays         int      `json:"cadence_days"`
	Triggers            []string `json:"triggers"`
	ValidationMode      string   `json:"validation_mode"`
	Enabled             bool     `json:"enabled"`
	CreatedAt           string   `json:"created_at,omitempty"`
}

// Validate normalizes and checks a policy.
func (p *CoveragePolicy) Validate() error {
	p.Name = strings.TrimSpace(p.Name)
	p.ScopePattern = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(p.ScopePattern), "*.")))
	if p.Name == "" || len(p.Name) > 120 {
		return fmt.Errorf("name is required (max 120 characters)")
	}
	if p.BusinessCriticality != "" && !ValidCriticality(p.BusinessCriticality) {
		return fmt.Errorf("invalid business_criticality %q", p.BusinessCriticality)
	}
	if p.CadenceDays < 1 || p.CadenceDays > 365 {
		return fmt.Errorf("cadence_days must be 1-365")
	}
	if p.ValidationMode == "" {
		p.ValidationMode = ValidationReadOnly
	}
	if !ValidValidationMode(p.ValidationMode) {
		return fmt.Errorf("invalid validation_mode %q", p.ValidationMode)
	}
	seen := map[string]bool{}
	clean := []string{}
	for _, t := range p.Triggers {
		if !validTriggers[t] {
			return fmt.Errorf("invalid trigger %q", t)
		}
		if !seen[t] {
			seen[t] = true
			clean = append(clean, t)
		}
	}
	p.Triggers = clean
	return nil
}

// Matches reports whether the policy applies to an asset, and how specific the match is.
func (p CoveragePolicy) Matches(criticality string, hosts []string) (bool, int) {
	if !p.Enabled {
		return false, 0
	}
	spec := 0
	if p.BusinessCriticality != "" {
		if p.BusinessCriticality != criticality {
			return false, 0
		}
		spec++
	}
	if p.ScopePattern != "" {
		hit := false
		for _, h := range hosts {
			if h == p.ScopePattern || strings.HasSuffix(h, "."+p.ScopePattern) {
				hit = true
				break
			}
		}
		if !hit {
			return false, 0
		}
		spec += 2
	}
	return true, spec
}

// EffectivePolicy picks the most specific matching policy (ties: shortest cadence).
func EffectivePolicy(policies []CoveragePolicy, criticality string, hosts []string) (CoveragePolicy, bool) {
	var best CoveragePolicy
	bestSpec, found := -1, false
	for _, p := range policies {
		ok, spec := p.Matches(criticality, hosts)
		if !ok {
			continue
		}
		if spec > bestSpec || (spec == bestSpec && p.CadenceDays < best.CadenceDays) {
			best, bestSpec, found = p, spec, true
		}
	}
	return best, found
}

// ListCoveragePolicies returns all policies.
func (d *DB) ListCoveragePolicies(ctx context.Context) ([]CoveragePolicy, error) {
	rows, err := d.QueryContext(ctx, `SELECT id, name, COALESCE(business_criticality,''), scope_pattern, cadence_days,
		array_to_json(triggers)::text, validation_mode, enabled, created_at FROM coverage_policies ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CoveragePolicy{}
	for rows.Next() {
		var p CoveragePolicy
		var trig string
		var ts time.Time
		if err := rows.Scan(&p.ID, &p.Name, &p.BusinessCriticality, &p.ScopePattern, &p.CadenceDays, &trig,
			&p.ValidationMode, &p.Enabled, &ts); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(trig), &p.Triggers)
		if p.Triggers == nil {
			p.Triggers = []string{}
		}
		p.CreatedAt = ts.UTC().Format(time.RFC3339)
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateCoveragePolicy validates and stores a policy.
func (d *DB) CreateCoveragePolicy(ctx context.Context, p CoveragePolicy) (CoveragePolicy, error) {
	if err := p.Validate(); err != nil {
		return p, err
	}
	err := d.QueryRowContext(ctx, `INSERT INTO coverage_policies
		(name, business_criticality, scope_pattern, cadence_days, triggers, validation_mode, enabled)
		VALUES ($1, NULLIF($2,''), $3, $4, $5, $6, $7) RETURNING id`,
		p.Name, p.BusinessCriticality, p.ScopePattern, p.CadenceDays, p.Triggers, p.ValidationMode, p.Enabled).Scan(&p.ID)
	return p, err
}

// DeleteCoveragePolicy removes a policy.
func (d *DB) DeleteCoveragePolicy(ctx context.Context, id int64) error {
	res, err := d.ExecContext(ctx, `DELETE FROM coverage_policies WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ── Loading ──────────────────────────────────────────────────────────────────

type coverageAsset struct {
	row        *assetRow
	crit       string
	owner      string
	method     string
	hosts      []string // lower-case domain / ip / url host
	urlPrefix  string   // endpoint/service URL up to the first template brace, lower-case
	createdAt  time.Time
	anchors    int
	intents    int
	policy     *CoveragePolicy
	validation string // effective validation mode (asset, else policy)
}

// CoverageSnapshot is one evaluation of the whole asset graph.
type CoverageSnapshot struct {
	Now      time.Time
	assets   map[int64]*coverageAsset
	facts    map[int64]*CoverageFacts
	parent   map[int64]int64
	Results  map[int64]CoverageResult
	policies []CoveragePolicy
}

var authWAFReason = regexp.MustCompile(`(?i)\b(401|403|429)\b|waf|unauthori[sz]ed|forbidden|rate.?limit|captcha|login required|no (valid )?credentials`)

func (a *coverageAsset) matchesText(text string) bool {
	text = strings.ToLower(text)
	if a.urlPrefix != "" {
		return strings.Contains(text, a.urlPrefix)
	}
	for _, h := range a.hosts {
		if h == "" {
			continue
		}
		for _, pre := range []string{"//" + h, "\"" + h, " " + h, "@" + h} {
			if idx := strings.Index(text, pre); idx >= 0 {
				end := idx + len(pre)
				if end == len(text) || strings.ContainsRune("/:\"? ,]}", rune(text[end])) {
					return true
				}
			}
		}
	}
	return false
}

var urlInText = regexp.MustCompile(`(?i)https?://[^\s"'<>]+`)

// matchesEvidence is matchesText for evidence about specific requests (401/403/429
// receipts, ledger follow-ups): a URL with a path beyond "/" only marks
// the endpoint or service it addresses, never the whole host above it.
func (a *coverageAsset) matchesEvidence(text string) bool {
	if a.urlPrefix != "" {
		return a.matchesText(text)
	}
	urls := urlInText.FindAllString(text, -1)
	if len(urls) == 0 {
		return a.matchesText(text)
	}
	for _, raw := range urls {
		u, err := url.Parse(raw)
		if err != nil {
			continue
		}
		if p := strings.TrimRight(u.EscapedPath(), "/"); p != "" {
			continue // a specific path: not evidence about the host itself
		}
		if containsStr(a.hosts, strings.ToLower(u.Hostname())) {
			return true
		}
	}
	return false
}

func urlPrefixOf(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if i := strings.Index(raw, "{"); i >= 0 {
		raw = raw[:i]
	}
	return raw
}

func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// ComputeCoverageIntelligence evaluates every asset (read-only; see PersistCoverage).
func (d *DB) ComputeCoverageIntelligence(ctx context.Context, now time.Time) (*CoverageSnapshot, error) {
	snap := &CoverageSnapshot{Now: now, assets: map[int64]*coverageAsset{}, facts: map[int64]*CoverageFacts{}, parent: map[int64]int64{}}
	rows, err := d.QueryContext(ctx, `SELECT `+findingAssetSelectCols+`, a.business_criticality, a.owner_team,
		COALESCE(a.method,''), COALESCE(a.environment,''), COALESCE(a.validation_mode,''), a.created_at FROM assets a`)
	if err != nil {
		return nil, err
	}
	byID := map[int64]*assetRow{}
	for rows.Next() {
		r := &assetRow{}
		ca := &coverageAsset{row: r}
		var env, mode string
		if err := rows.Scan(&r.id, &r.kind, &r.companyID, &r.domain, &r.rootDomain, &r.ip, &r.url, &r.port,
			&r.serviceType, &r.appName, &ca.crit, &ca.owner, &ca.method, &env, &mode, &ca.createdAt); err != nil {
			rows.Close()
			return nil, err
		}
		for _, h := range []string{strings.ToLower(r.domain), strings.ToLower(r.ip), hostOf(r.url)} {
			if h != "" && !containsStr(ca.hosts, h) {
				ca.hosts = append(ca.hosts, h)
			}
		}
		if r.kind == "endpoint" || (r.kind == "service" && r.url != "") {
			ca.urlPrefix = urlPrefixOf(r.url)
		}
		ca.validation = EffectiveValidationMode(mode, env, ca.crit)
		byID[r.id] = r
		snap.assets[r.id] = ca
		snap.facts[r.id] = &CoverageFacts{ID: r.id, Criticality: ca.crit}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Policies → cadence and enforced mode.
	if snap.policies, err = d.ListCoveragePolicies(ctx); err != nil {
		return nil, err
	}
	for id, ca := range snap.assets {
		f := snap.facts[id]
		f.CadenceDays = DefaultCadenceDays(ca.crit)
		if p, ok := EffectivePolicy(snap.policies, ca.crit, ca.hosts); ok {
			pp := p
			ca.policy = &pp
			f.CadenceDays = p.CadenceDays
			if ca.validation == "" || p.ValidationMode == ValidationReadOnly {
				ca.validation = p.ValidationMode
			}
		}
		if ca.validation == "" {
			ca.validation = ValidationReadOnly
		}
	}

	// Anchors.
	arows, err := d.QueryContext(ctx, `SELECT ea.asset_id, n.kind, n.state, n.created_at
		FROM exploration_anchors ea JOIN exploration_nodes n ON n.id = ea.node_id`)
	if err != nil {
		return nil, err
	}
	for arows.Next() {
		var id int64
		var kind, state string
		var ts time.Time
		if err := arows.Scan(&id, &kind, &state, &ts); err != nil {
			arows.Close()
			return nil, err
		}
		f, ca := snap.facts[id], snap.assets[id]
		if f == nil {
			continue
		}
		if kind == "intent" || kind == "fact" || kind == "finding" || kind == "hint" {
			ca.anchors++
		}
		if kind == "intent" && state != "open" && state != "deleted" {
			ca.intents++
		}
		if kind == "intent" && state == "exhausted" {
			f.BudgetExhausted = true
		}
		if IsValidationAnchor(kind, state) {
			f.ValidationAnchors++
			f.LastValidated = laterOf(f.LastValidated, ts)
		}
	}
	arows.Close()
	if err := arows.Err(); err != nil {
		return nil, err
	}

	// Scope: asset blocklist + deny rules naming a host.
	blockRules, err := d.ListAssetInterceptRules()
	if err != nil {
		return nil, err
	}
	denyHosts := []string{}
	if rules, err := d.ListInterceptRules(); err == nil {
		for _, r := range rules {
			p := strings.ToLower(strings.TrimSpace(r.Pattern))
			if r.Enabled && r.Action == "deny" && r.MatchType == "string" && strings.Contains(p, ".") && !strings.ContainsAny(p, " \t/") {
				denyHosts = append(denyHosts, p)
			}
		}
	}
	for id, ca := range snap.assets {
		f := snap.facts[id]
		var domains, ips, urls []string
		for _, h := range ca.hosts {
			dd, ii, uu := InterceptCandidatesForTarget(h)
			domains, ips, urls = append(domains, dd...), append(ips, ii...), append(urls, uu...)
		}
		if ca.row.url != "" {
			_, _, uu := InterceptCandidatesForTarget(ca.row.url)
			urls = append(urls, uu...)
		}
		if _, _, hit := MatchAssetInterceptRules(blockRules, domains, ips, urls); hit {
			f.OutOfScope = true
		}
		for _, dh := range denyHosts {
			for _, h := range ca.hosts {
				if h == dh {
					f.OutOfScope = true
				}
			}
		}
	}

	// Pending approvals that hold validation on an asset.
	prows, err := d.QueryContext(ctx, `SELECT tool_input::text FROM intercept_pending WHERE status = 'pending'`)
	if err != nil {
		return nil, err
	}
	var pending []string
	for prows.Next() {
		var s string
		if err := prows.Scan(&s); err == nil {
			pending = append(pending, s)
		}
	}
	prows.Close()

	// Auth/WAF blocks: evidence receipts with 401/403/429, and coverage-ledger follow-ups citing them.
	var blocked []string
	srows, err := d.QueryContext(ctx, `SELECT url FROM traffic_evidence_snapshots WHERE status IN (401,403,429)
		UNION ALL SELECT surface || ' ' || reason FROM coverage_ledger WHERE outcome = 'needs_follow_up'`)
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var s string
		if err := srows.Scan(&s); err == nil {
			blocked = append(blocked, s)
		}
	}
	srows.Close()
	for id, ca := range snap.assets {
		f := snap.facts[id]
		for _, p := range pending {
			// Approvals gate a target host, so a pending request holds validation of the host too.
			if ca.matchesText(p) {
				f.AwaitingApproval = true
				break
			}
		}
		for _, b := range blocked {
			isReceipt := !strings.Contains(b, " ") // a bare URL from a 401/403/429 evidence receipt
			if ca.matchesEvidence(b) && (isReceipt || authWAFReason.MatchString(b)) {
				f.BlockedAuthWAF = true
				break
			}
		}
	}

	_, parentOf := d.assembleFindingAssetNodes(byID)
	for ck, pk := range parentOf {
		c, okc := assetIDFromKey(ck)
		p, okp := assetIDFromKey(pk)
		if okc && okp {
			snap.parent[c] = p
		}
	}
	snap.Results = ClassifyAssetBlindSpots(snap.facts, snap.parent, now)
	return snap, nil
}

// IsValidationAnchor reports whether an anchored node is proof of validation.
func IsValidationAnchor(kind, state string) bool {
	switch kind {
	case "fact", "finding":
		return state == "confirmed"
	case "intent":
		return state == "done"
	}
	return false
}

func containsStr(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

// PersistCoverage writes the snapshot's per-asset coverage columns.
func (d *DB) PersistCoverage(ctx context.Context, snap *CoverageSnapshot) error {
	if len(snap.Results) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(snap.Results))
	for id := range snap.Results {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	states, reasons, dues := make([]string, len(ids)), make([]string, len(ids)), make([]string, len(ids))
	anchors, intents, cadences := make([]int64, len(ids)), make([]int64, len(ids)), make([]int64, len(ids))
	for i, id := range ids {
		r := snap.Results[id]
		states[i], reasons[i] = r.State, r.Reason
		if !r.DueAt.IsZero() {
			dues[i] = r.DueAt.UTC().Format(time.RFC3339Nano)
		}
		anchors[i], intents[i] = int64(snap.assets[id].anchors), int64(snap.assets[id].intents)
		cadences[i] = int64(snap.facts[id].CadenceDays)
	}
	_, err := d.ExecContext(ctx, `UPDATE assets AS a SET
		coverage_state = u.state, blind_spot_reason = NULLIF(u.reason,''), anchor_count = u.anchors,
		intent_anchor_count = u.intents, validation_cadence_days = u.cadence,
		next_validation_due_at = NULLIF(u.due,'')::timestamptz, coverage_computed_at = now()
		FROM unnest($1::bigint[], $2::text[], $3::text[], $4::bigint[], $5::bigint[], $6::bigint[], $7::text[])
		     AS u(id, state, reason, anchors, intents, cadence, due)
		WHERE a.id = u.id`, ids, states, reasons, anchors, intents, cadences, dues)
	return err
}

// ── Summaries ────────────────────────────────────────────────────────────────

// CoverageBucket is a coverage ratio for one group.
type CoverageBucket struct {
	Key        string  `json:"key"`
	InScope    int     `json:"in_scope"`
	Validated  int     `json:"validated"`
	Partial    int     `json:"partially_validated"`
	BlindSpots int     `json:"blind_spots"`
	Stale      int     `json:"stale"`
	Pct        float64 `json:"coverage_pct"`
}

func (b *CoverageBucket) add(state string) {
	if state == CoverageOutOfScope {
		return
	}
	b.InScope++
	switch state {
	case CoverageValidated:
		b.Validated++
	case CoveragePartial:
		b.Partial++
	case CoverageBlindSpot:
		b.BlindSpots++
	case CoverageStale:
		b.Stale++
	}
}

func (b *CoverageBucket) finish() {
	if b.InScope > 0 {
		b.Pct = math.Round(float64(b.Validated)/float64(b.InScope)*1000) / 10
	}
}

// CoverageSummary is GET /api/coverage/summary.
type CoverageSummary struct {
	Overall        CoverageBucket   `json:"overall"`
	Endpoints      CoverageBucket   `json:"endpoints"`
	Tier1          CoverageBucket   `json:"tier1"`
	ByCriticality  []CoverageBucket `json:"by_criticality"`
	ByOwner        []CoverageBucket `json:"by_owner_team"`
	ByParent       []CoverageBucket `json:"by_parent_domain"`
	ByState        map[string]int   `json:"by_state"`
	ByReason       map[string]int   `json:"by_reason"`
	OutOfScope     int              `json:"out_of_scope"`
	PoliciesActive int              `json:"policies_active"`
	ComputedAt     string           `json:"computed_at"`
}

// rootOf returns the top ancestor id of an asset.
func (s *CoverageSnapshot) rootOf(id int64) int64 {
	seen := map[int64]bool{}
	cur := id
	for p, ok := s.parent[cur]; ok && !seen[p]; p, ok = s.parent[cur] {
		seen[cur] = true
		cur = p
	}
	return cur
}

// Label returns the display label of an asset in the snapshot.
func (s *CoverageSnapshot) Label(id int64) string {
	a := s.assets[id]
	if a == nil {
		return ""
	}
	return refLabel(a.row.kind, a.row.domain, a.row.ip, a.row.url, a.method, a.row.appName, a.row.port)
}

// Summary aggregates the snapshot. companyID 0 = all.
func (s *CoverageSnapshot) Summary(companyID int64) *CoverageSummary {
	sum := &CoverageSummary{ByState: map[string]int{}, ByReason: map[string]int{}, ComputedAt: s.Now.UTC().Format(time.RFC3339)}
	sum.Overall.Key, sum.Endpoints.Key, sum.Tier1.Key = "overall", "endpoint", CriticalityTier1
	tiers := map[string]*CoverageBucket{}
	owners := map[string]*CoverageBucket{}
	parents := map[string]*CoverageBucket{}
	get := func(m map[string]*CoverageBucket, k string) *CoverageBucket {
		if m[k] == nil {
			m[k] = &CoverageBucket{Key: k}
		}
		return m[k]
	}
	for id, r := range s.Results {
		a := s.assets[id]
		if companyID > 0 && a.row.companyID != companyID {
			continue
		}
		sum.ByState[r.State]++
		if r.Reason != "" {
			sum.ByReason[r.Reason]++
		}
		if r.State == CoverageOutOfScope {
			sum.OutOfScope++
		}
		sum.Overall.add(r.State)
		if a.row.kind == "endpoint" {
			sum.Endpoints.add(r.State)
		}
		if a.crit == CriticalityTier1 {
			sum.Tier1.add(r.State)
		}
		get(tiers, a.crit).add(r.State)
		get(owners, a.owner).add(r.State)
		get(parents, s.Label(s.rootOf(id))).add(r.State)
	}
	for _, p := range s.policies {
		if p.Enabled {
			sum.PoliciesActive++
		}
	}
	sum.Overall.finish()
	sum.Endpoints.finish()
	sum.Tier1.finish()
	flat := func(m map[string]*CoverageBucket) []CoverageBucket {
		out := make([]CoverageBucket, 0, len(m))
		for _, b := range m {
			b.finish()
			out = append(out, *b)
		}
		sort.Slice(out, func(i, j int) bool {
			if out[i].Pct != out[j].Pct {
				return out[i].Pct < out[j].Pct
			}
			return out[i].Key < out[j].Key
		})
		return out
	}
	sum.ByCriticality = flat(tiers)
	sort.Slice(sum.ByCriticality, func(i, j int) bool { return sum.ByCriticality[i].Key < sum.ByCriticality[j].Key })
	sum.ByOwner = flat(owners)
	sum.ByParent = flat(parents)
	return sum
}

// BlindSpot is one row of GET /api/coverage/blind-spots.
type BlindSpot struct {
	AssetID           int64    `json:"asset_id"`
	Type              string   `json:"type"`
	Label             string   `json:"label"`
	ParentLabel       string   `json:"parent_label,omitempty"`
	RootLabel         string   `json:"root_label,omitempty"`
	CompanyID         int64    `json:"company_id,omitempty"`
	BusinessCrit      string   `json:"business_criticality"`
	OwnerTeam         string   `json:"owner_team"`
	CoverageState     string   `json:"coverage_state"`
	Reason            string   `json:"blind_spot_reason"`
	ValidationMode    string   `json:"validation_mode"`
	CadenceDays       int      `json:"validation_cadence_days"`
	LastValidatedAt   string   `json:"last_validated_at,omitempty"`
	NextDueAt         string   `json:"next_validation_due_at,omitempty"`
	AnchorCount       int      `json:"anchor_count"`
	IntentAnchorCount int      `json:"intent_anchor_count"`
	Action            string   `json:"recommended_action"`
	ActionLabel       string   `json:"recommended_action_label"`
	Validatable       bool     `json:"validatable"`
	NeedsApproval     bool     `json:"needs_approval"`
	Triggers          []string `json:"triggers_fired"`
	Policy            string   `json:"policy,omitempty"`
}

// RecommendedAction maps a reason to the next step.
func RecommendedAction(reason string) (action, label string) {
	switch reason {
	case ReasonNeverTested:
		return "validate", "Run safe read-only validation"
	case ReasonCadence:
		return "validate", "Re-validate: cadence window expired"
	case ReasonBudget:
		return "validate", "Re-run validation with a fresh budget"
	case ReasonAwaitApproval:
		return "review_approval", "Review pending approval"
	case ReasonAuthWAF:
		return "configure_auth", "Configure an auth profile or WAF allow-list"
	case ReasonOutOfScope:
		return "none", "Excluded by scope rules"
	}
	return "validate", "Run safe read-only validation"
}

// BlindSpotFilter narrows BlindSpots.
type BlindSpotFilter struct {
	Reason      string
	Criticality string
	OwnerTeam   string
	CompanyID   int64
	Limit       int
}

var tierRankMap = map[string]int{CriticalityTier1: 0, CriticalityTier2: 1, CriticalityTier3: 2}

// BlindSpots lists assets with a blind-spot reason, highest priority first.
func (s *CoverageSnapshot) BlindSpots(f BlindSpotFilter) []BlindSpot {
	out := []BlindSpot{}
	for id, r := range s.Results {
		if r.Reason == "" {
			continue
		}
		a := s.assets[id]
		if (f.Reason != "" && r.Reason != f.Reason) || (f.Criticality != "" && a.crit != f.Criticality) ||
			(f.OwnerTeam != "" && a.owner != f.OwnerTeam) || (f.CompanyID > 0 && a.row.companyID != f.CompanyID) {
			continue
		}
		act, label := RecommendedAction(r.Reason)
		b := BlindSpot{
			AssetID: id, Type: a.row.kind, Label: s.Label(id), CompanyID: a.row.companyID, BusinessCrit: a.crit,
			OwnerTeam: a.owner, CoverageState: r.State, Reason: r.Reason, ValidationMode: a.validation,
			CadenceDays: s.facts[id].CadenceDays, AnchorCount: a.anchors, IntentAnchorCount: a.intents,
			Action: act, ActionLabel: label, Validatable: act == "validate",
			NeedsApproval: a.crit == CriticalityTier1, Triggers: []string{},
		}
		if p, ok := s.parent[id]; ok {
			b.ParentLabel = s.Label(p)
		}
		if root := s.rootOf(id); root != id {
			b.RootLabel = s.Label(root)
		}
		if lv := s.facts[id].LastValidated; !lv.IsZero() {
			b.LastValidatedAt = lv.UTC().Format(time.RFC3339)
		}
		if !r.DueAt.IsZero() {
			b.NextDueAt = r.DueAt.UTC().Format(time.RFC3339)
		}
		if a.policy != nil {
			b.Policy = a.policy.Name
			for _, t := range a.policy.Triggers {
				switch {
				case t == TriggerCadence && r.Reason == ReasonCadence,
					t == TriggerNewEndpoint && r.Reason == ReasonNeverTested && a.row.kind == "endpoint" &&
						s.Now.Sub(a.createdAt) <= 14*24*time.Hour:
					b.Triggers = append(b.Triggers, t)
				}
			}
		}
		out = append(out, b)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if tierRankMap[a.BusinessCrit] != tierRankMap[b.BusinessCrit] {
			return tierRankMap[a.BusinessCrit] < tierRankMap[b.BusinessCrit]
		}
		if reasonPriority(a.Reason) != reasonPriority(b.Reason) {
			return reasonPriority(a.Reason) < reasonPriority(b.Reason)
		}
		return a.AssetID < b.AssetID
	})
	if f.Limit > 0 && len(out) > f.Limit {
		out = out[:f.Limit]
	}
	return out
}

// AssetCoverage returns the classification and context of one asset.
func (s *CoverageSnapshot) AssetCoverage(id int64) (BlindSpot, bool) {
	r, ok := s.Results[id]
	if !ok {
		return BlindSpot{}, false
	}
	a := s.assets[id]
	act, label := RecommendedAction(r.Reason)
	if r.Reason == "" {
		act, label = "none", "Validated within its cadence window"
	}
	b := BlindSpot{AssetID: id, Type: a.row.kind, Label: s.Label(id), BusinessCrit: a.crit, OwnerTeam: a.owner,
		CoverageState: r.State, Reason: r.Reason, ValidationMode: a.validation, CadenceDays: s.facts[id].CadenceDays,
		AnchorCount: a.anchors, IntentAnchorCount: a.intents, Action: act, ActionLabel: label,
		Validatable: act == "validate", NeedsApproval: a.crit == CriticalityTier1, Triggers: []string{}}
	if a.policy != nil {
		b.Policy = a.policy.Name
	}
	if lv := s.facts[id].LastValidated; !lv.IsZero() {
		b.LastValidatedAt = lv.UTC().Format(time.RFC3339)
	}
	if !r.DueAt.IsZero() {
		b.NextDueAt = r.DueAt.UTC().Format(time.RFC3339)
	}
	return b, true
}

// ── Reverse-anchor provenance ────────────────────────────────────────────────

// AnchorProvenance is one exploration node anchored to an asset.
type AnchorProvenance struct {
	NodeID        int64  `json:"node_id"`
	Kind          string `json:"kind"`
	State         string `json:"state"`
	Summary       string `json:"summary"`
	Validation    bool   `json:"counts_as_validation"`
	ExplorationID int64  `json:"exploration_id"`
	TaskID        int64  `json:"task_id,omitempty"`
	TaskName      string `json:"task_name,omitempty"`
	CreatedAt     string `json:"created_at"`
	CompletedAt   string `json:"completed_at,omitempty"`
}

// AssetAnchors returns every node anchored to an asset, newest first.
func (d *DB) AssetAnchors(ctx context.Context, assetID int64) ([]AnchorProvenance, error) {
	var exists bool
	if err := d.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM assets WHERE id = $1)`, assetID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, sql.ErrNoRows
	}
	rows, err := d.QueryContext(ctx, `SELECT n.id, n.kind, n.state,
		COALESCE(NULLIF(n.payload->>'summary',''), NULLIF(n.payload->>'text',''), NULLIF(n.payload->>'title',''), n.kind),
		n.exploration_id, COALESCE(t.id,0), COALESCE(NULLIF(t.name,''), t.description, ''), n.created_at, n.completed_at
		FROM exploration_anchors ea
		JOIN exploration_nodes n ON n.id = ea.node_id
		LEFT JOIN tasks t ON t.exploration_id = n.exploration_id
		WHERE ea.asset_id = $1
		ORDER BY n.created_at DESC, n.id DESC LIMIT 200`, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AnchorProvenance{}
	for rows.Next() {
		var p AnchorProvenance
		var ts time.Time
		var done sql.NullTime
		if err := rows.Scan(&p.NodeID, &p.Kind, &p.State, &p.Summary, &p.ExplorationID, &p.TaskID, &p.TaskName, &ts, &done); err != nil {
			return nil, err
		}
		p.Validation = IsValidationAnchor(p.Kind, p.State)
		p.CreatedAt = ts.UTC().Format(time.RFC3339)
		if done.Valid {
			p.CompletedAt = done.Time.UTC().Format(time.RFC3339)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ── Validation requests ──────────────────────────────────────────────────────

// CoverageValidationRequest is one row of coverage_validation_requests.
type CoverageValidationRequest struct {
	ID             int64  `json:"id"`
	AssetID        int64  `json:"asset_id"`
	Label          string `json:"label,omitempty"`
	Status         string `json:"status"`
	ValidationMode string `json:"validation_mode"`
	Simulated      bool   `json:"simulated"`
	Reason         string `json:"reason"`
	PendingID      *int64 `json:"pending_id,omitempty"`
	NodeID         *int64 `json:"node_id,omitempty"`
}

// InsertCoverageRequest stores a request row and returns its id.
func (d *DB) InsertCoverageRequest(ctx context.Context, r *CoverageValidationRequest, by string) error {
	return d.QueryRowContext(ctx, `INSERT INTO coverage_validation_requests
		(asset_id, status, validation_mode, simulated, reason, pending_id, node_id, requested_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		r.AssetID, r.Status, r.ValidationMode, r.Simulated, truncate(r.Reason, 1000), r.PendingID, r.NodeID, by).Scan(&r.ID)
}

// UpdateCoverageRequest moves a request to a new status.
func (d *DB) UpdateCoverageRequest(ctx context.Context, id int64, status, reason string, nodeID *int64) error {
	_, err := d.ExecContext(ctx, `UPDATE coverage_validation_requests SET status=$2, reason=$3,
		node_id=COALESCE($4,node_id), updated_at=now() WHERE id=$1`, id, status, truncate(reason, 1000), nodeID)
	return err
}

// HeldCoverageRequests returns requests waiting on an approval, with that approval's status.
func (d *DB) HeldCoverageRequests(ctx context.Context) ([]struct {
	ID, AssetID   int64
	Mode, Pending string
}, error) {
	rows, err := d.QueryContext(ctx, `SELECT r.id, r.asset_id, r.validation_mode, COALESCE(p.status,'pending')
		FROM coverage_validation_requests r LEFT JOIN intercept_pending p ON p.id = r.pending_id
		WHERE r.status = 'held_for_approval'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		ID, AssetID   int64
		Mode, Pending string
	}
	for rows.Next() {
		var x struct {
			ID, AssetID   int64
			Mode, Pending string
		}
		if err := rows.Scan(&x.ID, &x.AssetID, &x.Mode, &x.Pending); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// SimulateSafeValidation records a deterministic, read-only validation of an asset
// (demo / local mode): an intent (done) and a fact (confirmed) in the asset's most
// recent engagement, both anchored to the asset. It returns the fact node id.
func (d *DB) SimulateSafeValidation(ctx context.Context, assetID int64, label, mode string) (int64, error) {
	var expID int64
	err := d.QueryRowContext(ctx, `SELECT t.exploration_id FROM assets a
		JOIN tasks t ON t.id = ANY(a.task_ids) WHERE a.id = $1 AND t.exploration_id IS NOT NULL
		ORDER BY t.id DESC LIMIT 1`, assetID).Scan(&expID)
	if err == sql.ErrNoRows {
		return 0, fmt.Errorf("asset #%d is not linked to any engagement; create a task for it first", assetID)
	} else if err != nil {
		return 0, err
	}
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck
	intentPayload, _ := json.Marshal(map[string]any{
		"summary": fmt.Sprintf("Safe %s of %s (coverage engine)", strings.ReplaceAll(mode, "_", " "), label),
		"origin":  "coverage_engine", "simulated": true,
	})
	factPayload, _ := json.Marshal(map[string]any{
		"summary":    fmt.Sprintf("%s responded to non-mutating probes (GET/HEAD/OPTIONS); no state was changed", label),
		"confidence": "high", "source": "coverage_engine", "provenance": mode, "simulated": true,
	})
	var intentID, factID int64
	if err := tx.QueryRowContext(ctx, `INSERT INTO exploration_nodes (exploration_id, kind, payload, priority, state, origin, completed_at)
		VALUES ($1,'intent',$2::jsonb,0,'done','system',now()) RETURNING id`, expID, string(intentPayload)).Scan(&intentID); err != nil {
		return 0, err
	}
	if err := tx.QueryRowContext(ctx, `INSERT INTO exploration_nodes (exploration_id, kind, payload, priority, state, origin)
		VALUES ($1,'fact',$2::jsonb,0,'confirmed','system') RETURNING id`, expID, string(factPayload)).Scan(&factID); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO exploration_anchors (node_id, asset_id) VALUES ($1,$3),($2,$3)
		ON CONFLICT DO NOTHING`, intentID, factID, assetID); err != nil {
		return 0, err
	}
	return factID, tx.Commit()
}
