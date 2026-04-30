package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"walkthrough-server/handlers"
	"walkthrough-server/store"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dbPath := flag.String("db", "/data/progress.sqlite", "path to SQLite database file")
	walkthroughsDir := flag.String("walkthroughs", "/walkthroughs", "path to walkthrough JSON directory")
	staticDir := flag.String("static", "/static", "path to built webapp static files")
	flag.Parse()

	// Allow env var overrides for k8s configmap/secret usage
	if v := os.Getenv("DB_PATH"); v != "" {
		*dbPath = v
	}
	if v := os.Getenv("WALKTHROUGHS_DIR"); v != "" {
		*walkthroughsDir = v
	}
	if v := os.Getenv("STATIC_DIR"); v != "" {
		*staticDir = v
	}
	if v := os.Getenv("LISTEN_ADDR"); v != "" {
		*addr = v
	}

	// Ensure db directory exists
	if err := os.MkdirAll(filepath.Dir(*dbPath), 0755); err != nil {
		log.Fatalf("create db dir: %v", err)
	}

	db, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer db.Close()

	h := &handlers.Handler{
		DB:              db,
		WalkthroughsDir: *walkthroughsDir,
	}

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /api/walkthroughs", h.ListWalkthroughs)
	mux.HandleFunc("GET /api/walkthroughs/{id}", h.GetWalkthrough)
	mux.HandleFunc("GET /api/progress/{id}", h.GetProgress)
	mux.HandleFunc("PUT /api/progress/{id}", h.PutProgress)

	// Serve static PWA files — fallback to index.html for SPA routing
	mux.Handle("/", spaHandler(*staticDir))

	log.Printf("walkthrough-server listening on %s", *addr)
	log.Printf("  walkthroughs: %s", *walkthroughsDir)
	log.Printf("  static:       %s", *staticDir)
	log.Printf("  db:           %s", *dbPath)

	if err := http.ListenAndServe(*addr, corsMiddleware(mux)); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// spaHandler serves static files and falls back to index.html for unknown paths.
func spaHandler(staticDir string) http.Handler {
	fs := http.FileServer(http.Dir(staticDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(staticDir, filepath.Clean("/"+r.URL.Path))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}
		fs.ServeHTTP(w, r)
	})
}

// corsMiddleware adds permissive CORS headers for local development.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
