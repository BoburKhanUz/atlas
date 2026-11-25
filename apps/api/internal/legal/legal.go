// Package legal holds the rules of consent to the legal texts (privacy
// policy and terms of use): which version is current, and which accepted
// versions still count. The texts themselves and the consent endpoint are
// stage B3.
//
// Until the cutover (B7) the constants and the comparison equal the
// TypeScript ones (apps/web/src/lib/legal/version.ts); tests keep them so.
package legal

import (
	"regexp"
	"strconv"
)

const (
	// Version is the version of the texts a user accepts when registering.
	// Format YYYY-MM-DD.N, with "-draft" while counsel has not approved them.
	Version = "2026-11-24.1-draft"

	// MinConsentVersion is the oldest accepted version that still counts. A
	// user whose consents are all older must accept the current texts
	// before using the app.
	MinConsentVersion = "2026-10-17.2-draft"
)

var versionFormat = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})\.(\d+)(-draft)?$`)

// Compare orders two versions: by date, then number, and a draft before the
// final text of the same date and number. ok is false when either is
// malformed.
func Compare(a, b string) (order int, ok bool) {
	pa, pb := versionFormat.FindStringSubmatch(a), versionFormat.FindStringSubmatch(b)
	if pa == nil || pb == nil {
		return 0, false
	}
	if pa[1] != pb[1] {
		if pa[1] < pb[1] {
			return -1, true
		}
		return 1, true
	}
	// As JavaScript compares them: as doubles. Numbers past 2^53 lose their
	// last digits and absurdly long ones are infinite; real versions are
	// small, and both servers must agree on every input.
	na, _ := strconv.ParseFloat(pa[2], 64)
	nb, _ := strconv.ParseFloat(pb[2], 64)
	if na != nb {
		if na < nb {
			return -1, true
		}
		return 1, true
	}
	return final(pa[3]) - final(pb[3]), true
}

func final(draftSuffix string) int {
	if draftSuffix == "" {
		return 1
	}
	return 0
}

// StillValid reports whether a consent to the accepted version still covers
// the current texts. A malformed version never does.
func StillValid(accepted string) bool {
	order, ok := Compare(accepted, MinConsentVersion)
	return ok && order >= 0
}
