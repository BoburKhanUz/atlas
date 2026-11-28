package aimonitor_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"lookly/internal/ai"
	"lookly/internal/aimonitor"
	"lookly/internal/config"
	"lookly/internal/golden"
)

// sameJSON reports whether got, encoded, is the recorded JSON (as parsed:
// member order and number spelling aside).
func sameJSON(t *testing.T, got any, want json.RawMessage) bool {
	t.Helper()
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var g, w any
	if err := json.Unmarshal(encoded, &g); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(g, w) {
		t.Errorf("got  %s\nwant %s", encoded, want)
		return false
	}
	return true
}

func read(t *testing.T, files []golden.LogFile) []aimonitor.Event {
	var events []aimonitor.Event
	for _, f := range files {
		events = append(events, aimonitor.ParseLogLines(aimonitor.Text(f.Bytes(t)))...)
	}
	return events
}

// Every recorded log set gives the TypeScript monitor's dashboard, alerts,
// Markdown (byte for byte) and exit code. The recording ran with TZ=UTC: a
// date-time without an offset is read in UTC here too.
func TestTheRecordedDashboardsAndAlerts(t *testing.T) {
	t.Parallel()
	m := golden.LoadAIMonitor(t)
	var thresholds aimonitor.Thresholds
	if err := json.Unmarshal(m.Thresholds, &thresholds); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(thresholds, aimonitor.InitialThresholds()) {
		t.Fatalf("the initial thresholds: %+v, recorded %+v", aimonitor.InitialThresholds(), thresholds)
	}
	for _, r := range m.Records {
		t.Run(r.Name, func(t *testing.T) {
			t.Parallel()
			events := read(t, r.Inputs)
			d := aimonitor.Aggregate(events, aimonitor.Range{From: r.Window.From, To: r.Window.To, Location: time.UTC})
			var baseline *aimonitor.Dashboard
			if len(r.Baselines) > 0 {
				b := aimonitor.Aggregate(read(t, r.Baselines), aimonitor.Range{From: r.Baseline.From, To: r.Baseline.To, Location: time.UTC})
				baseline = &b
			}
			alerts := aimonitor.EvaluateAlerts(d, events, aimonitor.InitialThresholds(), baseline)
			if !sameJSON(t, d, r.Dashboard) {
				t.Error("the dashboard differs")
			}
			if baseline != nil && !sameJSON(t, baseline, r.BaselineDashboard) {
				t.Error("the baseline's dashboard differs")
			}
			if !sameJSON(t, alerts, r.Alerts) {
				t.Error("the alerts differ")
			}
			if got := aimonitor.Markdown(d, alerts); got != r.Markdown {
				t.Errorf("the Markdown differs:\n%s\nwant:\n%s", got, r.Markdown)
			}
			if exit := map[bool]int{true: 2, false: 0}[len(alerts) > 0]; exit != r.Exit {
				t.Errorf("exit %d, recorded %d", exit, r.Exit)
			}
		})
	}
}

