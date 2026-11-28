package stylist

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"lookly/internal/catalog"
	"lookly/internal/engine"
	"lookly/internal/platform"
)

// TitleChars is how much of the first message names a new conversation.
const TitleChars = 60

// Request is one turn of the chat, as the request rules left it: the
// message trimmed (1 to 2000 characters), the conversation it continues
// (nil: a new one), the weather the app sent (any of its members) and the
// event the user typed (trimmed; nil when there is none or it was empty).
type Request struct {
	Message        string
	ConversationID *string
	Weather        *PartialWeather
	Event          *string
}

// PartialWeather is the weather of a request: any of the seven members.
type PartialWeather struct {
	Temperature, FeelsLike                                 *float64
	Condition                                              *string
	PrecipitationProbability, Humidity, WindSpeed, UVIndex *float64
}

// Complete is the weather when all seven members are there (the app sends
// weather only while it is fresh), else nil: only a complete snapshot is
// used.
func (w *PartialWeather) Complete() *Weather {
	if w == nil || w.Temperature == nil || w.FeelsLike == nil || w.Condition == nil || w.PrecipitationProbability == nil ||
		w.Humidity == nil || w.WindSpeed == nil || w.UVIndex == nil {
		return nil
	}
	return &Weather{
		Temperature: *w.Temperature, FeelsLike: *w.FeelsLike, Condition: *w.Condition,
		PrecipitationProbability: *w.PrecipitationProbability, Humidity: *w.Humidity, WindSpeed: *w.WindSpeed, UVIndex: *w.UVIndex,
	}
}

// json is the weather as JSON.stringify writes the request's value: the
// members it has, in the schema's order.
func (w *PartialWeather) json() string {
	if w == nil {
		return "null"
	}
	var members []string
	number := func(name string, v *float64) {
		if v != nil {
			members = append(members, `"`+name+`":`+platform.JSNumberText(*v))
		}
	}
	number("temperature", w.Temperature)
	number("feelsLike", w.FeelsLike)
	if w.Condition != nil {
		members = append(members, `"condition":`+platform.JSONString(*w.Condition))
	}
	number("precipitationProbability", w.PrecipitationProbability)
	number("humidity", w.Humidity)
	number("windSpeed", w.WindSpeed)
	number("uvIndex", w.UVIndex)
	return "{" + strings.Join(members, ",") + "}"
}

func nullableString(s *string) string {
	if s == nil {
		return "null"
	}
	return platform.JSONString(*s)
}

// Hash is the request's hash for its Idempotency-Key: the Next.js
// jsonRequestHash of the message, the conversation, the weather and the
// event, to the byte (a retry may reach either server until the cutover).
func (r Request) Hash() string {
	h := sha256.New()
	h.Write([]byte("json-v1\n"))
	h.Write([]byte(`{"message":` + platform.JSONString(r.Message) + `,"conversationId":` + nullableString(r.ConversationID) +
		`,"weather":` + r.Weather.json() + `,"event":` + nullableString(r.Event) + `}`))
	return hex.EncodeToString(h.Sum(nil))
}

// Metadata is what is stored with the user's message (and as a new
// conversation's context): the weather and the event the request brought.
func (r Request) Metadata() string {
	return `{"weather":` + r.Weather.json() + `,"event":` + nullableString(r.Event) + `}`
}

// Title is a new conversation's title: the first 60 UTF-16 code units of
// its first message, as JavaScript's slice takes them.
func (r Request) Title() string { return firstUnits(r.Message, TitleChars) }

// Occasion is the occasion the event names ("" when it names none): it
// steers the engine's candidates.
func (r Request) Occasion() string {
	if r.Event == nil {
		return ""
	}
	return catalog.OccasionFromEvent(*r.Event)
}

// engineWeather is a complete snapshot as the engine reads it.
func engineWeather(w *Weather) *engine.Weather {
	if w == nil {
		return nil
	}
	return &engine.Weather{
		Temperature: &w.Temperature, FeelsLike: &w.FeelsLike, Condition: &w.Condition,
		PrecipitationProbability: &w.PrecipitationProbability, Humidity: &w.Humidity, WindSpeed: &w.WindSpeed, UVIndex: &w.UVIndex,
	}
}
