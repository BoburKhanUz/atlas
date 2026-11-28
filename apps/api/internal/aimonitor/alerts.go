package aimonitor

import (
	"bytes"
	"slices"
)

// Thresholds are the alert rules' limits.
type Thresholds struct {
	// MinSample is the fewest events of a group before a rate alert can
	// fire (avoids noise).
	MinSample         int     `json:"minSample"`
	ErrorRateWarning  float64 `json:"errorRateWarning"`
	ErrorRateCritical float64 `json:"errorRateCritical"`
	TimeoutRate       float64 `json:"timeoutRate"`
	// P95LatencyMs is the p95 latency limit per feature (ms): a fraction of
	// the per-attempt timeout budget. A feature not listed has none.
	P95LatencyMs       map[string]float64 `json:"p95LatencyMs"`
	QuotaRejectionRate float64            `json:"quotaRejectionRate"`
	OutfitFallbackRate float64            `json:"outfitFallbackRate"`
	// ConsecutiveFailures of one provider's calls (any feature).
	ConsecutiveFailures int `json:"consecutiveFailures"`
	// UsageAnomalyFactor: usage (tokens, else calls) against the baseline
	// alerts above factor× or below 1/factor.
	UsageAnomalyFactor    float64 `json:"usageAnomalyFactor"`
	UsageBaselineMinCalls int     `json:"usageBaselineMinCalls"`
}

// InitialThresholds are INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF.
// They come only from the configured budgets (timeouts 25 s stylist, 15 s
// vision and outfit) and common starting points; no live provider data
// exists yet.
func InitialThresholds() Thresholds {
	return Thresholds{
		MinSample:             20,
		ErrorRateWarning:      0.05,
		ErrorRateCritical:     0.2,
		TimeoutRate:           0.02,
		P95LatencyMs:          map[string]float64{"stylist_chat": 20_000, "clothing_analysis": 12_000, "outfit_explanation": 12_000},
		QuotaRejectionRate:    0.1,
		OutfitFallbackRate:    0.1,
		ConsecutiveFailures:   5,
		UsageAnomalyFactor:    2,
		UsageBaselineMinCalls: 50,
	}
}

// The alerts' names.
const (
	AlertErrorRate          = "ai_error_rate"
	AlertP95Latency         = "ai_p95_latency"
	AlertTimeoutRate        = "ai_timeout_rate"
	AlertQuotaRejectionRate = "ai_quota_rejection_rate"
	AlertOutfitFallbackRate = "ai_outfit_fallback_rate"
	AlertAvailability       = "ai_provider_availability"
	AlertAuthOrConfig       = "ai_provider_auth_or_config"
	AlertUsageAnomaly       = "ai_usage_anomaly"
)

// The alerts' severities.
const (
	Warning  = "warning"
	Critical = "critical"
)

// Alert is a rule that fires. Feature is nil for the provider-wide rules
// (availability, usage); Model is set for the rules over calls. Every alert
// is provisional: the thresholds are not calibrated.
type Alert struct {
	Name        string
	Severity    string
	Feature     *string
	Provider    string
	Model       *string
	Value       float64
	Threshold   float64
	Provisional bool
}

