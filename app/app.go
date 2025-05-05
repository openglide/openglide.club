package app

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"

	oghttp "github.com/openglide/openglide.club/http"
)

const (
	ListenAddress = "0.0.0.0:3000"
)

func Start() {
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs)

	// Channel to notify the main goroutine to stop.
	done := make(chan bool, 1)

	// Start a goroutine that waits for signals.
	go func() {
		sig := <-sigs
		slog.Warn("Received signal:", "signal", sig)
		slog.Info("Shutting down gracefully...")
		done <- true
	}()

	go func() {
		// Wait for the signal to finish cleanup
		<-done
		slog.Info("bye")
		os.Exit(0)
	}()

	var err error
	slog.Info(fmt.Sprintf("openglide.club started at http://%s", ListenAddress))
	s := &http.Server{
		Handler:           oghttp.Router(),
		Addr:              ListenAddress,
		ReadHeaderTimeout: time.Duration(30 * time.Second),
		WriteTimeout:      time.Duration(30 * time.Second),
	}
	err = s.ListenAndServe()
	if err != nil {
		slog.Error("unable to start server:", "error", err)
		os.Exit(1)
	}
}
