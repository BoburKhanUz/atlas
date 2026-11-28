package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"lookly/internal/database"
	"lookly/internal/demo"
	"lookly/internal/imaging"
)

const demoSeedUsage = "usage: lookly demo-seed --manifest <file> [--apply] [--reset] (DEMO_EMAIL and DEMO_PASSWORD from the environment; deploy/demo/README.md)"

// demoSeedOptions are the command's arguments.
type demoSeedOptions struct {
	manifest     string
	apply, reset bool
}

func parseDemoSeed(args []string) (demoSeedOptions, error) {
	var o demoSeedOptions
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case a == "--manifest":
			if i+1 == len(args) {
				return o, errors.New("--manifest needs a file")
			}
			i++
			o.manifest = args[i]
		case strings.HasPrefix(a, "--manifest="):
			o.manifest = strings.TrimPrefix(a, "--manifest=")
		case a == "--apply":
			o.apply = true
		case a == "--reset":
			o.reset = true
		default:
			return o, fmt.Errorf("unknown argument %q", a)
		}
	}
	switch {
	case o.manifest == "":
		return o, errors.New("--manifest <file> is required")
	case o.reset && !o.apply:
		return o, errors.New("--reset needs --apply")
	}
	return o, nil
}

// demoSeed creates or refreshes the store reviewers' demo account from a
// manifest and its photos (deploy/demo/README.md); no AI is asked. It
// reads the server's configuration (the database and the storage) and
// refuses to run where it is not valid; DEMO_EMAIL and DEMO_PASSWORD name
// the account, and the password is never printed. Without --apply it is a
// dry run: the manifest is read and every photo goes through the image
// pipeline, and nothing else is touched. Exit 0 ok, 1 a failure, 2 a usage
// or configuration error.
func demoSeed(ctx context.Context, args []string, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	opts, err := parseDemoSeed(args)
	if err != nil {
		fmt.Fprintf(stderr, "lookly demo-seed: %v\n%s\n", err, demoSeedUsage)
		return exitUsage
	}
	// The log (JSON) goes to stderr: stdout is the report.
	cfg, log, pool, code := open(ctx, getenv, stderr, stderr)
	if pool == nil {
		return code
	}
	defer pool.Close()
	account, err := demo.Credentials(getenv)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitUsage
	}

	raw, err := os.ReadFile(opts.manifest)
	if err != nil {
		fmt.Fprintf(stderr, "the manifest: %v\n", err)
		return exitFailure
	}
	manifest, err := demo.ParseManifest(raw)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitFailure
	}
	photos, err := demo.OpenPhotos(filepath.Dir(opts.manifest))
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitFailure
	}
	defer photos.Close()
	processor := imaging.NewProcessor(1)
	// Every photo passes the pipeline before anything is written.
	if err := demo.Check(ctx, processor, photos, manifest); err != nil {
		fmt.Fprintln(stderr, err)
		return exitFailure
	}
	fmt.Fprintf(stdout, "demo account %s: %s\n", account.Email, manifest.Summary())
	if !opts.apply {
		fmt.Fprintln(stdout, "DRY RUN: manifest and photos are valid (use --apply to write)")
		return 0
	}

	if !reachable(ctx, pool, stderr) {
		return exitFailure
	}
	images, code := openStorage(ctx, cfg, log, stderr)
	if images == nil {
		return code
	}
	seeder := demo.NewSeeder(demo.SeederConfig{Pool: pool, Images: images, Processor: processor, Log: log})
	out, err := seeder.Seed(ctx, account, manifest, photos, opts.reset)
	var exists *demo.WardrobeExistsError
	switch {
	case errors.As(err, &exists):
		fmt.Fprintf(stderr, "%s already has %d items; use --reset to replace them\n", account.Email, exists.Items)
		return exitFailure
	case err != nil && out.UserID == "":
		fmt.Fprintln(stderr, database.Describe(err))
		return exitFailure
	}
	if out.Created {
		fmt.Fprintln(stdout, "created the demo user")
	} else {
		if out.Removed > 0 {
			fmt.Fprintf(stdout, "removed %d earlier items\n", out.Removed)
		}
		if out.SessionsEnded > 0 {
			fmt.Fprintf(stdout, "ended the demo user's sessions: %d (the password changed)\n", out.SessionsEnded)
		}
		fmt.Fprintln(stdout, "updated the demo user")
	}
	if err != nil {
		fmt.Fprintf(stderr, "%s\nmade %d of %d items; run again with --apply --reset\n", database.Describe(err), out.Items, len(manifest.Items))
		return exitFailure
	}
	fmt.Fprintf(stdout, "APPLIED: %d items\n", out.Items)
	return 0
}
