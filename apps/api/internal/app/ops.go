package app

import (
	"fmt"
	"io"
	"strings"

	"lookly/internal/ai"
)

const aiDigestUsage = "usage: lookly ai-digest <user id> [<user id> ...]"

// aiDigest prints the AI_ROLLOUT_ALLOWLIST digest of each user id, one per
// line in argument order and nothing else: the environment holds digests,
// never ids (docs/ai/rollout.md). It reads no configuration.
func aiDigest(args []string, stdout, stderr io.Writer) int {
	var ids []string
	for _, a := range args {
		if id := strings.TrimSpace(a); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		fmt.Fprintln(stderr, aiDigestUsage)
		return exitUsage
	}
	for _, id := range ids {
		if _, err := fmt.Fprintln(stdout, ai.AllowlistDigest(id)); err != nil {
			fmt.Fprintf(stderr, "lookly ai-digest: %v\n", err)
			return exitFailure
		}
	}
	return 0
}
