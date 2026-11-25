// Command lookly is the Lookly backend: `lookly serve` runs the HTTP API.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"lookly/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := app.Run(ctx, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
