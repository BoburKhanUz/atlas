package visionlimit_test

import (
	"testing"

	"lookly/internal/visionlimit"
)

// The limits are the ones the recorded cases hold (testdata/golden/ai-config.json:
// AI_VISION_MAX_SIDE 255 and 2049 refused, 256 and 2048 taken; ai-providers.json:
// a picture of 4194304 bytes sent, 4194305 refused). A change is deliberate: it
// moves those cases too.
func TestTheLimitsAreTheRecordedOnes(t *testing.T) {
	t.Parallel()
	if visionlimit.MaxSide != 2048 || visionlimit.MinConfiguredSide != 256 || visionlimit.MaxBytes != 4194304 {
		t.Fatalf("MaxSide %d, MinConfiguredSide %d, MaxBytes %d", visionlimit.MaxSide, visionlimit.MinConfiguredSide, visionlimit.MaxBytes)
	}
}
