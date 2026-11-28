package httpapi_test

import (
	"encoding/json"
	"testing"

	"lookly/internal/golden"
	"lookly/internal/httpapi"
	"lookly/internal/httpapi/contract"
)

// What a chat request becomes is what the Next.js route made of it: the
// Idempotency-Key's hash, the texts stored with the message and as a new
// conversation's title, the event, whether the weather is complete, the
// occasion the event names.
func TestAChatRequestIsReadAsTheNextJSRouteReadsIt(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadStylist(t).Requests {
		canonical, refusal := httpapi.StylistChatBody([]byte(c.Body))
		if refusal != nil {
			t.Fatalf("%s: refused: %v", c.Name, refusal)
		}
		var body contract.StylistChatRequest
		if err := json.Unmarshal(canonical, &body); err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		r := httpapi.ChatRequest(&body)
		if got := r.Hash(); got != c.Hash {
			t.Errorf("%s: hash %s, want %s", c.Name, got, c.Hash)
		}
		if got := r.Metadata(); got != c.Metadata {
			t.Errorf("%s: metadata %s, want %s", c.Name, got, c.Metadata)
		}
		if got := r.Title(); got != c.Title {
			t.Errorf("%s: title %q, want %q", c.Name, got, c.Title)
		}
		if (r.Event == nil) != (c.Event == nil) || r.Event != nil && *r.Event != *c.Event {
			t.Errorf("%s: event %v, want %v", c.Name, r.Event, c.Event)
		}
		if got := r.Weather.Complete() != nil; got != c.CompleteWeather {
			t.Errorf("%s: complete weather %t, want %t", c.Name, got, c.CompleteWeather)
		}
		want := ""
		if c.Occasion != nil {
			want = *c.Occasion
		}
		if got := r.Occasion(); got != want {
			t.Errorf("%s: occasion %q, want %q", c.Name, got, want)
		}
	}
}
