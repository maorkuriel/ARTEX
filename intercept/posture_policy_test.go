package intercept

import (
	"testing"

	"github.com/Autumn-27/artex/db"
)

func TestIsMutatingCall(t *testing.T) {
	cases := []struct {
		tool  string
		input string
		want  bool
	}{
		{"WebFetch", `{"url":"https://api.acme.demo.local/v1/orders","method":"GET"}`, false},
		{"WebFetch", `{"url":"https://api.acme.demo.local/v1/orders","method":"post"}`, true},
		{"http_request", `{"url":"https://x","method":"DELETE"}`, true},
		{"http_request", `{"url":"https://x","body":"a=1"}`, true},
		{"Bash", `{"command":"curl -s https://api.acme.demo.local/health"}`, false},
		{"Bash", `{"command":"curl -X POST https://api.acme.demo.local/v1/orders"}`, true},
		{"Bash", `{"command":"curl --request=PUT https://x"}`, true},
		{"Bash", `{"command":"curl -d 'a=1' https://x"}`, true},
		{"Bash", `{"command":"wget --post-data=x https://x"}`, true},
		{"Bash", `{"command":"http POST https://x a=1"}`, true},
		{"Bash", `{"command":"sqlmap -u https://x/?id=1 --batch"}`, true},
		{"Bash", `{"command":"nmap -d -sV 203.0.113.10"}`, false},
		{"Bash", `{"command":"nuclei -u https://x -t http/exposures"}`, false},
		{"Bash", `{"command":"curl -I https://x"}`, false},
	}
	for _, c := range cases {
		got, why := IsMutatingCall(c.tool, []byte(c.input))
		if got != c.want {
			t.Errorf("IsMutatingCall(%s, %s) = %v (%s), want %v", c.tool, c.input, got, why, c.want)
		}
	}
}

func none(int64, string) bool { return false }

func TestDecidePosturePolicyReadOnlyBlocksMutations(t *testing.T) {
	prod := []db.AssetGuardProfile{{ID: 1, Label: "api.acme.demo.local", Criticality: db.CriticalityTier2,
		Environment: "production", EffectiveMode: db.ValidationReadOnly}}
	d := DecidePosturePolicy(prod, true, "HTTP POST request", "", 0, none)
	if d.Action != "deny" || d.Rule != PolicyReadOnly || d.Layer != 1 || d.AssetID != 1 {
		t.Fatalf("mutating call on read-only asset = %+v", d)
	}
	// A prior approval never exempts a read-only block.
	d = DecidePosturePolicy(prod, true, "HTTP POST request", "", 0, func(int64, string) bool { return true })
	if d.Action != "deny" {
		t.Fatalf("approval bypassed read-only: %+v", d)
	}
	// Non-mutating probes are allowed (and audited as classified).
	d = DecidePosturePolicy(prod, false, "", "", 0, none)
	if d.Action != "allow" || d.Rule != PolicyClassified {
		t.Fatalf("GET on read-only asset = %+v", d)
	}
}

func TestDecidePosturePolicyTier1RequiresApproval(t *testing.T) {
	tier1 := []db.AssetGuardProfile{{ID: 7, Label: "billing.acme.demo.local", Criticality: db.CriticalityTier1, EffectiveMode: db.ValidationReadOnly}}
	d := DecidePosturePolicy(tier1, false, "", "", 0, none)
	if d.Action != "ask" || d.Rule != PolicyTier1Approval || d.Layer != 3 || d.AssetID != 7 {
		t.Fatalf("tier-1 read = %+v", d)
	}
	approved := func(id int64, rule string) bool { return id == 7 && rule == PolicyTier1Approval }
	if d := DecidePosturePolicy(tier1, false, "", "", 0, approved); d.Action != "allow" {
		t.Fatalf("approved tier-1 read = %+v", d)
	}
	// Mutation against a Tier-1 (read-only by default) is blocked before any approval.
	if d := DecidePosturePolicy(tier1, true, "HTTP DELETE request", "", 0, approved); d.Action != "deny" || d.Rule != PolicyReadOnly {
		t.Fatalf("tier-1 mutation = %+v", d)
	}
}

func TestDecidePosturePolicyControlledActive(t *testing.T) {
	active := []db.AssetGuardProfile{{ID: 3, Label: "staging.acme.demo.local", Criticality: db.CriticalityTier2,
		Environment: "staging", ValidationMode: db.ValidationControlledActive, EffectiveMode: db.ValidationControlledActive}}
	if d := DecidePosturePolicy(active, false, "", "", 0, none); d.Action != "allow" {
		t.Fatalf("read on controlled-active = %+v", d)
	}
	d := DecidePosturePolicy(active, true, "HTTP POST request", "", 0, none)
	if d.Action != "ask" || d.Rule != PolicyActiveApproval {
		t.Fatalf("mutation crossing into controlled-active = %+v", d)
	}
	if d := DecidePosturePolicy(active, true, "HTTP POST request", "", 0, func(int64, string) bool { return true }); d.Action != "allow" {
		t.Fatalf("approved controlled-active mutation = %+v", d)
	}
}

func TestDecidePosturePolicyBudgetAndLegacy(t *testing.T) {
	// Unclassified targets keep legacy behaviour: no decision at all.
	if d := DecidePosturePolicy(nil, true, "HTTP POST request", "", 0, none); d.Action != "" {
		t.Fatalf("legacy target = %+v", d)
	}
	// The host budget applies to every target, classified or not.
	d := DecidePosturePolicy(nil, false, "", "203.0.113.10", 50, none)
	if d.Action != "deny" || d.Rule != PolicyHostBudget || d.Layer != 2 {
		t.Fatalf("budget = %+v", d)
	}
}
