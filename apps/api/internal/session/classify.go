// Package session is the refresh-token session protocol
// (docs/architecture/sessions.md), the same one the Next.js API runs on the
// same tables: sessions written by one implementation are read by the other
// until the cutover.
package session

import "time"

// GraceWindow is how long after a rotation the rotated token may be
// presented again and still be a concurrent request, not a theft
// (inclusive: exactly 60 000 ms is within it).
const GraceWindow = 60 * time.Second

// Kind is the outcome of classifying a refresh request.
type Kind string

const (
	Rotate         Kind = "rotate"          // a live token: issue its successor
	Grace          Kind = "grace"           // rotated within the grace window: return the same successor
	Race           Kind = "race"            // rotated, successor unknowable: fail without revoking
	Reuse          Kind = "reuse"           // rotated long ago: treat as theft, end the family
	Expired        Kind = "expired"         // past the session's or the family's limit
	Revoked        Kind = "revoked"         // signed out or revoked
	ClientMismatch Kind = "client_mismatch" // a web token from the mobile client, or the reverse
)

// Decision is what to do with a refresh request.
type Decision struct {
	Kind Kind
	// RevokeFamily: the family is to be marked revoked as part of this
	// outcome (set on Expired).
	RevokeFamily bool
}

// FamilyState is the part of a SessionFamily row the decision depends on.
type FamilyState struct {
	RevokedAt         *time.Time
	AbsoluteExpiresAt time.Time
	ClientType        string
}

// SessionState is the part of a Session row the decision depends on.
type SessionState struct {
	RevokedAt    *time.Time
	ReplacedByID *string
	ExpiresAt    time.Time
	RotatedAt    *time.Time
	// RotatedAtSource is "db" for rotations by this protocol and "legacy"
	// for rows migrated from before it.
	RotatedAtSource *string
}

// Refresh is one refresh request as seen under the family lock.
type Refresh struct {
	At         time.Time // the transaction's start on the database clock
	Family     FamilyState
	Session    SessionState
	ClientType string
	// LegacyCutoverAt is the SystemMarker of that name; needed only for
	// legacy rotated rows.
	LegacyCutoverAt *time.Time
}

// Classify decides a refresh request from database times only. It is pure:
// every boundary is pinned by the golden vectors.
func Classify(r Refresh) Decision {
	f, s := r.Family, r.Session

	if f.RevokedAt != nil {
		return Decision{Kind: Revoked}
	}
	if f.ClientType != r.ClientType {
		return Decision{Kind: ClientMismatch}
	}
	if !r.At.Before(f.AbsoluteExpiresAt) {
		return Decision{Kind: Expired, RevokeFamily: true}
	}

	if s.RevokedAt == nil {
		if !r.At.Before(s.ExpiresAt) {
			return Decision{Kind: Expired, RevokeFamily: true}
		}
		return Decision{Kind: Rotate}
	}

	// Revoked without a successor: signed out or revoked. Nothing to rotate.
	if s.ReplacedByID == nil {
		return Decision{Kind: Revoked}
	}

	// Rotated. Legacy rotation times came from the old servers' own clocks
	// and are never trusted: every legacy rotation happened before the
	// cutover, so at least At − LegacyCutoverAt has passed since.
	if s.RotatedAtSource == nil || *s.RotatedAtSource != "db" || s.RotatedAt == nil {
		if r.LegacyCutoverAt != nil && r.At.Sub(*r.LegacyCutoverAt) > GraceWindow {
			return Decision{Kind: Reuse}
		}
		return Decision{Kind: Race}
	}

	if r.At.Sub(*s.RotatedAt) <= GraceWindow {
		return Decision{Kind: Grace}
	}
	return Decision{Kind: Reuse}
}
