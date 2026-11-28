// Package aimonitor is the AI monitoring's dashboard and alert rules over
// the server's log lines (pure: no I/O). Input: the content-free "ai.call",
// "ai.request" and "ai.quota" events (internal/ai/monitoring.go), one JSON
// log line each. Output: a dashboard snapshot and the alerts that fire.
// `lookly ai-monitor` reads the files and prints them (docs/ai/monitoring.md).
//
// It is a port of the Next.js server's monitor (src/lib/ai/monitoring-metrics.ts
// and scripts/ai-monitor.ts, in git history at e57764f) and gives the same
// numbers, order and Markdown (testdata/golden/ai-monitor.json). What that
// takes from JavaScript is in js.go: Math.round, String(number), toFixed,
// localeCompare (for ASCII), Date.parse (for the ISO format) and the order
// Object.entries lists a count's keys in. Deliberately not reproduced:
//   - a count whose key is a member of Object.prototype ("constructor",
//     "__proto__", ...): JavaScript corrupted it ("__proto__" was dropped,
//     "constructor" became text); here it is counted like any other;
//   - Date.parse's fallback forms outside the ISO format (see parseDate);
//   - localeCompare beyond ASCII (see compareLocale).
//
// Every threshold here is INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF.
package aimonitor

import (
	"bytes"
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"time"
)

// The events the monitor reads (internal/ai.EventCall, EventRequest, EventQuota).
const (
	eventCall    = "ai.call"
	eventRequest = "ai.request"
	eventQuota   = "ai.quota"
)

// Event is one decoded log line: its members as encoding/json decodes them
// (numbers are float64; one too large for a float64 is ±Inf, as in
// JavaScript).
type Event map[string]any

func (e Event) msg() string {
	m, _ := e["msg"].(string)
	return m
}

// str is the TypeScript str(): a non-empty string, else the fallback.
func str(v any, fallback string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return fallback
}

// num is the TypeScript num(): a finite number of at least zero.
func num(v any) (float64, bool) {
	f, ok := v.(float64)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 {
		return 0, false
	}
	return f, true
}

// succeeded: success is true, or absent and the outcome is "ok".
func (e Event) succeeded() bool {
	success, present := e["success"]
	return success == true || (!present && e["outcome"] == "ok")
}

// ─── Statistics ─────────────────────────────────────────────────────────────

// Percentile is the nearest-rank percentile of the finite numbers of at
// least zero among values; nil when there are none.
func Percentile(values []float64, p float64) *float64 {
	v := make([]float64, 0, len(values))
	for _, x := range values {
		if !math.IsNaN(x) && !math.IsInf(x, 0) && x >= 0 {
			v = append(v, x)
		}
	}
	if len(v) == 0 {
		return nil
	}
	slices.Sort(v)
	i := int(math.Ceil((p/100)*float64(len(v)))) - 1
	return positiveZero(v[min(len(v)-1, max(0, i))])
}

// positiveZero is &x, with -0 as 0: JSON.stringify writes -0 as 0 (and
// String(-0) is "0"), encoding/json as -0.
func positiveZero(x float64) *float64 {
	if x == 0 {
		x = 0
	}
	return &x
}

// ratio is a/b to four decimals; nil when b is 0.
func ratio(a, b int) *float64 {
	if b == 0 {
		return nil
	}
	r := roundTo(float64(a)/float64(b), 10_000)
	return &r
}

func sum(v []float64) float64 {
	s := 0.0
	for _, x := range v {
		s += x
	}
	return s
}

// ─── Counts ─────────────────────────────────────────────────────────────────

// Counts counts occurrences of codes. Its keys are listed (and encoded) in
// the order Object.entries lists a JavaScript object's: the array indexes
// ("0", "429", "503") first, in numeric order, then the other keys in the
// order they were first counted.
type Counts struct {
	order []string
	n     map[string]int
}

func (c *Counts) inc(k string) {
	if c.n == nil {
		c.n = map[string]int{}
	}
	if _, seen := c.n[k]; !seen {
		c.order = append(c.order, k)
	}
	c.n[k]++
}

// Get is the count of k (0 when never counted).
func (c Counts) Get(k string) int { return c.n[k] }

