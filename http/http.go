package http

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/openglide/openglide.club/app/ui"
	"github.com/openglide/openglide.club/static"
)

// Router returns application's HTTP routes
func Router() (r chi.Router) {
	// staticRoot, err := fs.Sub(static.FS, "static")
	// if err != nil {
	// 	panic(fmt.Sprintf("unable to initialize site content filesystem: %v", err))
	// }
	// staticContentServer := http.FileServer(http.FS(staticRoot))

	r = chi.NewRouter()
	r.Use(middleware.DefaultLogger)

	// any requests for which there are no defined chi routes are sent to the static content
	// server, serving static content from the embedded filesystem
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		http.FileServer(http.FS(static.FS)).ServeHTTP(w, r)
	})

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		_ = ui.Home().Render(r.Context(), w)
	})

	r.Get("/map", func(w http.ResponseWriter, r *http.Request) {
		lat := r.URL.Query().Get("lat")
		lon := r.URL.Query().Get("lon")
		_ = ui.Map(lat, lon).Render(r.Context(), w)
	})

	return
}
