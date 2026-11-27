package config_test

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"lookly/internal/config"
	"lookly/internal/golden"
)

// shape is the configuration as the golden file writes it.
func shape(c config.AI) map[string]any {
	price := func(p *config.AIPrice) any {
		if p == nil {
			return nil
		}
		return map[string]any{"inputUsdPerMTok": p.InputUSDPerMTok, "outputUsdPerMTok": p.OutputUSDPerMTok}
	}
	route := func(r config.AIRoute, source bool) map[string]any {
		m := map[string]any{
			"provider": r.Provider, "model": r.Model, "hasKey": r.APIKey != "", "timeoutMs": float64(r.Timeout.Milliseconds()), "price": price(r.Price),
		}
		if source {
			m["source"] = r.Source
		}
		return m
	}
	allowlist := []any{}
	for digest := range c.Rollout.Allowlist {
		allowlist = append(allowlist, digest)
	}
	sort.Slice(allowlist, func(i, j int) bool { return allowlist[i].(string) < allowlist[j].(string) })
	approved := []any{}
	for _, id := range c.Approved {
		approved = append(approved, id)
	}
	return map[string]any{
		"llm": route(c.LLM, false),
		"vision": map[string]any{
			"provider": c.Vision.Provider, "model": c.Vision.Model, "hasKey": c.Vision.APIKey != "",
			"timeoutMs": float64(c.Vision.Timeout.Milliseconds()), "maxSide": float64(c.Vision.MaxSide),
			"geminiMediaResolution": c.Vision.GeminiMediaResolution, "geminiThinkingLevel": c.Vision.GeminiThinkingLevel,
			"openaiDetail": c.Vision.OpenAIDetail, "price": price(c.Vision.Price),
		},
		"stylist": route(c.Stylist, true), "outfit": route(c.Outfit, true),
		"approvedProviders": approved, "mockInProduction": c.MockInProduction,
		"rollout": map[string]any{
			"stylist": c.Rollout.Stylist, "vision": c.Rollout.Vision, "outfit": c.Rollout.Outfit,
			"percent": float64(c.Rollout.Percent), "allowlist": allowlist,
		},
	}
}

// The AI settings are read as the Next.js parser reads them: the same
// environments are accepted, with the same result, and the same refused,
// with its message. NODE_ENV=production there is production here.
func TestTheAISettingsAreReadAsTheNextJSParserReadsThem(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadAIConfig(t).Cases {
		vars := with(map[string]string{"AI_LLM_PROVIDER": "<unset>", "AI_VISION_PROVIDER": "<unset>", "AI_ALLOW_MOCK_IN_PRODUCTION": "<unset>", "LOOKLY_ENV": "development"})
		for name, value := range c.Env {
			if name == "NODE_ENV" {
				vars["LOOKLY_ENV"] = value
				continue
			}
			vars[name] = value
		}
		got, err := config.Load(env(vars))
		switch {
		case c.OK && err != nil:
			t.Errorf("%s: refused: %v", c.Name, err)
		case c.OK:
			var want map[string]any
			if err := json.Unmarshal(c.Config, &want); err != nil {
				t.Fatal(err)
			}
			if have := shape(got.AI); !reflect.DeepEqual(have, want) {
				haveJSON, _ := json.Marshal(have)
				t.Errorf("%s:\n got %s\nwant %s", c.Name, haveJSON, c.Config)
			}
		case err == nil:
			t.Errorf("%s: accepted, the Next.js parser says: %s", c.Name, c.Error)
		case !strings.Contains(err.Error(), c.Variable+": "+c.Error):
			t.Errorf("%s: refused with %q, want %s: %s", c.Name, err, c.Variable, c.Error)
		}
	}
}

// Staging is a deployed environment: what production refuses, it refuses.
func TestStagingIsAsStrictAsProductionAboutAI(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadAIConfig(t).Cases {
		if c.Env["NODE_ENV"] != "production" {
			continue
		}
		vars := with(map[string]string{"AI_LLM_PROVIDER": "<unset>", "AI_VISION_PROVIDER": "<unset>", "AI_ALLOW_MOCK_IN_PRODUCTION": "<unset>", "LOOKLY_ENV": "staging"})
		for name, value := range c.Env {
			if name != "NODE_ENV" {
				vars[name] = value
			}
		}
		if _, err := config.Load(env(vars)); (err == nil) != c.OK {
			t.Errorf("%s in staging: %v, in production accepted is %t", c.Name, err, c.OK)
		}
	}
}

// No key is ever printed: not by the configuration, not by its log form.
func TestTheAIKeysAreNeverPrinted(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(with(map[string]string{
		"AI_LLM_PROVIDER": "gemini", "AI_LLM_MODEL": "gemini-flash-test", "GEMINI_API_KEY": "fake-gemini-key-do-not-print",
		"AI_VISION_PROVIDER": "openai", "AI_VISION_MODEL": "gpt-vision-test", "OPENAI_API_KEY": "fake-openai-key-do-not-print",
		"AI_ALLOW_MOCK_IN_PRODUCTION": "<unset>", "AI_ROLLOUT_ALLOWLIST": strings.Repeat("a", 64),
	})))
	if err != nil {
		t.Fatal(err)
	}
	if c.AI.LLM.APIKey != "fake-gemini-key-do-not-print" || c.AI.Vision.APIKey != "fake-openai-key-do-not-print" {
		t.Fatal("the keys were not read")
	}
	for name, text := range map[string]string{
		"%v": fmt.Sprintf("%v", c), "%+v": fmt.Sprintf("%+v", c), "%#v": fmt.Sprintf("%#v", c), "log": fmt.Sprintf("%+v", c.LogValue()),
		"ai %v": fmt.Sprintf("%v %+v %#v", c.AI, c.AI, c.AI), "route": fmt.Sprintf("%v %+v %#v", c.AI.Stylist, c.AI.Outfit, c.AI.LLM),
		"vision":  fmt.Sprintf("%v %+v %#v", c.AI.Vision, c.AI.Vision, c.AI.Vision),
		"rollout": fmt.Sprintf("%v %+v %#v", c.AI.Rollout, c.AI.Rollout, c.AI.Rollout),
	} {
		if strings.Contains(text, "do-not-print") || strings.Contains(text, strings.Repeat("a", 64)) {
			t.Errorf("%s prints a key or an allowlist digest: %s", name, text)
		}
		if name != "route" && name != "vision" && name != "rollout" && (!strings.Contains(text, "gemini-flash-test") || !strings.Contains(text, "gpt-vision-test")) {
			t.Errorf("%s does not say which models are configured: %s", name, text)
		}
	}
}