// Keys are the counted keys in Object.entries order.
func (c Counts) Keys() []string { return jsKeyOrder(c.order) }

// jsKeyOrder is the order Object.entries lists an object's keys in, given
// the order they were added: the array indexes first, in numeric order,
// then the others as they came.
func jsKeyOrder(added []string) []string {
	var indexes, others []string
	for _, k := range added {
		if isArrayIndex(k) {
			indexes = append(indexes, k)
		} else {
			others = append(others, k)
		}
	}
	slices.SortFunc(indexes, func(a, b string) int {
		x, _ := strconv.ParseUint(a, 10, 64)
		y, _ := strconv.ParseUint(b, 10, 64)
		return compareUint(x, y)
	})
	return append(indexes, others...)
}

func compareUint(x, y uint64) int {
	switch {
	case x < y:
		return -1
	case x > y:
		return 1
	}
	return 0
}

// MarshalJSON writes the counts as an object, keys in Keys order.
func (c Counts) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range c.Keys() {
		if i > 0 {
			b.WriteByte(',')
		}
		key, err := marshal(k)
		if err != nil {
			return nil, err
		}
		b.Write(key)
		b.WriteByte(':')
		b.WriteString(strconv.Itoa(c.n[k]))
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// marshal encodes v as JSON without escaping <, > and & (as JSON.stringify).
func marshal(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

// Retries counts the calls by retry: one attempt, retried then ok, retried
// and still failed.
type Retries struct {
	None      int `json:"none"`
	Succeeded int `json:"succeeded"`
	Failed    int `json:"failed"`
}

// CallLatency is a call group's latency (ms); nil when none was recorded.
type CallLatency struct {
	P50 *float64 `json:"p50"`
	P95 *float64 `json:"p95"`
	P99 *float64 `json:"p99"`
	Max *float64 `json:"max"`
}

// Latency is a request group's latency (ms); nil when none was recorded.
type Latency struct {
	P50 *float64 `json:"p50"`
	P95 *float64 `json:"p95"`
	P99 *float64 `json:"p99"`
}

// Usage is the provider-reported token usage: Calls is the number of calls
// that reported any; the totals and percentiles are over those.
type Usage struct {
	Calls     int      `json:"calls"`
	Input     float64  `json:"input"`
	Output    float64  `json:"output"`
	InputP50  *float64 `json:"inputP50"`
	InputP95  *float64 `json:"inputP95"`
	OutputP50 *float64 `json:"outputP50"`
	OutputP95 *float64 `json:"outputP95"`
}

// CallMetrics are the provider calls of one feature, provider and model.
type CallMetrics struct {
	Feature     string      `json:"feature"`
	Provider    string      `json:"provider"`
	Model       string      `json:"model"`
	Calls       int         `json:"calls"`
	Success     int         `json:"success"`
	Failure     int         `json:"failure"`
	SuccessRate *float64    `json:"successRate"`
	Timeouts    int         `json:"timeouts"`
	TimeoutRate *float64    `json:"timeoutRate"`
	ErrorCodes  Counts      `json:"errorCodes"`
	HTTPStatus  Counts      `json:"httpStatus"`
	Retry       Retries     `json:"retry"`
	LatencyMs   CallLatency `json:"latencyMs"`
	Usage       Usage       `json:"usage"`
	// CostUSD is the sum of the estimated costs, to a millionth of a
	// dollar; nil when no call had a configured price.
	CostUSD *float64 `json:"costUsd"`
}

// RequestMetrics are the feature requests of one feature and provider.
type RequestMetrics struct {
	Feature   string  `json:"feature"`
	Provider  string  `json:"provider"`
	Requests  int     `json:"requests"`
	Outcomes  Counts  `json:"outcomes"`
	Reasons   Counts  `json:"reasons"`
	Corrected int     `json:"corrected"`
	Billable  int     `json:"billable"`
	LatencyMs Latency `json:"latencyMs"`
}

// QuotaMetrics are the quota decisions of one feature and provider.
type QuotaMetrics struct {
	Feature     string `json:"feature"`
	Provider    string `json:"provider"`
	Charged     int    `json:"charged"`
	Rejected    int    `json:"rejected"`
	Refunded    int    `json:"refunded"`
	StoreErrors int    `json:"storeErrors"`
	// RejectionRate is rejected / (charged + rejected).
	RejectionRate *float64 `json:"rejectionRate"`
	RefundReasons Counts   `json:"refundReasons"`
}

// Window is the dashboard's time window as given (nil: open) and the
// number of events in it.
type Window struct {
	From   *string `json:"from"`
	To     *string `json:"to"`
	Events int     `json:"events"`
}

// Dashboard is the snapshot of a window's events.
type Dashboard struct {
	Window   Window           `json:"window"`
	Calls    []CallMetrics    `json:"calls"`
	Requests []RequestMetrics `json:"requests"`
	Quota    []QuotaMetrics   `json:"quota"`

	// location reads the window's date-times that have no offset.
	location *time.Location
}

// Range is a time window: From and To are ISO date-times (inclusive; nil:
// open). Location reads a date-time without an offset (JavaScript read it
// as local time); nil is UTC.
type Range struct {
	From, To *string
	Location *time.Location
}

// bound is the JavaScript `from ? Date.parse(from) : fallback`.
func bound(s *string, fallback float64, loc *time.Location) float64 {
	if s == nil || *s == "" {
		return fallback
	}
	if ms, ok := parseDate(*s, loc); ok {
		return ms
	}
	return math.NaN()
}

// InWindow keeps the ai.* events inside the range. An event whose "ts"
// cannot be read counts only when the range is open at both ends.
func InWindow(events []Event, r Range) []Event {
	from := bound(r.From, math.Inf(-1), r.Location)
	to := bound(r.To, math.Inf(1), r.Location)
	var out []Event
	for _, e := range events {
		if m := e.msg(); m != eventCall && m != eventRequest && m != eventQuota {
			continue
		}
		at := math.NaN()
		if ts, present := e["ts"]; truthy(ts, present) {
			if ms, ok := parseDate(jsToString(ts), r.Location); ok {
				at = ms
			}
		}
		if math.IsNaN(at) {
			if r.From == nil && r.To == nil {
				out = append(out, e)
			}
		} else if at >= from && at <= to {
			out = append(out, e)
		}
	}
	return out
}

type callGroup struct {
	m                     CallMetrics
	lat, in, out, costUSD []float64
}

type requestGroup struct {
	m   RequestMetrics
	lat []float64
}

// Aggregate is the dashboard of the events in the range.
func Aggregate(events []Event, r Range) Dashboard {
	selected := InWindow(events, r)
	var calls []*callGroup
	var requests []*requestGroup
	var quota []*QuotaMetrics
	callIndex, requestIndex, quotaIndex := map[string]int{}, map[string]int{}, map[string]int{}

	for _, e := range selected {
		feature, provider := str(e["feature"], "unknown"), str(e["provider"], "unknown")
		switch e.msg() {
		case eventCall:
			model := str(e["model"], "unknown")
			key := feature + "|" + provider + "|" + model
			i, seen := callIndex[key]
			if !seen {
				i = len(calls)
				callIndex[key] = i
				calls = append(calls, &callGroup{m: CallMetrics{Feature: feature, Provider: provider, Model: model}})
			}
			g := calls[i]
			ok := e.succeeded()
			g.m.Calls++
			if ok {
				g.m.Success++
			} else {
				g.m.Failure++
				code, present := e["errorCode"]
				if !present || code == nil {
					code = e["outcome"]
				}
				c := str(code, "error")
				g.m.ErrorCodes.inc(c)
				if c == "timeout" {
					g.m.Timeouts++
				}
			}
			if status, has := num(e["httpStatus"]); has {
				g.m.HTTPStatus.inc(jsNumber(status))
			}
			attempts, has := num(e["attempts"])
			if !has {
				attempts = 1
			}
			switch retry := e["retry"]; {
			case retry == "none" || (retry != "succeeded" && retry != "failed" && attempts <= 1):
				g.m.Retry.None++
			case retry == "succeeded" || (retry != "failed" && ok):
				g.m.Retry.Succeeded++
			default:
				g.m.Retry.Failed++
			}
			if lat, has := num(e["latencyMs"]); has {
				g.lat = append(g.lat, lat)
			}
			in, hasIn := num(e["usageInput"])
			out, hasOut := num(e["usageOutput"])
			if hasIn || hasOut {
				g.m.Usage.Calls++
				if hasIn {
					g.in = append(g.in, in)
				}
				if hasOut {
					g.out = append(g.out, out)
				}
			}
			if cost, has := num(e["costUsd"]); has {
				g.costUSD = append(g.costUSD, cost)
			}
		case eventRequest:
			key := feature + "|" + provider
			i, seen := requestIndex[key]
			if !seen {
				i = len(requests)
				requestIndex[key] = i
				requests = append(requests, &requestGroup{m: RequestMetrics{Feature: feature, Provider: provider}})
			}
			g := requests[i]
			g.m.Requests++
			g.m.Outcomes.inc(str(e["outcome"], "unknown"))
			if reason, isString := e["reason"].(string); isString {
				g.m.Reasons.inc(reason)
			}
			if e["corrected"] == true {
				g.m.Corrected++
			}
			if e["billable"] == true {
				g.m.Billable++
			}
			if lat, has := num(e["latencyMs"]); has {
				g.lat = append(g.lat, lat)
			}
		default: // eventQuota
			key := feature + "|" + provider
			i, seen := quotaIndex[key]
			if !seen {
				i = len(quota)
				quotaIndex[key] = i
				quota = append(quota, &QuotaMetrics{Feature: feature, Provider: provider})
			}
			q := quota[i]
			switch e["action"] {
			case "charged":
				q.Charged++
			case "rejected":
				q.Rejected++
			case "refunded":
				q.Refunded++
				q.RefundReasons.inc(str(e["reason"], "unknown"))
			case "store_error":
				q.StoreErrors++
			}
		}
	}

	d := Dashboard{
		Window:   Window{From: r.From, To: r.To, Events: len(selected)},
		Calls:    make([]CallMetrics, 0, len(calls)),
		Requests: make([]RequestMetrics, 0, len(requests)),
		Quota:    make([]QuotaMetrics, 0, len(quota)),
		location: r.Location,
	}
	for _, g := range calls {
		m := g.m
		m.SuccessRate, m.TimeoutRate = ratio(m.Success, m.Calls), ratio(m.Timeouts, m.Calls)
		m.LatencyMs = CallLatency{P50: Percentile(g.lat, 50), P95: Percentile(g.lat, 95), P99: Percentile(g.lat, 99)}
		if len(g.lat) > 0 {
			m.LatencyMs.Max = positiveZero(slices.Max(g.lat))
		}
		m.Usage.Input, m.Usage.Output = sum(g.in), sum(g.out)
		m.Usage.InputP50, m.Usage.InputP95 = Percentile(g.in, 50), Percentile(g.in, 95)
		m.Usage.OutputP50, m.Usage.OutputP95 = Percentile(g.out, 50), Percentile(g.out, 95)
		if len(g.costUSD) > 0 {
			cost := roundTo(sum(g.costUSD), 1e6)
			m.CostUSD = &cost
		}
		d.Calls = append(d.Calls, m)
	}
	for _, g := range requests {
		m := g.m
		m.LatencyMs = Latency{P50: Percentile(g.lat, 50), P95: Percentile(g.lat, 95), P99: Percentile(g.lat, 99)}
		d.Requests = append(d.Requests, m)
	}
	for _, q := range quota {
		m := *q
		m.RejectionRate = ratio(m.Rejected, m.Charged+m.Rejected)
		d.Quota = append(d.Quota, m)
	}
	// The groups by feature|provider|model in localeCompare order (stable).
	slices.SortStableFunc(d.Calls, func(a, b CallMetrics) int {
		return compareLocale(a.Feature+"|"+a.Provider+"|"+a.Model, b.Feature+"|"+b.Provider+"|"+b.Model)
	})
	slices.SortStableFunc(d.Requests, func(a, b RequestMetrics) int {
		return compareLocale(a.Feature+"|"+a.Provider+"|", b.Feature+"|"+b.Provider+"|")
	})
	slices.SortStableFunc(d.Quota, func(a, b QuotaMetrics) int {
		return compareLocale(a.Feature+"|"+a.Provider+"|", b.Feature+"|"+b.Provider+"|")
	})
	return d
}