// MarshalJSON writes the members in the order the TypeScript monitor did
// (it differed by rule).
func (a Alert) MarshalJSON() ([]byte, error) {
	type member struct {
		name  string
		value any
	}
	var members []member
	switch {
	case a.Model != nil:
		members = []member{{"feature", a.Feature}, {"provider", a.Provider}, {"model", a.Model}, {"name", a.Name}, {"severity", a.Severity}}
	case a.Feature != nil:
		members = []member{{"name", a.Name}, {"severity", a.Severity}, {"feature", a.Feature}, {"provider", a.Provider}}
	default:
		members = []member{{"name", a.Name}, {"severity", a.Severity}, {"provider", a.Provider}}
	}
	members = append(members, member{"value", a.Value}, member{"threshold", a.Threshold}, member{"provisional", a.Provisional})
	var b bytes.Buffer
	b.WriteByte('{')
	for i, m := range members {
		if i > 0 {
			b.WriteByte(',')
		}
		v, err := marshal(m.value)
		if err != nil {
			return nil, err
		}
		b.WriteByte('"')
		b.WriteString(m.name)
		b.WriteString(`":`)
		b.Write(v)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// isReal: the mock and the in-process deterministic provider are never
// alerted on (their calls, streaks, outfit requests and usage).
func isReal(provider string) bool { return provider != "mock" && provider != "deterministic" }

// FailureStreaks is the longest run of consecutive failed ai.call events of
// each provider, in event order; the providers in Object.entries order.
func FailureStreaks(events []Event) ([]string, map[string]int) {
	var order []string
	current, longest := map[string]int{}, map[string]int{}
	for _, e := range events {
		if e.msg() != eventCall {
			continue
		}
		p := str(e["provider"], "unknown")
		if _, seen := longest[p]; !seen {
			order = append(order, p)
		}
		if e.succeeded() {
			current[p] = 0
		} else {
			current[p]++
		}
		longest[p] = max(longest[p], current[p])
	}
	return jsKeyOrder(order), longest
}

// EvaluateAlerts is the alerts that fire for the dashboard. events are all
// the events read (the failure streaks are counted over those in the
// dashboard's window); baseline, when not nil, is the dashboard the usage
// is compared with. The alerts are sorted by name, provider and feature.
func EvaluateAlerts(d Dashboard, events []Event, t Thresholds, baseline *Dashboard) []Alert {
	alerts := []Alert{}
	add := func(a Alert) {
		a.Value = roundTo(a.Value, 10_000)
		a.Provisional = true
		alerts = append(alerts, a)
	}
	for _, c := range d.Calls {
		if !isReal(c.Provider) {
			continue
		}
		feature, model := c.Feature, c.Model
		base := Alert{Feature: &feature, Provider: c.Provider, Model: &model}
		if c.Calls >= t.MinSample {
			errorRate := float64(c.Failure) / float64(c.Calls)
			if errorRate > t.ErrorRateCritical {
				add(with(base, AlertErrorRate, Critical, errorRate, t.ErrorRateCritical))
			} else if errorRate > t.ErrorRateWarning {
				add(with(base, AlertErrorRate, Warning, errorRate, t.ErrorRateWarning))
			}
			if orZero(c.TimeoutRate) > t.TimeoutRate {
				add(with(base, AlertTimeoutRate, Warning, *c.TimeoutRate, t.TimeoutRate))
			}
			if limit, has := t.P95LatencyMs[c.Feature]; has && orZero(c.LatencyMs.P95) > limit {
				add(with(base, AlertP95Latency, Warning, *c.LatencyMs.P95, limit))
			}
		}
		if authOrConfig := c.ErrorCodes.Get("auth") + c.ErrorCodes.Get("config"); authOrConfig > 0 {
			add(with(base, AlertAuthOrConfig, Critical, float64(authOrConfig), 0))
		}
	}
	providers, streaks := FailureStreaks(InWindow(events, Range{From: d.Window.From, To: d.Window.To, Location: d.location}))
	for _, p := range providers {
		if isReal(p) && streaks[p] >= t.ConsecutiveFailures {
			add(Alert{Name: AlertAvailability, Severity: Critical, Provider: p, Value: float64(streaks[p]), Threshold: float64(t.ConsecutiveFailures)})
		}
	}
	for _, q := range d.Quota {
		if q.Charged+q.Rejected >= t.MinSample && orZero(q.RejectionRate) > t.QuotaRejectionRate {
			feature := q.Feature
			add(Alert{Name: AlertQuotaRejectionRate, Severity: Warning, Feature: &feature, Provider: q.Provider, Value: *q.RejectionRate, Threshold: t.QuotaRejectionRate})
		}
	}
	for _, r := range d.Requests {
		if r.Feature != "outfit_explanation" || !isReal(r.Provider) {
			continue
		}
		// Fallbacks the system chose on purpose (quota) are not provider
		// problems, and requests the rollout kept off AI (disabled) never
		// reached the provider.
		quotaFallbacks := r.Reasons.Get("quota_exceeded")
		fallbacks := r.Outcomes.Get("fallback") - quotaFallbacks
		relevant := r.Requests - quotaFallbacks - r.Outcomes.Get("disabled")
		if relevant >= t.MinSample && float64(fallbacks)/float64(relevant) > t.OutfitFallbackRate {
			feature := r.Feature
			add(Alert{Name: AlertOutfitFallbackRate, Severity: Warning, Feature: &feature, Provider: r.Provider, Value: float64(fallbacks) / float64(relevant), Threshold: t.OutfitFallbackRate})
		}
	}
	if baseline != nil {
		var providers []string
		seen := map[string]bool{}
		for _, c := range slices.Concat(d.Calls, baseline.Calls) {
			if isReal(c.Provider) && !seen[c.Provider] {
				seen[c.Provider] = true
				providers = append(providers, c.Provider)
			}
		}
		slices.SortFunc(providers, compareUTF16)
		for _, p := range providers {
			_, nowAmount := usageOf(d, p)
			baseCalls, baseAmount := usageOf(*baseline, p)
			if baseCalls < t.UsageBaselineMinCalls || baseAmount == 0 {
				continue
			}
			factor := nowAmount / baseAmount
			if factor > t.UsageAnomalyFactor || factor < 1/t.UsageAnomalyFactor {
				add(Alert{Name: AlertUsageAnomaly, Severity: Warning, Provider: p, Value: roundTo(factor, 1000), Threshold: t.UsageAnomalyFactor})
			}
		}
	}
	slices.SortStableFunc(alerts, func(a, b Alert) int {
		return compareLocale(a.Name+"|"+a.Provider+"|"+deref(a.Feature), b.Name+"|"+b.Provider+"|"+deref(b.Feature))
	})
	return alerts
}

// usageOf is a provider's calls and its usage: its tokens when it reported
// any, else its calls.
func usageOf(d Dashboard, provider string) (calls int, amount float64) {
	tokens := 0.0
	for _, c := range d.Calls {
		if c.Provider == provider {
			tokens = tokens + c.Usage.Input + c.Usage.Output
			calls += c.Calls
		}
	}
	if tokens > 0 {
		return calls, tokens
	}
	return calls, float64(calls)
}

func with(base Alert, name, severity string, value, threshold float64) Alert {
	base.Name, base.Severity, base.Value, base.Threshold = name, severity, value, threshold
	return base
}

func orZero(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
