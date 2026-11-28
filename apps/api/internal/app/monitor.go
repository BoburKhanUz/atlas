package app

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
	"time"

	"lookly/internal/aimonitor"
)

const aiMonitorUsage = "usage: lookly ai-monitor --input=<log file> [--input=<log file> ...] [--from=ISO] [--to=ISO]" +
	" [--baseline=<log file> ...] [--baseline-from=ISO] [--baseline-to=ISO] [--json]"

// exitAlerts is ai-monitor's exit code when an alert fires (for cron).
const exitAlerts = 2

// aiMonitorArgs is the command line of ai-monitor.
type aiMonitorArgs struct {
	inputs, baselines []string
	window, baseline  aimonitor.Range
	json              bool
}

// parseAIMonitorArgs reads the command line. Unlike the Next.js script it
// replaces, it refuses what it would otherwise ignore: an unknown argument,
// a window bound given twice, empty or not an ISO date-time (the script
// read those as an empty window), a baseline window without a baseline.
func parseAIMonitorArgs(args []string, local *time.Location) (aiMonitorArgs, error) {
	a := aiMonitorArgs{window: aimonitor.Range{Location: local}, baseline: aimonitor.Range{Location: local}}
	bounds := map[string]**string{
		"from": &a.window.From, "to": &a.window.To, "baseline-from": &a.baseline.From, "baseline-to": &a.baseline.To,
	}
	for _, arg := range args {
		if arg == "--json" {
			a.json = true
			continue
		}
		name, value, ok := strings.Cut(strings.TrimPrefix(arg, "--"), "=")
		if !ok || !strings.HasPrefix(arg, "--") {
			return a, fmt.Errorf("unknown argument %q", arg)
		}
		switch bound, isBound := bounds[name]; {
		case name == "input" || name == "baseline":
			if value == "" {
				return a, fmt.Errorf("--%s needs a file", name)
			}
			if name == "input" {
				a.inputs = append(a.inputs, value)
			} else {
				a.baselines = append(a.baselines, value)
			}
		case isBound:
			if *bound != nil {
				return a, fmt.Errorf("--%s is given twice", name)
			}
			if !aimonitor.ValidDate(value, local) {
				return a, fmt.Errorf("--%s=%q is not an ISO date-time (like 2026-10-06T10:00:00Z)", name, value)
			}
			*bound = &value
		default:
			return a, fmt.Errorf("unknown argument %q", arg)
		}
	}
	if len(a.inputs) == 0 {
		return a, errors.New("no --input")
	}
	if len(a.baselines) == 0 && (a.baseline.From != nil || a.baseline.To != nil) {
		return a, errors.New("--baseline-from and --baseline-to need --baseline")
	}
	return a, nil
}

// aiMonitor prints the AI monitoring dashboard and the alerts that fire
// for the server's log files (docs/ai/monitoring.md): Markdown, or JSON
// with --json. Exit 2 when an alert fires, 0 when none does, 1 when a file
// cannot be read, 2 for a usage error. It reads only the files given (and
// TZ: a date-time without an offset is local time, as it was).
func aiMonitor(args []string, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	a, err := parseAIMonitorArgs(args, localZone(getenv))
	if err != nil {
		fmt.Fprintf(stderr, "lookly ai-monitor: %v\n%s\n", err, aiMonitorUsage)
		return exitUsage
	}
	events, err := readLogs(a.inputs)
	if err != nil {
		fmt.Fprintf(stderr, "lookly ai-monitor: %v\n", err)
		return exitFailure
	}
	dashboard := aimonitor.Aggregate(events, a.window)
	var baseline *aimonitor.Dashboard
	if len(a.baselines) > 0 {
		baselineEvents, err := readLogs(a.baselines)
		if err != nil {
			fmt.Fprintf(stderr, "lookly ai-monitor: %v\n", err)
			return exitFailure
		}
		b := aimonitor.Aggregate(baselineEvents, a.baseline)
		baseline = &b
	}
	alerts := aimonitor.EvaluateAlerts(dashboard, events, aimonitor.InitialThresholds(), baseline)

	var out bytes.Buffer
	if a.json {
		enc := json.NewEncoder(&out)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", "  ")
		if err := enc.Encode(struct {
			Dashboard aimonitor.Dashboard `json:"dashboard"`
			Alerts    []aimonitor.Alert   `json:"alerts"`
		}{dashboard, alerts}); err != nil {
			fmt.Fprintf(stderr, "lookly ai-monitor: %v\n", err)
			return exitFailure
		}
	} else {
		out.WriteString(aimonitor.Markdown(dashboard, alerts))
	}
	if _, err := stdout.Write(out.Bytes()); err != nil {
		fmt.Fprintf(stderr, "lookly ai-monitor: %v\n", err)
		return exitFailure
	}
	if len(alerts) > 0 {
		return exitAlerts
	}
	return 0
}

// localZone is the time zone TZ names (as the process's local zone is
// found: empty is UTC; one that cannot be loaded leaves the local zone).
func localZone(getenv func(string) (string, bool)) *time.Location {
	tz, ok := getenv("TZ")
	if !ok {
		return time.Local
	}
	tz = strings.TrimPrefix(tz, ":")
	if tz == "" || tz == "UTC" {
		return time.UTC
	}
	if loc, err := time.LoadLocation(tz); err == nil {
		return loc
	}
	return time.Local
}

// readLogs is the AI events of the files, in order, read a line at a time.
func readLogs(paths []string) ([]aimonitor.Event, error) {
	var events []aimonitor.Event
	for _, path := range paths {
		read, err := readLog(path)
		if err != nil {
			var pathErr *fs.PathError
			if errors.As(err, &pathErr) {
				err = pathErr.Err
			}
			return nil, fmt.Errorf("cannot read the log file %s: %w", path, err)
		}
		events = append(events, read...)
	}
	return events, nil
}

func readLog(path string) ([]aimonitor.Event, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var events []aimonitor.Event
	r := bufio.NewReaderSize(f, 1<<16)
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			// A line holds no part of an invalid sequence of another: "\n"
			// ends any, so reading it alone is reading the whole file.
			if e, ok := aimonitor.ParseLine(aimonitor.Text(bytes.TrimSuffix(line, []byte("\n")))); ok {
				events = append(events, e)
			}
		}
		if errors.Is(err, io.EOF) {
			return events, nil
		}
		if err != nil {
			return nil, err
		}
	}
}
