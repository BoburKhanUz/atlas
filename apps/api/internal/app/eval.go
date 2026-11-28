package app

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/evaluation"
	"lookly/internal/imaging"
)

// The defaults of the harness's runners (stylist-eval.ts AI_LLM_TIMEOUT_MS,
// vision-eval.ts DEFAULT_TIMEOUT_MS) and of the vision settings.
const (
	evalTextTimeout   = 25 * time.Second
	evalVisionTimeout = 30 * time.Second
	evalVisionMaxSide = 1024
	// standInKey is what is sent to a stand-in of a provider: never a key.
	standInKey = "stand-in-no-key"
)

const evalUsage = `usage: lookly eval --provider=openai|gemini|mock [--model=NAME] [--max-calls=N] [--base-url=URL] [--timeout=DURATION] [--gate]
  Reads one JSON case per line on stdin ({"feature":"stylist"|"outfit"|"vision","case":{...}}) and writes one
  JSON result per line: the AI evaluation harness's runners on this server's pipeline (apps/web/scripts/ai-eval).
  A real provider needs --max-calls (its key comes from OPENAI_API_KEY or GEMINI_API_KEY);
  --base-url sends every request to a stand-in on this machine instead, and no key is read.
  --gate asks the harness before every provider attempt ({"ask": ...} out, {"admit": true|false} in) and tells it
  how each one ended ({"attempted": ...}); the harness then sends a case only after the previous result.`

// RunEval is `lookly eval`: no database, no quota.
func RunEval(ctx context.Context, args []string, getenv func(string) (string, bool), stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("eval", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	provider := fs.String("provider", "", "")
	model := fs.String("model", "", "")
	baseURL := fs.String("base-url", "", "")
	maxCalls := fs.Int("max-calls", 0, "")
	timeout := fs.Duration("timeout", evalTextTimeout, "")
	gated := fs.Bool("gate", false, "")
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 {
		fmt.Fprintln(stderr, evalUsage)
		return exitUsage
	}
	refuse := func(why string) int {
		fmt.Fprintln(stderr, "lookly eval: "+why)
		return exitUsage
	}
	switch *provider {
	case config.AIOpenAI, config.AIGemini, config.AIMock:
	default:
		return refuse("--provider must be openai, gemini or mock")
	}
	if *provider == config.AIMock {
		*model = "mock"
	}
	if *model == "" {
		return refuse("--model is needed")
	}
	if *maxCalls < 0 || *timeout <= 0 {
		return refuse("--max-calls must not be negative, and --timeout must be positive")
	}

	addresses := ai.DefaultAddresses
	key := ""
	switch {
	case *provider == config.AIMock:
	case *baseURL != "":
		// A stand-in, on this machine only: the prompts go nowhere else,
		// and no key is read, so none can be sent to it.
		if !loopback(*baseURL) {
			return refuse("--base-url must be an http address on this machine (localhost, 127.0.0.1 or ::1)")
		}
		addresses = ai.Addresses{Gemini: *baseURL, OpenAI: *baseURL}
		key = standInKey
	default:
		// Paid calls only with a cap (owner rule 4).
		if *maxCalls == 0 {
			return refuse("a real provider needs --max-calls")
		}
		variable := map[string]string{config.AIOpenAI: "OPENAI_API_KEY", config.AIGemini: "GEMINI_API_KEY"}[*provider]
		value, _ := getenv(variable)
		if key = strings.TrimSpace(value); key == "" {
			return refuse(variable + " is not set")
		}
	}

	route := config.AIRoute{Provider: *provider, Model: *model, APIKey: key, Timeout: *timeout, Source: "eval"}
	cfg := config.AI{
		LLM: route, Stylist: route, Outfit: route,
		Vision: config.AIVision{Provider: *provider, Model: *model, APIKey: key, Timeout: evalVisionTimeout, MaxSide: evalVisionMaxSide},
	}
	counter := &evaluation.Counter{}
	client, err := ai.NewClient(cfg, addresses, counter)
	if err != nil {
		return refuse(err.Error())
	}
	runner := &evaluation.Runner{
		Text: client, Images: client, Pictures: imaging.NewProcessor(1), Counter: counter, MaxCalls: *maxCalls, TextTimeout: *timeout,
		VisionDefaults: evaluation.VisionSettings{MaxSide: evalVisionMaxSide, Timeout: evalVisionTimeout},
	}
	if *gated {
		runner.Gate = &evaluation.LineGate{}
		gatedClient := client.WithGate(runner.Gate)
		runner.Text, runner.Images = gatedClient, gatedClient
	}
	if err := runner.Run(ctx, stdin, stdout); err != nil {
		fmt.Fprintln(stderr, err)
		return exitFailure
	}
	return 0
}

// loopback says whether an address is http(s) on this machine.
func loopback(address string) bool {
	u, err := url.Parse(address)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// osStdin is where `lookly eval` reads its cases.
var osStdin io.Reader = os.Stdin
