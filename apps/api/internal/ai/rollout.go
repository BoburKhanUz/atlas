package ai

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"

	"lookly/internal/config"
)

// The namespaces of the rollout's hashes. A new bucket namespace would
// reshuffle every user's bucket.
const (
	rolloutBucketNamespace = "atlas-ai-rollout:v1:"
	allowlistNamespace     = "atlas-ai-allowlist:v1:"
)

// Why a user gets, or does not get, an AI feature.
const (
	FeatureDisabled    = "feature_disabled"
	Allowlisted        = "allowlisted"
	RolloutSelected    = "rollout_selected"
	RolloutNotSelected = "rollout_not_selected"
)

// RolloutBucket is a user's stable bucket, 0 to 99: the same id is always
// in the same bucket.
func RolloutBucket(userID string) int {
	sum := sha256.Sum256([]byte(rolloutBucketNamespace + userID))
	return int(binary.BigEndian.Uint32(sum[:4]) % 100)
}

// AllowlistDigest is the form of a user id that AI_ROLLOUT_ALLOWLIST
// holds: never the id itself.
func AllowlistDigest(userID string) string {
	sum := sha256.Sum256([]byte(allowlistNamespace + userID))
	return hex.EncodeToString(sum[:])
}

// Eligible decides whether a user gets a feature with its real provider
// (StylistChat, ClothingAnalysis or OutfitExplanation): the feature's
// switch, then the allowlist, then the user's bucket against the
// percentage. It selects no provider and relaxes no other check: quotas,
// validation and monitoring apply to an eligible user as to any. The user
// id is only hashed; the reason is a fixed code.
func Eligible(feature Feature, userID string, rollout config.AIRollout) (bool, string) {
	on := map[Feature]bool{StylistChat: rollout.Stylist, ClothingAnalysis: rollout.Vision, OutfitExplanation: rollout.Outfit}[feature]
	switch {
	case !on:
		return false, FeatureDisabled
	case rollout.Allowlist[AllowlistDigest(userID)]:
		return true, Allowlisted
	case RolloutBucket(userID) < rollout.Percent:
		return true, RolloutSelected
	}
	return false, RolloutNotSelected
}
