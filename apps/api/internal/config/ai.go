package config

import (
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"lookly/internal/platform"
)

// AI providers (AI_LLM_PROVIDER, AI_VISION_PROVIDER and the per-feature routes).
const (
	AIMock   = "mock"
	AIGemini = "gemini"
	AIOpenAI = "openai"
)

// aiProviders are the registered providers, in the Next.js registry's
// order; aiKeys, the variable each real one reads its key from.
var (
	aiProviders = []string{AIMock, AIGemini, AIOpenAI}
	aiKeys      = map[string]string{AIGemini: "GEMINI_API_KEY", AIOpenAI: "OPENAI_API_KEY"}
)

// AIPrice is what a model costs, for the cost estimates of the monitoring.
type AIPrice struct {
	InputUSDPerMTok  float64
	OutputUSDPerMTok float64
}

// AIRoute is the provider of a text feature.
type AIRoute struct {
	Provider string
	Model    string
	APIKey   string // secret; "" for the mock
	Timeout  time.Duration
	// Price is AI_LLM_PRICE_* when the route is on the provider and model
	// those prices are for; nil otherwise (the cost is not guessed).
	Price *AIPrice
	// Source is where the provider and model come from: AI_LLM,
	// AI_STYLIST or AI_OUTFIT.
	Source string
}

// AIVision is the provider of the garment analysis.
type AIVision struct {
	Provider string
	Model    string
	APIKey   string // secret; "" for the mock
	Timeout  time.Duration
	// MaxSide is the longest side, in pixels, of the picture sent.
	MaxSide               int
	GeminiMediaResolution string // low | medium | high | ultra_high
	GeminiThinkingLevel   string // none | minimal | low | medium | high
	OpenAIDetail          string // low | high | auto
	Price                 *AIPrice
}

// AIRollout says who gets the AI features. It never selects a provider.
type AIRollout struct {
	// Stylist, Vision and Outfit are the features' switches: a feature
	// that is off never calls a provider.
	Stylist, Vision, Outfit bool
	// Percent is the share of users (by a stable bucket) who get the
	// features that are on.
	Percent int
	// Allowlist holds digests of user ids (never the ids): these users get
	// the features that are on, whatever the percentage.
	Allowlist map[string]bool
}

// AI is the configuration of the AI providers: the Next.js server's
// variables, read by its rules (apps/web/src/lib/ai/config.ts; golden
// vectors in testdata/golden/ai-config.json).
type AI struct {
	// LLM is AI_LLM_*: the provider of every text feature without a route
	// of its own.
	LLM    AIRoute
	Vision AIVision
	// Stylist and Outfit are the routes of the two text features.
	Stylist, Outfit AIRoute
	// Approved are the real providers allowed for any role, sorted.
	Approved []string
	// MockInProduction: a deployed server runs with an acknowledged mock.
	MockInProduction bool
	Rollout          AIRollout
}

// UsesMock says whether any role is the mock's.
func (a AI) UsesMock() bool {
	return a.Stylist.Provider == AIMock || a.Outfit.Provider == AIMock || a.Vision.Provider == AIMock
}

func (r AIRoute) String() string {
	return fmt.Sprintf("AIRoute{Provider:%s Model:%s APIKey:%s Timeout:%s Priced:%t Source:%s}",
		r.Provider, r.Model, setOrNot(r.APIKey), r.Timeout, r.Price != nil, r.Source)
}

// GoString keeps the key out of %#v.
func (r AIRoute) GoString() string { return r.String() }

func (v AIVision) String() string {
	return fmt.Sprintf("AIVision{Provider:%s Model:%s APIKey:%s Timeout:%s MaxSide:%d Resolution:%s Thinking:%s Detail:%s Priced:%t}",
		v.Provider, v.Model, setOrNot(v.APIKey), v.Timeout, v.MaxSide, v.GeminiMediaResolution, v.GeminiThinkingLevel, v.OpenAIDetail, v.Price != nil)
}

// GoString keeps the key out of %#v.
func (v AIVision) GoString() string { return v.String() }

func (r AIRollout) String() string {
	return fmt.Sprintf("AIRollout{Stylist:%t Vision:%t Outfit:%t Percent:%d Allowlist:%d entries}", r.Stylist, r.Vision, r.Outfit, r.Percent, len(r.Allowlist))
}

