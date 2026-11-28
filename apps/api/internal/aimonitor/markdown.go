package aimonitor

import (
	"strconv"
	"strings"
)

// pct is a rate as a percentage to one decimal, "—" when there is none.
func pct(v *float64) string {
	if v == nil {
		return "—"
	}
	return jsToFixed(*v*100, 1) + "%"
}

// ms is a latency rounded to a millisecond, "—" when there is none.
func ms(v *float64) string {
	if v == nil {
		return "—"
	}
	return jsNumber(roundTo(*v, 1))
}

// entries is the counts as "key:n" pairs separated by spaces.
func entries(c Counts) string {
	keys := c.Keys()
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = k + ":" + strconv.Itoa(c.Get(k))
	}
	return strings.Join(parts, " ")
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

// Markdown is the dashboard and the alerts as the operator reads them.
func Markdown(d Dashboard, alerts []Alert) string {
	from, to := "start", "end"
	if d.Window.From != nil {
		from = *d.Window.From
	}
	if d.Window.To != nil {
		to = *d.Window.To
	}
	lines := []string{
		"# AI monitoring — " + from + " → " + to + " (" + strconv.Itoa(d.Window.Events) + " events)",
		"",
		"Thresholds are INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF.",
		"",
		"## Provider calls (ai.call)",
		"",
		"| feature | provider | model | calls | success | errors | timeouts | retry ok/failed | p50 ms | p95 ms | p99 ms | tokens in/out | cost USD |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
	}
	for _, c := range d.Calls {
		tokens, cost := "n/a", "n/a"
		if c.Usage.Calls > 0 {
			tokens = jsNumber(c.Usage.Input) + "/" + jsNumber(c.Usage.Output)
		}
		if c.CostUSD != nil {
			cost = jsNumber(*c.CostUSD)
		}
		lines = append(lines, row(c.Feature, c.Provider, c.Model, strconv.Itoa(c.Calls), pct(c.SuccessRate), orDash(entries(c.ErrorCodes)),
			pct(c.TimeoutRate), strconv.Itoa(c.Retry.Succeeded)+"/"+strconv.Itoa(c.Retry.Failed),
			ms(c.LatencyMs.P50), ms(c.LatencyMs.P95), ms(c.LatencyMs.P99), tokens, cost))
	}
	lines = append(lines,
		"",
		"## Feature requests (ai.request)",
		"",
		"| feature | provider | requests | outcomes | reasons | corrected | billable | p95 ms |",
		"|---|---|---|---|---|---|---|---|",
	)
	for _, r := range d.Requests {
		lines = append(lines, row(r.Feature, r.Provider, strconv.Itoa(r.Requests), entries(r.Outcomes), orDash(entries(r.Reasons)),
			strconv.Itoa(r.Corrected), strconv.Itoa(r.Billable), ms(r.LatencyMs.P95)))
	}
	lines = append(lines,
		"",
		"## Quota (ai.quota)",
		"",
		"| feature | provider | charged | rejected | refunded | store errors | rejection rate |",
		"|---|---|---|---|---|---|---|",
	)
	for _, q := range d.Quota {
		lines = append(lines, row(q.Feature, q.Provider, strconv.Itoa(q.Charged), strconv.Itoa(q.Rejected), strconv.Itoa(q.Refunded),
			strconv.Itoa(q.StoreErrors), pct(q.RejectionRate)))
	}
	lines = append(lines, "", "## Alerts", "")
	if len(alerts) == 0 {
		lines = append(lines, "- none")
	}
	for _, a := range alerts {
		line := "- **" + strings.ToUpper(a.Severity) + "** " + a.Name + " — " + a.Provider
		if a.Feature != nil && *a.Feature != "" {
			line += " / " + *a.Feature
		}
		if a.Model != nil && *a.Model != "" {
			line += " / " + *a.Model
		}
		lines = append(lines, line+": "+jsNumber(a.Value)+" (threshold "+jsNumber(a.Threshold)+", provisional)")
	}
	return strings.Join(lines, "\n") + "\n"
}

// row is a table row: the cells as they are (a "|" in a code is not escaped,
// as it was not before).
func row(cells ...string) string {
	return "| " + strings.Join(cells, " | ") + " |"
}
