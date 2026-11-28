package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"lookly/internal/app"
	"lookly/internal/golden"
)

// The recorded windows the command refuses where the Next.js script read
// them as an empty window (deliberate: a typing slip must not report
// "nothing happened"). The package reproduces them (internal/aimonitor).
var refusedWindows = map[string]string{
	"window: an empty from":      `--from=""`,
	"window: an unreadable from": `--from="yesterday"`,
}

// monitorFiles writes a record's files and is the command line that reads
// them, as the recording ran it.
func monitorFiles(t *testing.T, inputs, baselines []golden.LogFile, from, to, baseFrom, baseTo *string) []string {
	t.Helper()
	dir := t.TempDir()
	args := []string{"ai-monitor"}
	for prefix, files := range map[string][]golden.LogFile{"input": inputs, "baseline": baselines} {
		for i, f := range files {
			path := filepath.Join(dir, prefix+"-"+strconv.Itoa(i)+".log")
			if err := os.WriteFile(path, f.Bytes(t), 0o600); err != nil {
				t.Fatal(err)
			}
			args = append(args, "--"+prefix+"="+path)
		}
	}
	for name, v := range map[string]*string{"from": from, "to": to, "baseline-from": baseFrom, "baseline-to": baseTo} {
		if v != nil {
			args = append(args, "--"+name+"="+*v)
		}
	}
	return args
}

// lookly ai-monitor prints what the Next.js script printed for every
// recorded log set: the Markdown byte for byte, the JSON's members and
// values, the exit code. The recording ran with TZ=UTC.
func TestAIMonitorPrintsTheRecordedDashboards(t *testing.T) {
	t.Parallel()
	for _, r := range golden.LoadAIMonitor(t).Records {
		t.Run(r.Name, func(t *testing.T) {
			t.Parallel()
			args := monitorFiles(t, r.Inputs, r.Baselines, r.Window.From, r.Window.To, r.Baseline.From, r.Baseline.To)
			utc := env(map[string]string{"TZ": "UTC"})
			var stdout, stderr bytes.Buffer
			code := app.Run(context.Background(), args, utc, &stdout, &stderr)
			if arg, refused := refusedWindows[r.Name]; refused {
				if code != 2 || stdout.Len() != 0 || !strings.Contains(stderr.String(), arg) || !strings.Contains(stderr.String(), "usage: lookly ai-monitor") {
					t.Fatalf("exit %d, stdout %q, stderr %q", code, stdout.String(), stderr.String())
				}
				return
			}
			if code != r.Exit || stderr.Len() != 0 {
				t.Fatalf("exit %d (recorded %d), stderr %q", code, r.Exit, stderr.String())
			}
			if stdout.String() != r.Markdown {
				t.Errorf("Markdown:\n%s\nrecorded:\n%s", stdout.String(), r.Markdown)
			}
			stdout.Reset()
			if code := app.Run(context.Background(), append(args, "--json"), utc, &stdout, &stderr); code != r.Exit || stderr.Len() != 0 {
				t.Fatalf("--json: exit %d, stderr %q", code, stderr.String())
			}
			var got, want any
			if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
				t.Fatalf("--json: %v\n%s", err, stdout.String())
			}
			recorded, err := json.Marshal(map[string]json.RawMessage{"dashboard": r.Dashboard, "alerts": r.Alerts})
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(recorded, &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("--json:\n%s\nrecorded:\n%s", stdout.String(), recorded)
			}
			if !bytes.HasSuffix(stdout.Bytes(), []byte("}\n")) || !bytes.HasPrefix(stdout.Bytes(), []byte("{\n  \"dashboard\": {\n")) {
				t.Errorf("--json is not indented by two spaces: %.40q", stdout.String())
			}
		})
	}
}