// The lines the Go server's monitor writes are what the monitor reads: the
// recorded lines (written by ai.Monitor when the golden file was made, read
// by the TypeScript monitor) are what ai.Monitor writes now, apart from the
// time, and the aggregation counts them.
func TestTheGoMonitorsLinesAreRead(t *testing.T) {
	t.Parallel()
	var out bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&out, nil))
	emitLookly(log)
	var recorded []string
	for _, r := range golden.LoadAIMonitor(t).Records {
		if r.Name == "go monitor: the lines lookly writes" {
			for _, s := range r.Inputs[0] {
				recorded = append(recorded, *s.Line)
			}
		}
	}
	emitted := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	if len(emitted) != len(recorded) {
		t.Fatalf("%d lines emitted, %d recorded", len(emitted), len(recorded))
	}
	withoutTime := func(line string) map[string]any {
		var v map[string]any
		if err := json.Unmarshal([]byte(line), &v); err != nil {
			t.Fatal(err)
		}
		delete(v, "time")
		delete(v, "ts")
		return v
	}
	for i := range emitted {
		if g, w := withoutTime(emitted[i]), withoutTime(recorded[i]); !reflect.DeepEqual(g, w) {
			t.Errorf("line %d: %v, recorded %v", i, g, w)
		}
	}

	// What is counted of them, worked out from the calls above.
	d := aimonitor.Aggregate(aimonitor.ParseLogLines(out.String()), aimonitor.Range{})
	if d.Window.Events != 11 || len(d.Calls) != 3 || len(d.Requests) != 2 || len(d.Quota) != 1 {
		t.Fatalf("window %+v, %d call groups, %d request groups, %d quota groups", d.Window, len(d.Calls), len(d.Requests), len(d.Quota))
	}
	byKey := map[string]aimonitor.CallMetrics{}
	for _, c := range d.Calls {
		byKey[c.Feature+"/"+c.Provider+"/"+c.Model] = c
	}
	chat := byKey["stylist_chat/gemini/gemini-2.5-flash"]
	if chat.Calls != 2 || chat.Success != 2 || chat.Retry != (aimonitor.Retries{None: 1, Succeeded: 1}) ||
		*chat.LatencyMs.Max != 812 || *chat.LatencyMs.P50 != 2 || chat.Usage.Calls != 2 || chat.Usage.Input != 1934 || chat.Usage.Output != 321 ||
		*chat.CostUSD != 0.001173 {
		t.Errorf("stylist calls: %+v", chat)
	}
	vision := byKey["clothing_analysis/openai/gpt-5.4-mini"]
	if vision.Calls != 1 || vision.Failure != 1 || vision.ErrorCodes.Get("rate_limited") != 1 || vision.HTTPStatus.Get("429") != 1 ||
		vision.Retry.Failed != 1 || *vision.LatencyMs.P95 != 15000 || vision.Usage.Calls != 0 || vision.CostUSD != nil {
		t.Errorf("vision calls: %+v", vision)
	}
	outfit := byKey["outfit_explanation/gemini/gemini-2.5-flash"]
	if outfit.Timeouts != 1 || *outfit.TimeoutRate != 1 {
		t.Errorf("outfit calls: %+v", outfit)
	}
	q := d.Quota[0]
	if q.Charged != 1 || q.Rejected != 1 || q.Refunded != 1 || q.StoreErrors != 1 || *q.RejectionRate != 0.5 || q.RefundReasons.Get("provider_timeout") != 1 {
		t.Errorf("quota: %+v", q)
	}
	for _, r := range d.Requests {
		if r.Feature == "stylist_chat" && (r.Requests != 2 || r.Outcomes.Get("disabled") != 1 || r.Billable != 1 || r.Reasons.Get("rollout_not_selected") != 1) {
			t.Errorf("stylist requests: %+v", r)
		}
	}
	// The ts lookly writes is read: a window around now holds every line.
	from, to := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339), time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	if w := aimonitor.Aggregate(aimonitor.ParseLogLines(out.String()), aimonitor.Range{From: &from, To: &to}).Window.Events; w != 11 {
		t.Errorf("in the window: %d events", w)
	}
}

// emitLookly writes, through ai.Monitor, the events recorded in the golden
// file's "go monitor" records, and one line that is not an AI event.
func emitLookly(log *slog.Logger) {
	m := ai.NewMonitor(log, "production")
	ctx := context.Background()
	f := func(v float64) *float64 { return &v }
	yes, no := true, false
	lat := func(d time.Duration) *time.Duration { return &d }
	m.RecordCall(ctx, ai.CallRecord{Feature: ai.StylistChat, Provider: "gemini", Model: "gemini-2.5-flash", Outcome: "ok", Latency: 812 * time.Millisecond, Attempts: 1,
		Usage: ai.Usage{InputTokens: f(1234), OutputTokens: f(321), TotalTokens: f(1555)}, Price: &config.AIPrice{InputUSDPerMTok: 0.3, OutputUSDPerMTok: 2.5}})
	m.RecordCall(ctx, ai.CallRecord{Feature: ai.ClothingAnalysis, Provider: "openai", Model: "gpt-5.4-mini", Outcome: "rate_limited", Latency: 15000400 * time.Microsecond, Attempts: 2, HTTPStatus: 429})
	m.RecordCall(ctx, ai.CallRecord{Feature: ai.OutfitExplanation, Provider: "gemini", Model: "gemini-2.5-flash", Outcome: "timeout", Latency: 15 * time.Second, Attempts: 2})
	m.RecordCall(ctx, ai.CallRecord{Feature: ai.StylistChat, Provider: "gemini", Model: "gemini-2.5-flash", Outcome: "ok", Latency: 1500 * time.Microsecond, Attempts: 2, Usage: ai.Usage{InputTokens: f(700)}})
	m.RecordRequest(ctx, ai.RequestRecord{Feature: ai.StylistChat, Provider: "gemini", Model: "gemini-2.5-flash", Outcome: "ok", Corrected: &no, Billable: true, Latency: lat(900 * time.Millisecond)})
	m.RecordRequest(ctx, ai.RequestRecord{Feature: ai.OutfitExplanation, Provider: "gemini", Model: "gemini-2.5-flash", Outcome: "fallback", Reason: "provider_timeout", Corrected: &yes, Latency: lat(15100 * time.Millisecond)})
	m.RecordRequest(ctx, ai.RequestRecord{Feature: ai.StylistChat, Provider: "gemini", Outcome: "disabled", Reason: "rollout_not_selected"})
	m.RecordQuota(ctx, ai.StylistChat, "gemini", "charged", "")
	m.RecordQuota(ctx, ai.StylistChat, "gemini", "refunded", "provider_timeout")
	m.RecordQuota(ctx, ai.StylistChat, "gemini", "rejected", "")
	m.RecordQuota(ctx, ai.StylistChat, "gemini", "store_error", "consume_failed")
	log.Info("request finished", "route", "/api/v1/stylist", "status", 200)
}

