package ai_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/golden"
)

// ordered reads a JSON object's members in the order they are written.
func ordered(t *testing.T, raw []byte) (keys []string, values map[string]any) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		t.Fatalf("not an object: %s", raw)
	}
	values = map[string]any{}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			t.Fatal(err)
		}
		var value any
		if err := decoder.Decode(&value); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, key.(string))
		values[key.(string)] = value
	}
	return keys, values
}

func TestSanitizeEventKeepsWhatTheNextJSMonitoringKept(t *testing.T) {
	t.Parallel()
	vectors := golden.LoadAIMonitoring(t)
	if vectors.SchemaVersion != ai.MonitoringSchemaVersion {
		t.Errorf("schema version: %d, the vectors have %d", ai.MonitoringSchemaVersion, vectors.SchemaVersion)
	}
	for _, c := range vectors.Sanitized {
		t.Run(c.Name, func(t *testing.T) {
			var event string
			fields := map[string]any{}
			for key, raw := range c.Input {
				var value any
				if err := json.Unmarshal(raw, &value); err != nil {
					t.Fatal(err)
				}
				if special, ok := value.(map[string]any); ok {
					switch special["number"] {
					case "NaN":
						value = math.NaN()
					case "Infinity":
						value = math.Inf(1)
					case "-Infinity":
						value = math.Inf(-1)
					default:
						if special["undefined"] != true {
							t.Fatalf("%s: a value the test does not know: %s", key, raw)
						}
						continue
					}
				}
				if key == "event" {
					event = value.(string)
					continue
				}
				fields[key] = value
			}
			attrs, ok := ai.SanitizeEvent(event, fields)
			if string(c.Output) == "null" {
				if ok || attrs != nil {
					t.Fatalf("an event that is not ours was kept: %v", attrs)
				}
				return
			}
			if !ok {
				t.Fatal("the event was refused")
			}
			wantKeys, want := ordered(t, c.Output)
			if want["event"] != event || wantKeys[0] != "event" {
				t.Fatalf("the vector's event: %v", want["event"])
			}
			wantKeys = wantKeys[1:]
			delete(want, "event")
			var keys []string
			got := map[string]any{}
			for _, attr := range attrs {
				keys = append(keys, attr.Key)
				got[attr.Key] = attr.Value.Any()
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("fields:\n got %v\nwant %v", got, want)
			}
			if !slices.Equal(keys, wantKeys) {
				t.Errorf("order:\n got %v\nwant %v", keys, wantKeys)
			}
		})
	}
}

// line is a log line of the monitoring.
type line map[string]any

// monitor returns a monitor that writes into lines.
func monitor(environment string) (*ai.Monitor, func(t *testing.T) []line) {
	var out bytes.Buffer
	m := ai.NewMonitor(slog.New(slog.NewJSONHandler(&out, nil)), environment)
	return m, func(t *testing.T) []line {
		t.Helper()
		var lines []line
		for _, text := range strings.Split(strings.TrimSpace(out.String()), "\n") {
			if text == "" {
				continue
			}
			var l line
			if err := json.Unmarshal([]byte(text), &l); err != nil {
				t.Fatalf("not a JSON line: %s", text)
			}
			lines = append(lines, l)
		}
		out.Reset()
		return lines
	}
}

// fields are a line's members that are the event's (not the logger's).
func (l line) fields() map[string]any {
	fields := map[string]any{}
	for key, value := range l {
		switch key {
		case "time", "level", "msg", "ts":
		default:
			fields[key] = value
		}
	}
	return fields
}

func TestTheTypedRecordsBecomeTheEventsOfTheNextJSMonitoring(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadAIMonitoring(t).Helpers {
		t.Run(c.Name, func(t *testing.T) {
			// The vectors were made where NODE_ENV named no environment.
			m, lines := monitor("unknown")
			switch c.Call {
			case "request":
				record := ai.RequestRecord{
					Feature: ai.Feature(c.Args.Feature), Provider: c.Args.Provider, Model: c.Args.Model, Outcome: c.Args.Outcome,
					Reason: c.Args.Reason, Corrected: c.Args.Corrected, Billable: c.Args.Billable,
				}
				if c.Args.LatencyMs != nil {
					latency := time.Duration(*c.Args.LatencyMs * float64(time.Millisecond))
					record.Latency = &latency
				}
				m.RecordRequest(context.Background(), record)
			case "quota":
				m.RecordQuota(context.Background(), ai.Feature(c.Args.Feature), c.Args.Provider, c.Args.Action, c.Args.Reason)
			default:
				t.Fatalf("a call the test does not know: %s", c.Call)
			}
			written := lines(t)
			if len(written) != 1 {
				t.Fatalf("lines: %v", written)
			}
			want := c.Event
			if written[0]["msg"] != want["event"] {
				t.Errorf("message %v, want %v", written[0]["msg"], want["event"])
			}
			delete(want, "event")
			if got := written[0].fields(); !reflect.DeepEqual(got, want) {
				t.Errorf("fields:\n got %v\nwant %v", got, want)
			}
		})
	}
}

