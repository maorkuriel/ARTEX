package intercept

// Posture-aware guardrails: the hardened three-layer pipeline that every worker
// tool call passes through (guard.applyIntercept calls EvaluatePosture before any
// other rule).
//
//   Layer 1 — deterministic scope & non-destructive policy. A target asset in
//             read_only_validation (explicitly, or by default for production and
//             Tier-1 assets) blocks state-changing calls: HTTP POST/PUT/PATCH/DELETE,
//             request bodies, uploads, and active-exploitation tools.
//   Layer 2 — blast-radius budgets. A per-task, per-target-host request budget
//             (setting guard_host_request_budget, 0 = off) blocks once exhausted.
//   Layer 3 — human-in-the-loop. Any call touching a tier_1_crown_jewel asset, or a
//             state-changing call against a controlled_active_validation asset,
//             is held for approval once per task and asset.
//
// Every decision that involves a classified asset is written to the
// guard_audit_events trail. Unclassified assets (no criticality tier 1, no
// environment, no explicit mode) keep their existing behaviour untouched.

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/Autumn-27/artex/db"
)

// Posture policy rule names (the policy_rule of the audit trail).
const (
	PolicyReadOnly       = "read_only_validation"
	PolicyHostBudget     = "host_request_budget"
	PolicyTier1Approval  = "tier_1_crown_jewel_approval"
	PolicyActiveApproval = "controlled_active_validation_approval"
	PolicyClassified     = "classified_target"

	settingHostRequestBudget = "guard_host_request_budget"
)

// PostureDecision is the outcome of the posture policy for one call.
type PostureDecision struct {
	Action  string // "" (no policy applies) | allow | deny | ask
	Rule    string
	Layer   int
	Reason  string
	AssetID int64
	Target  string
}

var (
	mutatingMethod = regexp.MustCompile(`(?i)^(POST|PUT|PATCH|DELETE)$`)
	// curl/wget/httpie flags and verbs that change server state or send a body.
	shellMutating = regexp.MustCompile(`(?i)(?:^|\s)(?:-X\s*|--request[\s=]+|--method[\s=]+)['"]?(POST|PUT|PATCH|DELETE)\b|` +
		`(?:^|\s)(?:-d|--data(?:-raw|-binary|-urlencode)?|-F|--form|-T|--upload-file|--post-data|--post-file|--body-data)(?:[\s=]|$)|` +
		`(?:^|\s)(?:http|https|xh)\s+(?:--\S+\s+)*(POST|PUT|PATCH|DELETE)\b`)
	// Body/method flags only count on an HTTP client command line (nmap -d is debug, not a body).
	httpClient = regexp.MustCompile(`(?i)(?:^|[\s/;|&(])(curl|wget|http|https|xh)(?:\s|$)`)
	// Active-exploitation tools that send state-changing or destructive payloads by design.
	activeTools = regexp.MustCompile(`(?i)(?:^|[\s/;|&(])(sqlmap|commix|hydra|medusa|patator|ncrack|metasploit|msfconsole|msfvenom|xsstrike|nosqlmap|wpscan\s+.*--passwords)\b`)
)

// IsMutatingCall reports whether a tool call is state-changing, with a short reason.
func IsMutatingCall(toolName string, input []byte) (bool, string) {
	var in map[string]any
	_ = json.Unmarshal(input, &in)
	if m, ok := in["method"].(string); ok && mutatingMethod.MatchString(strings.TrimSpace(m)) {
		return true, "HTTP " + strings.ToUpper(strings.TrimSpace(m)) + " request"
	}
	for _, k := range []string{"body", "data", "json", "form"} {
		if v, ok := in[k]; ok && v != nil && v != "" {
			return true, "request carries a " + k + " payload"
		}
	}
	text := ""
	for _, k := range []string{"command", "text", "cmd", "script"} {
		if s, ok := in[k].(string); ok {
			text += " " + s
		}
	}
	if text == "" && toolName != "" {
		return false, ""
	}
	if m := activeTools.FindStringSubmatch(text); m != nil {
		return true, "active exploitation tool " + strings.ToLower(m[1])
	}
	if !httpClient.MatchString(text) {
		return false, ""
	}
	if m := shellMutating.FindStringSubmatch(text); m != nil {
		for _, g := range m[1:] {
			if g != "" {
				return true, "HTTP " + strings.ToUpper(g) + " request"
			}
		}
		return true, "request with a body or upload"
	}
	return false, ""
}

