package app

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	oghttp "github.com/openglide/openglide.club/http"
)

const (
	ListenAddress = "0.0.0.0:3000"
)

func Start() {
	var err error
	fmt.Printf("openglide.club started at http://%s", ListenAddress)
	s := &http.Server{
		Handler:           oghttp.Router(),
		Addr:              ListenAddress,
		ReadHeaderTimeout: time.Duration(30 * time.Second),
		WriteTimeout:      time.Duration(30 * time.Second),
	}
	err = s.ListenAndServe()
	slog.Error("server exited", "error", err)
	os.Exit(1)
}