func TestAnEventIsAWarningWhenTheCallOrTheRequestDidNotEndWell(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name   string
		event  string
		fields map[string]any
		level  string
	}{
		{"a call that succeeded", ai.EventCall, map[string]any{"success": true, "outcome": "ok"}, "INFO"},
		{"a call that failed", ai.EventCall, map[string]any{"success": false, "outcome": "timeout"}, "WARN"},
		{"a call that does not say", ai.EventCall, map[string]any{"outcome": "timeout"}, "INFO"},
		{"a request that ended well", ai.EventRequest, map[string]any{"outcome": "ok"}, "INFO"},
		{"a replayed request", ai.EventRequest, map[string]any{"outcome": "replay"}, "INFO"},
		{"a request for a feature that is off", ai.EventRequest, map[string]any{"outcome": "disabled"}, "INFO"},
		{"a request answered without the model", ai.EventRequest, map[string]any{"outcome": "fallback"}, "WARN"},
		{"a request the provider failed", ai.EventRequest, map[string]any{"outcome": "ai_unavailable"}, "WARN"},
		{"a request over the quota", ai.EventRequest, map[string]any{"outcome": "quota_exceeded"}, "WARN"},
		{"a request that does not say", ai.EventRequest, map[string]any{}, "WARN"},
		{"a refused charge", ai.EventQuota, map[string]any{"action": "rejected", "outcome": "ai_unavailable", "success": false}, "INFO"},
	} {
		t.Run(c.name, func(t *testing.T) {
			m, lines := monitor("test")
			m.Emit(context.Background(), c.event, c.fields)
			written := lines(t)
			if len(written) != 1 || written[0]["level"] != c.level || written[0]["msg"] != c.event {
				t.Fatalf("lines: %v, want one %s line", written, c.level)
			}
		})
	}
}

func TestTheMonitorWritesNothingItWasNotMadeFor(t *testing.T) {
	t.Parallel()
	m, lines := monitor("production")
	m.At(time.Date(2026, 11, 27, 10, 11, 12, 345_678_000, time.FixedZone("Tashkent", 5*3600)))

	m.Emit(context.Background(), "ai.secret", map[string]any{"feature": "stylist_chat"})
	if written := lines(t); len(written) != 0 {
		t.Fatalf("an event that is not ours was written: %v", written)
	}

	// What a caller passes by mistake does not reach the log, and the
	// caller's fields stay as they were.
	passed := map[string]any{
		"feature": "stylist_chat", "outcome": "ok", "billable": true, "userId": "cmabc123", "prompt": "Qizil ko'ylak bilan nima kiyay?",
		"reason": "the user asked about a red dress", "environment": "Production East", "schemaVersion": 99.0,
	}
	before := len(passed)
	m.Emit(context.Background(), ai.EventRequest, passed)
	written := lines(t)
	if len(written) != 1 {
		t.Fatalf("lines: %v", written)
	}
	want := map[string]any{"feature": "stylist_chat", "outcome": "ok", "billable": true, "environment": "production", "schemaVersion": 2.0}
	if got := written[0].fields(); !reflect.DeepEqual(got, want) {
		t.Errorf("fields:\n got %v\nwant %v", got, want)
	}
	// The time in the form the aggregation of the events reads, in UTC.
	if written[0]["ts"] != "2026-11-27T05:11:12.345Z" {
		t.Errorf("ts: %v", written[0]["ts"])
	}
	if len(passed) != before || passed["environment"] != "Production East" || passed["schemaVersion"] != 99.0 {
		t.Errorf("the caller's fields were changed: %v", passed)
	}

	m.Emit(context.Background(), ai.EventQuota, nil)
	if written := lines(t); len(written) != 1 || !reflect.DeepEqual(written[0].fields(), map[string]any{"environment": "production", "schemaVersion": 2.0}) {
		t.Errorf("an event without fields: %v", written)
	}
}