// DecidePosturePolicy applies the three layers to the classified assets a call
// targets. approved reports a prior approval of (asset, rule) within this task;
// overBudget reports an exhausted host budget for a host (empty = none). Pure.
func DecidePosturePolicy(profiles []db.AssetGuardProfile, mutating bool, mutReason, overBudgetHost string, budget int,
	approved func(assetID int64, rule string) bool,
) PostureDecision {
	if len(profiles) == 0 {
		if overBudgetHost != "" {
			return PostureDecision{Action: "deny", Rule: PolicyHostBudget, Layer: 2, Target: overBudgetHost,
				Reason: fmt.Sprintf("request budget for %s exhausted (%d requests per task)", overBudgetHost, budget)}
		}
		return PostureDecision{}
	}
	// Layer 1: read-only validation blocks state-changing calls, no exemption by approval.
	if mutating {
		for _, p := range profiles {
			if p.EffectiveMode == db.ValidationReadOnly {
				why := "production"
				if p.Criticality == db.CriticalityTier1 {
					why = "Tier-1 crown jewel"
				}
				if p.ValidationMode == db.ValidationReadOnly {
					why = "explicit read-only policy"
				}
				return PostureDecision{Action: "deny", Rule: PolicyReadOnly, Layer: 1, AssetID: p.ID, Target: p.Label,
					Reason: fmt.Sprintf("%s blocked: %s is in read_only_validation (%s); only GET/HEAD/OPTIONS and non-mutating probes are allowed",
						mutReason, p.Label, why)}
			}
		}
	}
	// Layer 2: blast-radius budget.
	if overBudgetHost != "" {
		return PostureDecision{Action: "deny", Rule: PolicyHostBudget, Layer: 2, Target: overBudgetHost, AssetID: profiles[0].ID,
			Reason: fmt.Sprintf("request budget for %s exhausted (%d requests per task)", overBudgetHost, budget)}
	}
	// Layer 3: human approval for crown jewels and for crossing into active validation.
	for _, p := range profiles {
		if p.Criticality == db.CriticalityTier1 && !approved(p.ID, PolicyTier1Approval) {
			return PostureDecision{Action: "ask", Rule: PolicyTier1Approval, Layer: 3, AssetID: p.ID, Target: p.Label,
				Reason: fmt.Sprintf("%s is a Tier-1 crown-jewel asset: a human must approve validation against it", p.Label)}
		}
	}
	if mutating {
		for _, p := range profiles {
			if p.EffectiveMode == db.ValidationControlledActive && !approved(p.ID, PolicyActiveApproval) {
				return PostureDecision{Action: "ask", Rule: PolicyActiveApproval, Layer: 3, AssetID: p.ID, Target: p.Label,
					Reason: fmt.Sprintf("%s against %s crosses into controlled_active_validation: approve bounded state testing", mutReason, p.Label)}
			}
		}
	}
	return PostureDecision{Action: "allow", Rule: PolicyClassified, Layer: 1, AssetID: profiles[0].ID, Target: profiles[0].Label,
		Reason: "within the asset's validation policy"}
}

// postureState holds per-task approvals and host request counters.
type postureState struct {
	mu       sync.Mutex
	approved map[string]bool // task|asset|rule
	requests map[string]int  // task|host
}

var postureStates sync.Map // *Interceptor → *postureState

func (i *Interceptor) posture() *postureState {
	v, _ := postureStates.LoadOrStore(i, &postureState{approved: map[string]bool{}, requests: map[string]int{}})
	return v.(*postureState)
}

// HostBudgetState is one row of the budget state endpoint.
type HostBudgetState struct {
	TaskID   string `json:"task_id"`
	Host     string `json:"host"`
	Requests int    `json:"requests"`
	Budget   int    `json:"budget"`
	Blocked  bool   `json:"blocked"`
}