// ─── The TypeScript suite's cases (tests/unit/ai/monitoring.test.ts at e57764f) ───

type ev = aimonitor.Event

func call(o ev) ev {
	e := ev{"msg": "ai.call", "ts": "2026-10-06T10:00:00Z", "feature": "stylist_chat", "provider": "gemini", "model": "g1", "outcome": "ok", "success": true, "latencyMs": 100.0, "attempts": 1.0, "retry": "none"}
	for k, v := range o {
		e[k] = v
	}
	return e
}

func fail(code string, o ev) ev {
	e := call(ev{"outcome": code, "success": false, "errorCode": code})
	for k, v := range o {
		e[k] = v
	}
	return e
}

func many(n int, e func() ev) []ev {
	out := make([]ev, n)
	for i := range out {
		out[i] = e()
	}
	return out
}

func concat(parts ...[]ev) []ev {
	var out []ev
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func alerts(events []ev, baseline *aimonitor.Dashboard) []aimonitor.Alert {
	return aimonitor.EvaluateAlerts(aimonitor.Aggregate(events, aimonitor.Range{}), events, aimonitor.InitialThresholds(), baseline)
}

func named(a []aimonitor.Alert, name string) []aimonitor.Alert {
	var out []aimonitor.Alert
	for _, x := range a {
		if x.Name == name {
			out = append(out, x)
		}
	}
	return out
}

func TestPercentileIsNearestRank(t *testing.T) {
	t.Parallel()
	hundred := make([]float64, 100)
	for i := range hundred {
		hundred[i] = float64(i + 1)
	}
	for _, tc := range []struct {
		values []float64
		p      float64
		want   *float64
	}{
		{hundred, 50, ptr(50)}, {hundred, 95, ptr(95)}, {hundred, 99, ptr(99)},
		{[]float64{5, -1, math.NaN(), math.Inf(1)}, 50, ptr(5)},
		{nil, 95, nil},
		{[]float64{3, 1, 2}, 0, ptr(1)}, {[]float64{3, 1, 2}, 100, ptr(3)},
	} {
		got := aimonitor.Percentile(tc.values, tc.p)
		if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) {
			t.Errorf("Percentile(%v, %v) = %v, want %v", tc.values, tc.p, got, tc.want)
		}
	}
	// -0 is a latency of 0, and JSON.stringify writes it as 0.
	if got := aimonitor.Percentile([]float64{math.Copysign(0, -1)}, 50); got == nil || math.Signbit(*got) {
		t.Errorf("Percentile(-0) = %v", got)
	}
}

func ptr(v float64) *float64 { return &v }