// GoString keeps the allowlist's digests out of %#v.
func (r AIRollout) GoString() string { return r.String() }

func (a AI) String() string {
	return fmt.Sprintf("AI{LLM:%s Vision:%s Stylist:%s Outfit:%s Approved:%v MockInProduction:%t %s}",
		a.LLM, a.Vision, a.Stylist, a.Outfit, a.Approved, a.MockInProduction, a.Rollout)
}

// GoString keeps the keys out of %#v.
func (a AI) GoString() string { return a.String() }

// LogValue is the AI configuration for the log: providers and models,
// never a key or a digest.
func (a AI) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("stylistProvider", a.Stylist.Provider), slog.String("stylistModel", a.Stylist.Model),
		slog.String("outfitProvider", a.Outfit.Provider), slog.String("outfitModel", a.Outfit.Model),
		slog.String("visionProvider", a.Vision.Provider), slog.String("visionModel", a.Vision.Model),
		slog.Bool("mockInProduction", a.MockInProduction),
		slog.Bool("stylistEnabled", a.Rollout.Stylist), slog.Bool("visionEnabled", a.Rollout.Vision), slog.Bool("outfitEnabled", a.Rollout.Outfit),
		slog.Int("rolloutPercent", a.Rollout.Percent), slog.Int("rolloutAllowlist", len(a.Rollout.Allowlist)),
	)
}

// The Next.js parser's limits.
const (
	defaultLLMTimeout    = 25 * time.Second
	defaultVisionTimeout = 15 * time.Second
	minAITimeoutMs       = 1_000
	maxAITimeoutMs       = 55_000
	defaultVisionMaxSide = 1024
	minVisionSide        = 256
	maxVisionSide        = 2048
	maxAllowlist         = 1000
)

