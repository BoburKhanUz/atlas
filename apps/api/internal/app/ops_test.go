package app_test

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"lookly/internal/app"
	"lookly/internal/golden"
)

// lookly ai-digest prints the AI_ROLLOUT_ALLOWLIST form of each user id,
// one per line in argument order, as the Next.js server's script did, and
// nothing else; it reads no configuration.
func TestAIDigestPrintsTheRecordedDigests(t *testing.T) {
	t.Parallel()
	var ids, want []string
	for _, u := range golden.LoadAIMonitoring(t).Users {
		if strings.TrimSpace(u.ID) == "" {
			continue
		}
		ids = append(ids, u.ID)
		want = append(want, u.Digest)
	}
	if len(ids) < 2 {
		t.Fatalf("the recorded users: %d with an id", len(ids))
	}
	var stdout, stderr bytes.Buffer
	code := app.Run(context.Background(), append([]string{"ai-digest"}, ids...), env(nil), &stdout, &stderr)
	if code != 0 || stderr.Len() != 0 {
		t.Fatalf("exit %d, stderr %q", code, stderr.String())
	}
	if got := strings.TrimSuffix(stdout.String(), "\n"); got != strings.Join(want, "\n") {
		t.Fatalf("stdout:\n%s\nwant:\n%s", got, strings.Join(want, "\n"))
	}
	// Blanks around an id are not part of it.
	stdout.Reset()
	if code := app.Run(context.Background(), []string{"ai-digest", "  " + ids[0] + " "}, env(nil), &stdout, &stderr); code != 0 || stdout.String() != want[0]+"\n" {
		t.Errorf("a padded id: exit %d, %q", code, stdout.String())
	}
}

func TestAIDigestNeedsAnID(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{{"ai-digest"}, {"ai-digest", " ", ""}} {
		var stdout, stderr bytes.Buffer
		code := app.Run(context.Background(), args, env(nil), &stdout, &stderr)
		if code != 2 || stdout.Len() != 0 || !strings.Contains(stderr.String(), "usage: lookly ai-digest <user id>") {
			t.Errorf("%q: exit %d, stdout %q, stderr %q", args, code, stdout.String(), stderr.String())
		}
	}
}
