package db

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Guard audit decisions.
const (
	GuardAllowed         = "allowed"
	GuardBlocked         = "blocked"
	GuardHeldForApproval = "held_for_approval"
	GuardApproved        = "approved"
	GuardDenied          = "denied"
)

var validGuardDecision = map[string]bool{
	GuardAllowed: true, GuardBlocked: true, GuardHeldForApproval: true, GuardApproved: true, GuardDenied: true,
}

// GuardAuditEvent is one structured, append-only guardrail decision.
type GuardAuditEvent struct {
	ID            int64  `json:"id"`
	TS            string `json:"timestamp"`
	Actor         string `json:"actor"`
	TaskID        string `json:"task_id,omitempty"`
	ToolName      string `json:"tool_name,omitempty"`
	Target        string `json:"target,omitempty"`
	TargetAssetID *int64 `json:"target_asset_id,omitempty"`
	Layer         int    `json:"layer"`
	PolicyRule    string `json:"policy_rule"`
	Decision      string `json:"decision"`
	Rationale     string `json:"rationale"`
}

// RecordGuardAuditEvent appends one event. Invalid decisions are rejected.
func (d *DB) RecordGuardAuditEvent(ctx context.Context, e GuardAuditEvent) error {
	if !validGuardDecision[e.Decision] {
		return fmt.Errorf("invalid guard decision %q", e.Decision)
	}
	if e.Layer < 1 || e.Layer > 3 {
		e.Layer = 1
	}
	if e.PolicyRule == "" {
		return fmt.Errorf("guard audit event needs a policy_rule")
	}
	_, err := d.ExecContext(ctx, `INSERT INTO guard_audit_events
		(actor, task_id, tool_name, target, target_asset_id, layer, policy_rule, decision, rationale)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		truncate(e.Actor, 200), truncate(e.TaskID, 64), truncate(e.ToolName, 120), truncate(e.Target, 500),
		e.TargetAssetID, e.Layer, truncate(e.PolicyRule, 120), e.Decision, truncate(e.Rationale, 2000))
	return err
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// GuardAuditFilter narrows ListGuardAuditEvents.
type GuardAuditFilter struct {
	TaskID   string
	AssetID  int64
	Decision string
	Layer    int
	Since    time.Time
	Limit    int
}

// ListGuardAuditEvents returns events newest first.
func (d *DB) ListGuardAuditEvents(ctx context.Context, f GuardAuditFilter) ([]GuardAuditEvent, error) {
	where := []string{"true"}
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.TaskID != "" {
		add("task_id = $%d", f.TaskID)
	}
	if f.AssetID > 0 {
		add("target_asset_id = $%d", f.AssetID)
	}
	if f.Decision != "" {
		add("decision = $%d", f.Decision)
	}
	if f.Layer > 0 {
		add("layer = $%d", f.Layer)
	}
	if !f.Since.IsZero() {
		add("ts >= $%d", f.Since)
	}
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := d.QueryContext(ctx, `SELECT id, ts, actor, task_id, tool_name, target, target_asset_id, layer,
		policy_rule, decision, rationale FROM guard_audit_events WHERE `+strings.Join(where, " AND ")+
		fmt.Sprintf(" ORDER BY ts DESC, id DESC LIMIT %d", limit), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GuardAuditEvent{}
	for rows.Next() {
		var e GuardAuditEvent
		var ts time.Time
		if err := rows.Scan(&e.ID, &ts, &e.Actor, &e.TaskID, &e.ToolName, &e.Target, &e.TargetAssetID, &e.Layer,
			&e.PolicyRule, &e.Decision, &e.Rationale); err != nil {
			return nil, err
		}
		e.TS = ts.UTC().Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

// GuardAuditCounts returns decision counts over the last window.
func (d *DB) GuardAuditCounts(ctx context.Context, since time.Time) (map[string]int, error) {
	rows, err := d.QueryContext(ctx, `SELECT decision, COUNT(*) FROM guard_audit_events WHERE ts >= $1 GROUP BY decision`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, rows.Err()
}