var (
	aiModelID  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$`)
	aiDigest   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	wholeDigit = regexp.MustCompile(`^[0-9]+$`)
)

// aiRefusal is why the AI settings are refused: the variable, and the
// Next.js parser's message.
type aiRefusal struct{ variable, message string }

func refuse(variable, format string, args ...any) *aiRefusal {
	return &aiRefusal{variable, fmt.Sprintf(format, args...)}
}

// describeIDs is "a", "a or b", "a, b or c".
func describeIDs(ids []string) string {
	if len(ids) < 2 {
		return strings.Join(ids, "")
	}
	return strings.Join(ids[:len(ids)-1], ", ") + " or " + ids[len(ids)-1]
}

var (
	allProviders  = describeIDs(aiProviders)
	realProviders = describeIDs(aiProviders[1:])
)

// loadAI reads the AI settings in the Next.js parser's order: its first
// refusal is the refusal. deployed is production or staging (NODE_ENV=
// production there).
func loadAI(deployed bool, value func(string) (string, bool)) (AI, *aiRefusal) {
	get := func(name string) string { v, _ := value(name); return v }

	if get("LLM_PROVIDER") != "" {
		return AI{}, refuse("LLM_PROVIDER", "LLM_PROVIDER was removed (the Z.ai provider is gone); use AI_LLM_PROVIDER=mock|gemini|openai")
	}

	timeout := func(name string, fallback time.Duration) (time.Duration, *aiRefusal) {
		raw := get(name)
		if raw == "" {
			return fallback, nil
		}
		if !wholeDigit.MatchString(raw) {
			return 0, refuse(name, "%s must be a whole number of milliseconds", name)
		}
		// A number too long to read is past the range all the same.
		ms, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || ms < minAITimeoutMs || ms > maxAITimeoutMs {
			return 0, refuse(name, "%s must be between %d and %d", name, minAITimeoutMs, maxAITimeoutMs)
		}
		return time.Duration(ms) * time.Millisecond, nil
	}
	price := func(prefix string) (*AIPrice, *aiRefusal) {
		inName, outName := prefix+"_PRICE_INPUT_USD_PER_MTOK", prefix+"_PRICE_OUTPUT_USD_PER_MTOK"
		in, out := get(inName), get(outName)
		if in == "" && out == "" {
			return nil, nil
		}
		parse := func(name, raw string) (float64, *aiRefusal) {
			n := platform.JSNumber(raw)
			if raw == "" || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
				return 0, refuse(name, "%s must be a non-negative number (set both price variables or neither)", name)
			}
			return n, nil
		}
		input, refusal := parse(inName, in)
		if refusal != nil {
			return nil, refusal
		}
		output, refusal := parse(outName, out)
		if refusal != nil {
			return nil, refusal
		}
		return &AIPrice{InputUSDPerMTok: input, OutputUSDPerMTok: output}, nil
	}
	oneOf := func(name string, allowed []string, fallback string) (string, *aiRefusal) {
		raw := strings.ToLower(get(name))
		if raw == "" {
			return fallback, nil
		}
		if !slices.Contains(allowed, raw) {
			return "", refuse(name, "%s must be one of: %s", name, strings.Join(allowed, ", "))
		}
		return raw, nil
	}
	flag := func(name string, fallback bool) (bool, *aiRefusal) {
		switch strings.ToLower(get(name)) {
		case "":
			return fallback, nil
		case "true", "1":
			return true, nil
		case "false", "0":
			return false, nil
		}
		return false, refuse(name, "%s must be true, false, 1 or 0", name)
	}
	// credentials are the key and the model of a real provider in a role.
	credentials := func(provider, role string) (key, model string, refusal *aiRefusal) {
		keyVar := aiKeys[provider]
		key = get(keyVar)
		if key == "" {
			return "", "", refuse(keyVar, "%s must be set when %s_PROVIDER=%s", keyVar, role, provider)
		}
		if strings.ContainsFunc(key, platform.IsJSWhiteSpace) {
			return "", "", refuse(keyVar, "%s must not contain whitespace", keyVar)
		}
		model = get(role + "_MODEL")
		if model == "" {
			return "", "", refuse(role+"_MODEL", "%s_MODEL must be set when %s_PROVIDER=%s", role, role, provider)
		}
		if !aiModelID.MatchString(model) {
			return "", "", refuse(role+"_MODEL", "%s_MODEL is not a valid model id", role)
		}
		return key, model, nil
	}
	// routeOverride is a feature's own route: both variables or neither.
	routeOverride := func(prefix string) (*AIRoute, *aiRefusal) {
		rawProvider, rawModel := get(prefix+"_PROVIDER"), get(prefix+"_MODEL")
		if rawProvider == "" && rawModel == "" {
			return nil, nil
		}
		if rawProvider == "" || rawModel == "" {
			return nil, refuse(prefix+"_PROVIDER", "%s_PROVIDER and %s_MODEL must be set together (or both left unset to use AI_LLM_PROVIDER)", prefix, prefix)
		}
		provider := strings.ToLower(rawProvider)
		if !slices.Contains(aiProviders, provider) {
			return nil, refuse(prefix+"_PROVIDER", "%s_PROVIDER must be %s", prefix, allProviders)
		}
		if !aiModelID.MatchString(rawModel) {
			return nil, refuse(prefix+"_MODEL", "%s_MODEL is not a valid model id", prefix)
		}
		if provider == AIMock {
			return &AIRoute{Provider: AIMock, Model: "mock", Source: prefix}, nil
		}
		key, model, refusal := credentials(provider, prefix)
		if refusal != nil {
			return nil, refusal
		}
		return &AIRoute{Provider: provider, Model: model, APIKey: key, Source: prefix}, nil
	}

	// The real providers allowed for any role.
	approved := []string{AIGemini, AIOpenAI}
	if raw := get("AI_APPROVED_PROVIDERS"); raw != "" {
		approved = nil
		for _, id := range strings.Split(raw, ",") {
			if id = strings.ToLower(strings.TrimFunc(id, platform.IsJSWhiteSpace)); id != "" && !slices.Contains(approved, id) {
				approved = append(approved, id)
			}
		}
		switch {
		case len(approved) == 0:
			return AI{}, refuse("AI_APPROVED_PROVIDERS", "AI_APPROVED_PROVIDERS must list at least one provider (leave it unset for the default: gemini, openai)")
		case slices.Contains(approved, AIMock):
			return AI{}, refuse("AI_APPROVED_PROVIDERS", "AI_APPROVED_PROVIDERS lists real providers only; the mock is governed by AI_ALLOW_MOCK_IN_PRODUCTION")
		case slices.ContainsFunc(approved, func(id string) bool { return !slices.Contains(aiProviders, id) }):
			return AI{}, refuse("AI_APPROVED_PROVIDERS", "AI_APPROVED_PROVIDERS contains an unknown provider (registered: %s)", realProviders)
		}
		slices.Sort(approved)
	}
	assertApproved := func(provider, variable string) *aiRefusal {
		if provider != AIMock && !slices.Contains(approved, provider) {
			return refuse(variable, "%s=%s is not an approved provider (AI_APPROVED_PROVIDERS)", variable, provider)
		}
		return nil
	}

	stylistRoute, refusal := routeOverride("AI_STYLIST")
	if refusal != nil {
		return AI{}, refusal
	}
	outfitRoute, refusal := routeOverride("AI_OUTFIT")
	if refusal != nil {
		return AI{}, refusal
	}
	// AI_LLM_* serves every text feature without a route of its own.
	legacyNeeded := stylistRoute == nil || outfitRoute == nil

	rawLLM := strings.ToLower(get("AI_LLM_PROVIDER"))
	if rawLLM == "" && deployed && legacyNeeded {
		return AI{}, refuse("AI_LLM_PROVIDER", "AI_LLM_PROVIDER must be set in production (%s)", realProviders)
	}
	llm := AIRoute{Provider: AIMock, Model: "mock", Source: "AI_LLM"}
	if rawLLM != "" {
		llm.Provider = rawLLM
	}
	if !slices.Contains(aiProviders, llm.Provider) {
		return AI{}, refuse("AI_LLM_PROVIDER", "AI_LLM_PROVIDER must be %s", allProviders)
	}

	rawVision := strings.ToLower(get("AI_VISION_PROVIDER"))
	if rawVision == "" && deployed {
		return AI{}, refuse("AI_VISION_PROVIDER", "AI_VISION_PROVIDER must be set in production (%s)", realProviders)
	}
	vision := AIVision{Provider: AIMock, Model: "mock"}
	if rawVision != "" {
		vision.Provider = rawVision
	}
	if !slices.Contains(aiProviders, vision.Provider) {
		return AI{}, refuse("AI_VISION_PROVIDER", "AI_VISION_PROVIDER must be %s", allProviders)
	}

	if llm.Provider != AIMock {
		if llm.APIKey, llm.Model, refusal = credentials(llm.Provider, "AI_LLM"); refusal != nil {
			return AI{}, refusal
		}
	}
	if vision.Provider != AIMock {
		if vision.APIKey, vision.Model, refusal = credentials(vision.Provider, "AI_VISION"); refusal != nil {
			return AI{}, refusal
		}
	}

	// (The mock, which is what an unset provider is, is always allowed.)
	if refusal = assertApproved(llm.Provider, "AI_LLM_PROVIDER"); refusal != nil {
		return AI{}, refusal
	}
	if stylistRoute != nil {
		if refusal = assertApproved(stylistRoute.Provider, "AI_STYLIST_PROVIDER"); refusal != nil {
			return AI{}, refusal
		}
	}
	if outfitRoute != nil {
		if refusal = assertApproved(outfitRoute.Provider, "AI_OUTFIT_PROVIDER"); refusal != nil {
			return AI{}, refusal
		}
	}
	if refusal = assertApproved(vision.Provider, "AI_VISION_PROVIDER"); refusal != nil {
		return AI{}, refusal
	}

	if llm.Timeout, refusal = timeout("AI_LLM_TIMEOUT_MS", defaultLLMTimeout); refusal != nil {
		return AI{}, refusal
	}
	if llm.Price, refusal = price("AI_LLM"); refusal != nil {
		return AI{}, refusal
	}
	route := func(override *AIRoute) AIRoute {
		if override == nil {
			return llm
		}
		r := *override
		r.Timeout = llm.Timeout
		// The legacy price is of the legacy provider and model only.
		if rawLLM != "" && r.Provider == llm.Provider && r.Model == llm.Model {
			r.Price = llm.Price
		}
		return r
	}
	ai := AI{LLM: llm, Stylist: route(stylistRoute), Outfit: route(outfitRoute), Approved: approved}

	allowMock := get("AI_ALLOW_MOCK_IN_PRODUCTION") == "1"
	ai.Vision = vision // for UsesMock
	if deployed && ai.UsesMock() && !allowMock {
		return AI{}, refuse("AI_ALLOW_MOCK_IN_PRODUCTION",
			"a mock AI provider is selected in production; configure a real provider, or set AI_ALLOW_MOCK_IN_PRODUCTION=1 for local Docker / e2e only")
	}
	ai.MockInProduction = deployed && ai.UsesMock()

	if vision.Timeout, refusal = timeout("AI_VISION_TIMEOUT_MS", defaultVisionTimeout); refusal != nil {
		return AI{}, refusal
	}
	vision.MaxSide = defaultVisionMaxSide
	if raw := get("AI_VISION_MAX_SIDE"); raw != "" {
		n, err := strconv.Atoi(raw)
		if !wholeDigit.MatchString(raw) || err != nil || n < minVisionSide || n > maxVisionSide {
			return AI{}, refuse("AI_VISION_MAX_SIDE", "AI_VISION_MAX_SIDE must be a whole number of pixels between %d and %d", minVisionSide, maxVisionSide)
		}
		vision.MaxSide = n
	}
	if vision.GeminiMediaResolution, refusal = oneOf("AI_VISION_RESOLUTION", []string{"low", "medium", "high", "ultra_high"}, "high"); refusal != nil {
		return AI{}, refusal
	}
	if vision.GeminiThinkingLevel, refusal = oneOf("AI_VISION_GEMINI_THINKING_LEVEL", []string{"none", "minimal", "low", "medium", "high"}, "low"); refusal != nil {
		return AI{}, refusal
	}
	if vision.OpenAIDetail, refusal = oneOf("AI_VISION_DETAIL", []string{"low", "high", "auto"}, "high"); refusal != nil {
		return AI{}, refusal
	}
	if vision.Price, refusal = price("AI_VISION"); refusal != nil {
		return AI{}, refusal
	}
	ai.Vision = vision

	// The rollout: where the server is deployed, a missing switch or
	// percentage enables nothing.
	rollout := AIRollout{Percent: 100, Allowlist: map[string]bool{}}
	if deployed {
		rollout.Percent = 0
	}
	if rollout.Stylist, refusal = flag("AI_STYLIST_ENABLED", !deployed); refusal != nil {
		return AI{}, refusal
	}
	if rollout.Vision, refusal = flag("AI_VISION_ENABLED", !deployed); refusal != nil {
		return AI{}, refusal
	}
	if rollout.Outfit, refusal = flag("AI_OUTFIT_AI_ENABLED", !deployed); refusal != nil {
		return AI{}, refusal
	}
	if raw := get("AI_ROLLOUT_PERCENT"); raw != "" {
		n, err := strconv.Atoi(raw)
		if !wholeDigit.MatchString(raw) || len(raw) > 3 || err != nil || n > 100 {
			return AI{}, refuse("AI_ROLLOUT_PERCENT", "AI_ROLLOUT_PERCENT must be a whole number between 0 and 100")
		}
		rollout.Percent = n
	}
	entries := 0
	for _, entry := range strings.Split(get("AI_ROLLOUT_ALLOWLIST"), ",") {
		if entry = strings.ToLower(strings.TrimFunc(entry, platform.IsJSWhiteSpace)); entry == "" {
			continue
		}
		// The message never repeats an entry.
		if !aiDigest.MatchString(entry) {
			return AI{}, refuse("AI_ROLLOUT_ALLOWLIST", "AI_ROLLOUT_ALLOWLIST entries must be allowlist digests (64 hex characters), not raw ids")
		}
		entries++
		rollout.Allowlist[entry] = true
	}
	if entries > maxAllowlist {
		return AI{}, refuse("AI_ROLLOUT_ALLOWLIST", "AI_ROLLOUT_ALLOWLIST may hold at most %d entries", maxAllowlist)
	}
	ai.Rollout = rollout
	return ai, nil
}