func TestAIMonitorRefusesAWrongCommandLine(t *testing.T) {
	t.Parallel()
	log := filepath.Join(t.TempDir(), "server.log")
	if err := os.WriteFile(log, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	in := "--input=" + log
	for _, tc := range []struct {
		args []string
		why  string
	}{
		{nil, "no --input"},
		{[]string{"--json"}, "no --input"},
		{[]string{"--input="}, "--input needs a file"},
		{[]string{"--input", log}, `unknown argument "--input"`},
		{[]string{in, "--baseline="}, "--baseline needs a file"},
		{[]string{in, "--form=2026-10-06"}, `unknown argument "--form=2026-10-06"`},
		{[]string{in, "-json"}, `unknown argument "-json"`},
		{[]string{in, "--json=1"}, `unknown argument "--json=1"`},
		{[]string{in, log}, "unknown argument"},
		{[]string{in, "--from=2026-10-06", "--from=2026-10-07"}, "--from is given twice"},
		{[]string{in, "--to=10/06/2026"}, `--to="10/06/2026" is not an ISO date-time`},
		{[]string{in, "--from="}, `--from="" is not an ISO date-time`},
		{[]string{in, "--baseline-from=2026-10-06"}, "need --baseline"},
		{[]string{in, "--baseline=" + log, "--baseline-to=2026-10-06T25:00:00Z"}, "--baseline-to"},
	} {
		var stdout, stderr bytes.Buffer
		code := app.Run(context.Background(), append([]string{"ai-monitor"}, tc.args...), env(nil), &stdout, &stderr)
		if code != 2 || stdout.Len() != 0 || !strings.Contains(stderr.String(), tc.why) || !strings.Contains(stderr.String(), "usage: lookly ai-monitor --input=<log file>") {
			t.Errorf("%q: exit %d, stdout %q, stderr %q", tc.args, code, stdout.String(), stderr.String())
		}
	}
}

func TestAIMonitorNamesTheFileItCannotRead(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	present := filepath.Join(dir, "server.log")
	if err := os.WriteFile(present, []byte(`{"msg":"ai.call","provider":"gemini","success":true}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(dir, "missing.log")
	for _, tc := range []struct {
		args []string
		file string
		why  string
	}{
		{[]string{"--input=" + present, "--input=" + missing}, missing, "no such file or directory"},
		{[]string{"--input=" + present, "--baseline=" + missing}, missing, "no such file or directory"},
		{[]string{"--input=" + dir}, dir, "is a directory"},
	} {
		var stdout, stderr bytes.Buffer
		code := app.Run(context.Background(), append([]string{"ai-monitor"}, tc.args...), env(nil), &stdout, &stderr)
		if code != 1 || stdout.Len() != 0 || stderr.String() != "lookly ai-monitor: cannot read the log file "+tc.file+": "+tc.why+"\n" {
			t.Errorf("%q: exit %d, stdout %q, stderr %q", tc.args, code, stdout.String(), stderr.String())
		}
	}
}

// Exit 0 when no alert fires, 2 when one does (for cron), in both formats.
func TestAIMonitorExitCode(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	quiet, failing := filepath.Join(dir, "quiet.log"), filepath.Join(dir, "failing.log")
	line := `{"msg":"ai.call","ts":"2026-10-06T10:00:00.000Z","feature":"stylist_chat","provider":"gemini","model":"g1","success":true,"latencyMs":5}` + "\n"
	auth := `{"msg":"ai.call","ts":"2026-10-06T10:00:01.000Z","feature":"stylist_chat","provider":"gemini","model":"g1","success":false,"errorCode":"auth"}` + "\n"
	if err := os.WriteFile(quiet, []byte(line+"not json\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(failing, []byte(line+auth), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		args []string
		code int
		has  string
	}{
		{[]string{"--input=" + quiet}, 0, "## Alerts\n\n- none\n"},
		{[]string{"--input=" + quiet, "--json"}, 0, `"alerts": []`},
		{[]string{"--input=" + failing}, 2, "- **CRITICAL** ai_provider_auth_or_config — gemini / stylist_chat / g1: 1 (threshold 0, provisional)\n"},
		{[]string{"--json", "--input=" + failing}, 2, `"name": "ai_provider_auth_or_config"`},
		// Outside the window, the failure is not counted.
		{[]string{"--input=" + failing, "--to=2026-10-06T10:00:00Z"}, 0, "(1 events)"},
		{[]string{"--input=" + failing, "--to=2026-10-06T15:00:00+05:00"}, 0, "→ 2026-10-06T15:00:00+05:00 (1 events)"},
	} {
		var stdout, stderr bytes.Buffer
		code := app.Run(context.Background(), append([]string{"ai-monitor"}, tc.args...), env(nil), &stdout, &stderr)
		if code != tc.code || stderr.Len() != 0 || !strings.Contains(stdout.String(), tc.has) {
			t.Errorf("%q: exit %d, stdout %q, stderr %q", tc.args, code, stdout.String(), stderr.String())
		}
	}
}

// A date-time without an offset is local time, in the zone TZ names.
func TestAIMonitorReadsLocalTimeInTZ(t *testing.T) {
	t.Parallel()
	log := filepath.Join(t.TempDir(), "server.log")
	if err := os.WriteFile(log, []byte(`{"msg":"ai.call","ts":"2026-10-06T05:30:00Z","provider":"gemini","success":true}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for tz, events := range map[string]string{"UTC": "(0 events)", "Asia/Tashkent": "(1 events)", "": "(0 events)"} {
		var stdout, stderr bytes.Buffer
		args := []string{"ai-monitor", "--input=" + log, "--from=2026-10-06T10:00:00", "--to=2026-10-06T11:00:00"}
		if code := app.Run(context.Background(), args, env(map[string]string{"TZ": tz}), &stdout, &stderr); code != 0 || !strings.Contains(stdout.String(), events) {
			t.Errorf("TZ=%q: exit %d, stdout %q, stderr %q", tz, code, stdout.String(), stderr.String())
		}
	}
}