func TestCallAggregation(t *testing.T) {
	t.Parallel()
	events := []ev{
		call(ev{"latencyMs": 100.0, "usageInput": 1000.0, "usageOutput": 100.0, "costUsd": 0.001}),
		call(ev{"latencyMs": 300.0, "attempts": 2.0, "retry": "succeeded", "usageInput": 3000.0, "usageOutput": 300.0, "costUsd": 0.003}),
		fail("timeout", ev{"latencyMs": 25_000.0, "attempts": 2.0, "retry": "failed"}),
		fail("unavailable", ev{"latencyMs": 900.0, "httpStatus": 503.0, "attempts": 2.0, "retry": "failed"}),
		call(ev{"provider": "openai", "model": "o1", "latencyMs": 50.0}),
	}
	d := aimonitor.Aggregate(events, aimonitor.Range{})
	g, o := d.Calls[0], d.Calls[1]
	if g.Provider != "gemini" || o.Provider != "openai" {
		t.Fatalf("groups %+v", d.Calls)
	}
	if g.Calls != 4 || g.Success != 2 || g.Failure != 2 || *g.SuccessRate != 0.5 || g.Timeouts != 1 || *g.TimeoutRate != 0.25 ||
		g.ErrorCodes.Keys()[0] != "timeout" || g.ErrorCodes.Get("unavailable") != 1 || g.HTTPStatus.Get("503") != 1 ||
		g.Retry != (aimonitor.Retries{None: 1, Succeeded: 1, Failed: 2}) {
		t.Errorf("gemini: %+v", g)
	}
	if l := g.LatencyMs; *l.P50 != 300 || *l.P95 != 25_000 || *l.P99 != 25_000 || *l.Max != 25_000 {
		t.Errorf("latency %+v", l)
	}
	if u := g.Usage; u.Calls != 2 || u.Input != 4000 || u.Output != 400 || *u.InputP50 != 1000 || *u.InputP95 != 3000 {
		t.Errorf("usage %+v", u)
	}
	if *g.CostUSD != 0.004 {
		t.Errorf("cost %v", *g.CostUSD)
	}
	// Usage and cost not reported stay unknown: never invented.
	if o.Usage.Calls != 0 || o.CostUSD != nil {
		t.Errorf("openai: %+v", o)
	}
}

func TestRequestAndQuotaAggregationInAWindow(t *testing.T) {
	t.Parallel()
	from, to := "2026-10-06T00:00:00Z", "2026-10-06T23:59:59Z"
	d := aimonitor.Aggregate([]ev{
		{"msg": "ai.request", "ts": "2026-10-06T10:00:00Z", "feature": "outfit_explanation", "provider": "openai", "outcome": "ok", "corrected": true, "billable": true, "latencyMs": 800.0},
		{"msg": "ai.request", "ts": "2026-10-06T10:01:00Z", "feature": "outfit_explanation", "provider": "openai", "outcome": "fallback", "reason": "provider_timeout", "billable": false},
		{"msg": "ai.quota", "ts": "2026-10-06T10:00:00Z", "feature": "outfit_explanation", "provider": "openai", "action": "charged"},
		{"msg": "ai.quota", "ts": "2026-10-06T10:01:00Z", "feature": "outfit_explanation", "provider": "openai", "action": "refunded", "reason": "provider_timeout"},
		{"msg": "ai.quota", "ts": "2026-10-06T10:02:00Z", "feature": "outfit_explanation", "provider": "openai", "action": "rejected"},
		{"msg": "ai.quota", "ts": "2026-10-07T00:00:00Z", "feature": "outfit_explanation", "provider": "openai", "action": "charged"}, // outside
		{"msg": "request finished", "ts": "2026-10-06T10:00:00Z"}, // not an AI event
	}, aimonitor.Range{From: &from, To: &to})
	if d.Window.Events != 5 {
		t.Errorf("events %d", d.Window.Events)
	}
	r := d.Requests[0]
	if r.Requests != 2 || r.Outcomes.Get("ok") != 1 || r.Outcomes.Get("fallback") != 1 || r.Reasons.Get("provider_timeout") != 1 || r.Corrected != 1 || r.Billable != 1 {
		t.Errorf("requests %+v", r)
	}
	q := d.Quota[0]
	if q.Charged != 1 || q.Rejected != 1 || q.Refunded != 1 || *q.RejectionRate != 0.5 || q.RefundReasons.Get("provider_timeout") != 1 {
		t.Errorf("quota %+v", q)
	}
}