// HostRequestBudget returns the configured per-task, per-host request budget (0 = off).
func (i *Interceptor) HostRequestBudget() int {
	if i.db == nil {
		return 0
	}
	v, ok, err := i.db.GetSetting(settingHostRequestBudget)
	if err != nil || !ok {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// BudgetState lists the host counters of the current process.
func (i *Interceptor) BudgetState() []HostBudgetState {
	budget := i.HostRequestBudget()
	st := i.posture()
	st.mu.Lock()
	defer st.mu.Unlock()
	out := make([]HostBudgetState, 0, len(st.requests))
	for k, n := range st.requests {
		task, host, _ := strings.Cut(k, "|")
		out = append(out, HostBudgetState{TaskID: task, Host: host, Requests: n, Budget: budget, Blocked: budget > 0 && n >= budget})
	}
	return out
}

// EvaluatePosture runs the posture policy for one worker call and counts it
// against the host budget when it is allowed to proceed. It returns an empty
// Action when no classified asset or budget applies.
func (i *Interceptor) EvaluatePosture(ctx context.Context, toolName string, input []byte) PostureDecision {
	if i.db == nil {
		return PostureDecision{}
	}
	targets := ExtractTargets(toolName, input)
	if len(targets) == 0 {
		return PostureDecision{}
	}
	hosts := make([]string, 0, len(targets))
	seen := map[string]bool{}
	for _, t := range targets {
		if t.Kind == "cidr" || seen[t.Host] {
			continue
		}
		seen[t.Host] = true
		hosts = append(hosts, t.Host)
	}
	profiles, err := i.db.AssetGuardProfiles(ctx, hosts)
	if err != nil {
		// Fail closed for classified data we cannot read: hold rather than run blind.
		return PostureDecision{Action: "ask", Rule: PolicyClassified, Layer: 1,
			Reason: "asset policy store unreadable; approval required"}
	}
	taskID, _ := taskInfoFromCtx(ctx)
	budget := i.HostRequestBudget()
	st := i.posture()
	overHost := ""
	if budget > 0 {
		st.mu.Lock()
		for _, h := range hosts {
			if st.requests[taskID+"|"+h] >= budget {
				overHost = h
				break
			}
		}
		st.mu.Unlock()
	}
	mut, why := IsMutatingCall(toolName, input)
	dec := DecidePosturePolicy(profiles, mut, why, overHost, budget, func(assetID int64, rule string) bool {
		st.mu.Lock()
		defer st.mu.Unlock()
		return st.approved[fmt.Sprintf("%s|%d|%s", taskID, assetID, rule)]
	})
	if dec.Action == "" || dec.Action == "allow" {
		if budget > 0 {
			st.mu.Lock()
			for _, h := range hosts {
				st.requests[taskID+"|"+h]++
			}
			st.mu.Unlock()
		}
	}
	return dec
}

// MarkPostureApproved records a human approval of (asset, rule) for the task in ctx.
func (i *Interceptor) MarkPostureApproved(ctx context.Context, assetID int64, rule string) {
	taskID, _ := taskInfoFromCtx(ctx)
	st := i.posture()
	st.mu.Lock()
	st.approved[fmt.Sprintf("%s|%d|%s", taskID, assetID, rule)] = true
	st.mu.Unlock()
}

// RecordGuard appends one guard audit event for the call in ctx. Failures are
// logged by the caller's store and never change the decision.
func (i *Interceptor) RecordGuard(ctx context.Context, toolName string, dec PostureDecision, decision string) {
	if i.db == nil {
		return
	}
	taskID, agent := taskInfoFromCtx(ctx)
	ev := db.GuardAuditEvent{
		Actor: agent, TaskID: taskID, ToolName: toolName, Target: dec.Target,
		Layer: dec.Layer, PolicyRule: dec.Rule, Decision: decision, Rationale: dec.Reason,
	}
	if ev.Actor == "" {
		ev.Actor = "worker"
	}
	if dec.AssetID > 0 {
		id := dec.AssetID
		ev.TargetAssetID = &id
	}
	_ = i.db.RecordGuardAuditEvent(context.WithoutCancel(ctx), ev)
}

// PostureAskDecision turns a posture "ask" into an intercept decision for HandleAsk.
func PostureAskDecision(dec PostureDecision) Decision {
	return Decision{
		Action:         "ask",
		RuleName:       "posture:" + dec.Rule,
		Message:        dec.Reason,
		TimeoutEnabled: true,
		TimeoutSeconds: 600,
		TimeoutAction:  "deny",
	}
}
