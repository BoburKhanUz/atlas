// Command lookly is the Lookly backend: `lookly serve` runs the HTTP API.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"lookly/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	go func() {
		// The first signal starts a graceful stop; a second one ends the
		// process at once (exit 130, as for an interrupted program).
		<-ctx.Done()
		again := make(chan os.Signal, 1)
		signal.Notify(again, os.Interrupt, syscall.SIGTERM)
		<-again
		fmt.Fprintln(os.Stderr, "second stop signal: exiting without waiting")
		os.Exit(130)
	}()
	code := app.Run(ctx, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