func TestErrorRateAlert(t *testing.T) {
	t.Parallel()
	at := func(failures, total int, provider string) []aimonitor.Alert {
		events := concat(many(total-failures, func() ev { return call(ev{"provider": provider}) }),
			many(failures, func() ev { return fail("provider_error", ev{"provider": provider}) }))
		return named(alerts(events, nil), aimonitor.AlertErrorRate)
	}
	for _, tc := range []struct {
		name            string
		failures, total int
		provider        string
		severity        string // "" when none fires
	}{
		{"5 %: not above", 2, 40, "gemini", ""},
		{"10 %", 4, 40, "gemini", aimonitor.Warning},
		{"25 %", 10, 40, "gemini", aimonitor.Critical},
		{"below the minimum sample", 10, 19, "gemini", ""},
		{"mock is never alerted", 10, 40, "mock", ""},
	} {
		got := at(tc.failures, tc.total, tc.provider)
		if tc.severity == "" && len(got) != 0 || tc.severity != "" && (len(got) != 1 || got[0].Severity != tc.severity || !got[0].Provisional) {
			t.Errorf("%s: %+v", tc.name, got)
		}
	}
}

func TestTimeoutLatencyAuthAndAvailabilityAlerts(t *testing.T) {
	t.Parallel()
	events := concat(
		many(30, func() ev { return call(ev{"latencyMs": 21_000.0}) }),
		[]ev{fail("timeout", nil), fail("auth", ev{"provider": "openai", "model": "o1"})},
		many(5, func() ev { return fail("unavailable", ev{"provider": "openai", "model": "o1"}) }),
	)
	var got []string
	for _, a := range alerts(events, nil) {
		got = append(got, a.Name+":"+a.Provider+":"+a.Severity)
	}
	want := []string{
		"ai_p95_latency:gemini:warning",
		"ai_provider_auth_or_config:openai:critical",
		"ai_provider_availability:openai:critical",
		"ai_timeout_rate:gemini:warning",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("alerts %v, want %v", got, want)
	}
	for _, tc := range []struct {
		events []ev
		want   map[string]int
	}{
		{events, map[string]int{"gemini": 1, "openai": 6}},
		// A success resets the streak.
		{[]ev{fail("timeout", nil), fail("timeout", nil), call(nil), fail("timeout", nil)}, map[string]int{"gemini": 2}},
	} {
		if _, streaks := aimonitor.FailureStreaks(tc.events); !reflect.DeepEqual(streaks, tc.want) {
			t.Errorf("streaks %v, want %v", streaks, tc.want)
		}
	}
}

func TestQuotaRejectionAndOutfitFallbackAlerts(t *testing.T) {
	t.Parallel()
	q := func(action string) func() ev {
		return func() ev {
			return ev{"msg": "ai.quota", "feature": "stylist_chat", "provider": "gemini", "action": action}
		}
	}
	r := func(outcome, reason string) func() ev {
		return func() ev {
			e := ev{"msg": "ai.request", "feature": "outfit_explanation", "provider": "gemini", "outcome": outcome}
			if reason != "" {
				e["reason"] = reason
			}
			return e
		}
	}
	names := func(events []ev) []string {
		out := []string{}
		for _, a := range alerts(events, nil) {
			out = append(out, a.Name)
		}
		return out
	}
	both := concat(many(17, q("charged")), many(3, q("rejected")), many(18, r("ok", "")), many(3, r("fallback", "provider_timeout")), many(30, r("fallback", "quota_exceeded")))
	if got := names(both); !reflect.DeepEqual(got, []string{"ai_outfit_fallback_rate", "ai_quota_rejection_rate"}) {
		t.Errorf("both: %v", got)
	}
	// Only quota fallbacks (the system's own choice): no outfit alert.
	if got := names(concat(many(25, r("ok", "")), many(30, r("fallback", "quota_exceeded")))); len(got) != 0 {
		t.Errorf("quota fallbacks: %v", got)
	}
	// Requests the rollout kept off AI do not dilute the fallback rate…
	diluted := alerts(concat(many(18, r("ok", "")), many(3, r("fallback", "provider_timeout")), many(200, r("disabled", "rollout_not_selected"))), nil)
	if len(diluted) != 1 || diluted[0].Name != aimonitor.AlertOutfitFallbackRate || math.Abs(diluted[0].Value-3.0/21) > 0.0005 {
		t.Errorf("disabled: %+v", diluted)
	}
	// …and are neither a sample nor a failure.
	if got := names(many(200, r("disabled", "feature_disabled"))); len(got) != 0 {
		t.Errorf("only disabled: %v", got)
	}
}

