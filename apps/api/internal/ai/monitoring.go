package ai

import (
	"context"
	"encoding/json"
	"log/slog"
	"maps"
	"math"
	"regexp"
	"time"

	"lookly/internal/platform"
)

// MonitoringSchemaVersion is the version of the events' fields.
const MonitoringSchemaVersion = 2

// The monitoring's events: one log line each, the event's name as the
// message. They hold codes, numbers and booleans only.
const (
	// EventCall: one per provider call made through the Client.
	EventCall = "ai.call"
	// EventRequest: one per feature request (a stylist turn, a garment
	// analysis, an outfit ranking): what the user got.
	EventRequest = "ai.request"
	// EventQuota: a quota decision (charged, rejected, refunded, store_error).
	EventQuota = "ai.quota"
)

type fieldKind int

const (
	codeField fieldKind = iota
	modelField
	numberField
	booleanField
)

type eventField struct {
	name string
	kind fieldKind
}

// eventFields are the fields an event may carry, in the order they are
// written. Nothing else is ever emitted.
var eventFields = map[string][]eventField{
	EventCall: {
		{"feature", codeField}, {"provider", codeField}, {"model", modelField}, {"outcome", codeField}, {"success", booleanField},
		{"errorCode", codeField}, {"httpStatus", numberField}, {"latencyMs", numberField}, {"attempts", numberField},
		{"retried", booleanField}, {"retry", codeField}, {"usageInput", numberField}, {"usageOutput", numberField},
		{"usageTotal", numberField}, {"costUsd", numberField}, {"environment", codeField}, {"schemaVersion", numberField},
	},
	EventRequest: {
		{"feature", codeField}, {"provider", codeField}, {"model", modelField}, {"outcome", codeField}, {"reason", codeField},
		{"corrected", booleanField}, {"billable", booleanField}, {"latencyMs", numberField}, {"environment", codeField},
		{"schemaVersion", numberField},
	},
	EventQuota: {
		{"feature", codeField}, {"provider", codeField}, {"action", codeField}, {"reason", codeField}, {"environment", codeField},
		{"schemaVersion", numberField},
	},
}

var (
	// eventCode: short lowercase codes only. No spaces, so no sentence, no
	// prompt, no answer and no address can pass.
	eventCode = regexp.MustCompile(`^[a-z0-9][a-z0-9_.:-]{0,63}$`)
	// eventModel: model ids as the configuration accepts them.
	eventModel = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$`)
)

// SanitizeEvent keeps the fields an event may carry when they are of the
// right kind, in their order, and drops everything else: whatever a caller
// passes by mistake (user text, an id), it is not emitted. ok is false for
// an event that is not one of ours.
func SanitizeEvent(event string, fields map[string]any) (kept []slog.Attr, ok bool) {
	spec, ok := eventFields[event]
	if !ok {
		return nil, false
	}
	for _, field := range spec {
		switch value := fields[field.name].(type) {
		case bool:
			if field.kind == booleanField {
				kept = append(kept, slog.Bool(field.name, value))
			}
		case float64:
			// Not a number is not at least zero, so it is dropped as well.
			if field.kind == numberField && !math.IsInf(value, 0) && value >= 0 {
				kept = append(kept, slog.Float64(field.name, platform.RoundHalfUp(value*1e6)/1e6))
			}
		case string:
			if (field.kind == codeField && eventCode.MatchString(value)) || (field.kind == modelField && eventModel.MatchString(value)) {
				kept = append(kept, slog.String(field.name, value))
			}
		}
	}
	return kept, true
}

// Monitor emits the monitoring's events as log lines.
type Monitor struct {
	log         *slog.Logger
	environment string
	now         func() time.Time
}

// NewMonitor returns the monitor. environment names where the server runs
// (production, staging, development, test).
func NewMonitor(log *slog.Logger, environment string) *Monitor {
	return &Monitor{log: log, environment: environment, now: time.Now}
}

// Emit writes an event, sanitized. A failed call or a request that did not
// end well is a warning; the rest is information. "ts" repeats the time in
// the form the Next.js server's log lines had, which the aggregation of
// these events reads (apps/web/scripts/ai-monitor.ts).
func (m *Monitor) Emit(ctx context.Context, event string, fields map[string]any) {
	fields = maps.Clone(fields)
	if fields == nil {
		fields = map[string]any{}
	}
	fields["environment"], fields["schemaVersion"] = m.environment, float64(MonitoringSchemaVersion)
	attrs, ok := SanitizeEvent(event, fields)
	if !ok {
		return
	}
	level := slog.LevelInfo
	switch outcome, _ := fields["outcome"].(string); {
	case event == EventCall && fields["success"] == false,
		event == EventRequest && outcome != "ok" && outcome != "replay" && outcome != "disabled":
		level = slog.LevelWarn
	}
	attrs = append(attrs, slog.String("ts", m.now().UTC().Format("2006-01-02T15:04:05.000Z")))
	m.log.LogAttrs(ctx, level, event, attrs...)
}

// RecordCall emits "ai.call" for a provider call (the Client's Recorder).
func (m *Monitor) RecordCall(ctx context.Context, record CallRecord) {
	// The fields as the event names them.
	var fields map[string]any
	encoded, err := json.Marshal(record.Fields())
	if err == nil {
		err = json.Unmarshal(encoded, &fields)
	}
	if err != nil {
		m.log.ErrorContext(ctx, "ai monitoring: a call record could not be encoded", "err", err.Error())
		return
	}
	m.Emit(ctx, EventCall, fields)
}

// RequestRecord is what the user got from a feature request.
type RequestRecord struct {
	Feature  Feature
	Provider string
	Model    string // "" when no provider was involved
	// Outcome: ok, fallback, ai_unavailable, quota_exceeded, not_a_garment,
	// image_rejected, replay, internal_error, disabled.
	Outcome string
	Reason  string // a code, or ""
	// Corrected: a correction was asked of the model (nil: not applicable).
	Corrected *bool
	// Billable: the request used, and kept, a unit of the quota.
	Billable bool
	// Latency of the whole request (nil: not measured).
	Latency *time.Duration
}

// RecordRequest emits "ai.request".
func (m *Monitor) RecordRequest(ctx context.Context, r RequestRecord) {
	// An empty model or reason is no code: the sanitizer leaves it out.
	fields := map[string]any{
		"feature": string(r.Feature), "provider": r.Provider, "model": r.Model, "outcome": r.Outcome, "reason": r.Reason, "billable": r.Billable,
	}
	if r.Corrected != nil {
		fields["corrected"] = *r.Corrected
	}
	if r.Latency != nil {
		fields["latencyMs"] = math.Max(0, platform.RoundHalfUp(float64(*r.Latency)/float64(time.Millisecond)))
	}
	m.Emit(ctx, EventRequest, fields)
}

// RecordQuota emits "ai.quota": action is charged, rejected, refunded or
// store_error; reason is a code, or "".
func (m *Monitor) RecordQuota(ctx context.Context, feature Feature, provider, action, reason string) {
	m.Emit(ctx, EventQuota, map[string]any{"feature": string(feature), "provider": provider, "action": action, "reason": reason})
}
