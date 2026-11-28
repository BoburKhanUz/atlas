package golden

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

// AIMonitor is testdata/golden/ai-monitor.json: log files and what the
// Next.js server's monitor (src/lib/ai/monitoring-metrics.ts and
// scripts/ai-monitor.ts at e57764f, run with bun and TZ=UTC) made of them.
// The script that wrote it ran outside the repository (GeneratedBy).
type AIMonitor struct {
	GeneratedBy  string          `json:"generatedBy"`
	SourceCommit string          `json:"sourceCommit"`
	Note         string          `json:"note"`
	Thresholds   json.RawMessage `json:"thresholds"`
	Records      []struct {
		Name      string          `json:"name"`
		Inputs    []LogFile       `json:"inputs"`
		Baselines []LogFile       `json:"baselines"`
		Window    MonitorWindow   `json:"window"`
		Baseline  MonitorWindow   `json:"baselineWindow"`
		Dashboard json.RawMessage `json:"dashboard"`
		// BaselineDashboard is the baseline's (null without one).
		BaselineDashboard json.RawMessage `json:"baselineDashboard"`
		Alerts            json.RawMessage `json:"alerts"`
		// Markdown is the command's output without --json.
		Markdown string `json:"markdown"`
		Exit     int    `json:"exit"`
	} `json:"records"`
	// Collation: strings, and the same sorted with localeCompare (stable).
	Collation struct {
		Input  []string `json:"input"`
		Sorted []string `json:"sorted"`
	} `json:"collation"`
	// Numbers: String(value), value.toFixed(1), Math.round(value).
	Numbers []struct {
		Value  float64 `json:"value"`
		String string  `json:"string"`
		Fixed1 string  `json:"fixed1"`
		Round  float64 `json:"round"`
	} `json:"numbers"`
	// Ratios: Math.round(a / b * 10000) / 10000 (null when b is 0).
	Ratios []struct {
		A     int      `json:"a"`
		B     int      `json:"b"`
		Ratio *float64 `json:"ratio"`
	} `json:"ratios"`
	// Dates: Date.parse(text) in UTC (null: NaN).
	Dates []struct {
		Text string   `json:"text"`
		Ms   *float64 `json:"ms"`
	} `json:"dates"`
}

// MonitorWindow is a --from/--to pair as given (nil: not given).
type MonitorWindow struct {
	From *string `json:"from"`
	To   *string `json:"to"`
}

// LogFile is a log file as segments: a line written Repeat times (each
// with "\n"), raw Text, or Base64 bytes.
type LogFile []struct {
	Line   *string `json:"line"`
	Repeat int     `json:"repeat"`
	Text   *string `json:"text"`
	Base64 *string `json:"base64"`
}

// Bytes is the file's content.
func (f LogFile) Bytes(t testing.TB) []byte {
	t.Helper()
	var b bytes.Buffer
	for _, s := range f {
		switch {
		case s.Line != nil:
			b.WriteString(strings.Repeat(*s.Line+"\n", max(1, s.Repeat)))
		case s.Text != nil:
			b.WriteString(*s.Text)
		case s.Base64 != nil:
			raw, err := base64.StdEncoding.DecodeString(*s.Base64)
			if err != nil {
				t.Fatal(err)
			}
			b.Write(raw)
		default:
			t.Fatal("ai-monitor.json: an empty segment")
		}
	}
	return b.Bytes()
}

// LoadAIMonitor reads the AI monitor vectors.
func LoadAIMonitor(t testing.TB) AIMonitor {
	t.Helper()
	var m AIMonitor
	load(t, "ai-monitor.json", &m)
	if len(m.Records) == 0 || len(m.Collation.Input) == 0 || len(m.Numbers) == 0 || len(m.Ratios) == 0 || len(m.Dates) == 0 || m.SourceCommit != "e57764f" {
		t.Fatal("ai-monitor.json: a section is empty")
	}
	return m
}