func TestAProviderCallBecomesACallEvent(t *testing.T) {
	t.Parallel()
	m, lines := monitor("staging")
	in, out, total := 1000.0, 2000.0, 3000.0
	m.RecordCall(context.Background(), ai.CallRecord{
		Feature: ai.StylistChat, Provider: "gemini", Model: "gemini-2.5-flash", Outcome: "ok", Latency: 812*time.Millisecond + 500*time.Microsecond,
		Attempts: 2, Usage: ai.Usage{InputTokens: &in, OutputTokens: &out, TotalTokens: &total},
		Price: &config.AIPrice{InputUSDPerMTok: 0.3, OutputUSDPerMTok: 2.5},
	})
	m.RecordCall(context.Background(), ai.CallRecord{
		Feature: ai.ClothingAnalysis, Provider: "openai", Model: "gpt-5.4-mini", Outcome: string(ai.RateLimited), Latency: 120 * time.Millisecond,
		Attempts: 1, HTTPStatus: 429,
	})
	written := lines(t)
	if len(written) != 2 {
		t.Fatalf("lines: %v", written)
	}
	want := []map[string]any{
		{
			"feature": "stylist_chat", "provider": "gemini", "model": "gemini-2.5-flash", "outcome": "ok", "success": true, "latencyMs": 813.0,
			"attempts": 2.0, "retried": true, "retry": "succeeded", "usageInput": 1000.0, "usageOutput": 2000.0, "usageTotal": 3000.0,
			// 1000 × 0.3 / 1e6 + 2000 × 2.5 / 1e6
			"costUsd": 0.0053, "environment": "staging", "schemaVersion": 2.0,
		},
		{
			"feature": "clothing_analysis", "provider": "openai", "model": "gpt-5.4-mini", "outcome": "rate_limited", "success": false,
			"errorCode": "rate_limited", "httpStatus": 429.0, "latencyMs": 120.0, "attempts": 1.0, "retried": false, "retry": "none",
			"environment": "staging", "schemaVersion": 2.0,
		},
	}
	for i, level := range []string{"INFO", "WARN"} {
		if written[i]["msg"] != ai.EventCall || written[i]["level"] != level {
			t.Errorf("line %d: %v %v", i, written[i]["level"], written[i]["msg"])
		}
		if got := written[i].fields(); !reflect.DeepEqual(got, want[i]) {
			t.Errorf("line %d:\n got %v\nwant %v", i, got, want[i])
		}
	}
}

func TestRolloutBucketsAndDigestsAreThoseOfTheNextJSServer(t *testing.T) {
	t.Parallel()
	for _, user := range golden.LoadAIMonitoring(t).Users {
		if got := ai.RolloutBucket(user.ID); got != user.Bucket {
			t.Errorf("bucket of %q: %d, want %d", user.ID, got, user.Bucket)
		}
		if got := ai.AllowlistDigest(user.ID); got != user.Digest {
			t.Errorf("digest of %q: %s, want %s", user.ID, got, user.Digest)
		}
	}
}

func TestEligibleDecidesAsTheNextJSServerDid(t *testing.T) {
	t.Parallel()
	reasons := map[string]int{}
	for _, c := range golden.LoadAIMonitoring(t).Decisions {
		rollout := config.AIRollout{Stylist: c.Rollout.Stylist, Vision: c.Rollout.Vision, Outfit: c.Rollout.Outfit, Percent: c.Rollout.Percent, Allowlist: map[string]bool{}}
		for _, digest := range c.Rollout.Allowlist {
			rollout.Allowlist[digest] = true
		}
		eligible, reason := ai.Eligible(ai.Feature(c.Feature), c.ID, rollout)
		if eligible != c.Eligible || reason != c.Reason {
			t.Errorf("%q, %s, %s: %t %s, want %t %s", c.ID, c.Rollout.Name, c.Feature, eligible, reason, c.Eligible, c.Reason)
		}
		reasons[reason]++
	}
	for _, reason := range []string{ai.FeatureDisabled, ai.Allowlisted, ai.RolloutSelected, ai.RolloutNotSelected} {
		if reasons[reason] == 0 {
			t.Errorf("no vector ends with %s", reason)
		}
	}
	// The colour profile is computed, not asked of a provider: it has no rollout.
	if eligible, reason := ai.Eligible(ai.ColorAnalysis, "cmabc123", config.AIRollout{Stylist: true, Vision: true, Outfit: true, Percent: 100}); eligible || reason != ai.FeatureDisabled {
		t.Errorf("colour analysis: %t %s", eligible, reason)
	}
}