func TestUsageAnomalyAlert(t *testing.T) {
	t.Parallel()
	base := many(60, func() ev { return call(ev{"usageInput": 100.0, "usageOutput": 10.0}) })
	now := func(k float64) []ev {
		return many(60, func() ev { return call(ev{"usageInput": 100 * k, "usageOutput": 10 * k}) })
	}
	anomaly := func(k float64, b []ev) []aimonitor.Alert {
		baseline := aimonitor.Aggregate(b, aimonitor.Range{})
		return named(alerts(now(k), &baseline), aimonitor.AlertUsageAnomaly)
	}
	if got := anomaly(1, base); len(got) != 0 {
		t.Errorf("same usage: %+v", got)
	}
	if got := anomaly(3, base); len(got) != 1 || got[0].Value != 3 || !got[0].Provisional {
		t.Errorf("three times: %+v", got)
	}
	if got := anomaly(0.3, base); len(got) != 1 {
		t.Errorf("a third: %+v", got)
	}
	if got := anomaly(3, base[:10]); len(got) != 0 { // the baseline is too small
		t.Errorf("small baseline: %+v", got)
	}
}

func TestEveryAlertIsProvisional(t *testing.T) {
	t.Parallel()
	got := alerts(many(30, func() ev { return fail("timeout", nil) }), nil)
	if len(got) == 0 {
		t.Fatal("no alert")
	}
	for _, a := range got {
		if !a.Provisional {
			t.Errorf("%+v", a)
		}
	}
}

func TestOnlyAIJSONLinesAreRead(t *testing.T) {
	t.Parallel()
	text := strings.Join([]string{
		`{"ts":"t","level":"info","msg":"ai.call","feature":"stylist_chat","provider":"gemini","model":"g","success":true}`,
		`not json "ai.call"`,
		`{"msg":"http request","path":"/x"}`,
		`{"msg":"ai.vision.result"}`,
	}, "\n")
	got := aimonitor.ParseLogLines(text)
	if len(got) != 1 || got[0]["msg"] != "ai.call" {
		t.Errorf("%v", got)
	}
}

func TestTheMarkdownDashboard(t *testing.T) {
	t.Parallel()
	md := aimonitor.Markdown(aimonitor.Aggregate([]ev{call(nil), {"msg": "ai.quota", "feature": "stylist_chat", "provider": "gemini", "action": "charged"}}, aimonitor.Range{}), nil)
	for _, want := range []string{"| stylist_chat | gemini | g1 | 1 | 100.0% |", "TO BE CALIBRATED AFTER LIVE BAKE-OFF", "## Alerts\n\n- none"} {
		if !strings.Contains(md, want) {
			t.Errorf("no %q in\n%s", want, md)
		}
	}
}

// The thresholds are a copy: changing one does not change the next.
func TestInitialThresholdsAreACopy(t *testing.T) {
	t.Parallel()
	a := aimonitor.InitialThresholds()
	a.P95LatencyMs["stylist_chat"] = 1
	if aimonitor.InitialThresholds().P95LatencyMs["stylist_chat"] != 20_000 {
		t.Error("the initial thresholds changed")
	}
}

// Any bytes read as a log: valid UTF-8 text, valid input unchanged, and
// no line stops the aggregation or the Markdown.
func FuzzReadingALog(f *testing.F) {
	f.Add([]byte(`{"msg":"ai.call","feature":"st` + "\xff" + `yl` + "\xe2\x82" + `","latencyMs":1e400,"ts":["2026"]}`))
	f.Add([]byte(`{"msg":"ai.quota","action":"refunded","reason":"429","ts":"+275760-09-13T00:00:00Z"}` + "\n" + `{"msg":"ai.request","outcome":"0"}`))
	f.Add([]byte("\ufeff{\"msg\":\"ai.call\"}\r\n\xf0\x9f\x98"))
	f.Fuzz(func(t *testing.T, b []byte) {
		text := aimonitor.Text(b)
		if !utf8.ValidString(text) || (utf8.Valid(b) && text != string(b)) {
			t.Fatalf("Text(%q) = %q", b, text)
		}
		events := aimonitor.ParseLogLines(text)
		from := "2026-10-06T10:00:00Z"
		for _, r := range []aimonitor.Range{{}, {From: &from}, {To: &text}} {
			d := aimonitor.Aggregate(events, r)
			baseline := aimonitor.Aggregate(events, aimonitor.Range{})
			_ = aimonitor.Markdown(d, aimonitor.EvaluateAlerts(d, events, aimonitor.InitialThresholds(), &baseline))
			if _, err := json.Marshal(d); err != nil {
				t.Fatal(err)
			}
		}
	})
}
