package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"walkthrough-server/configstore"
	"walkthrough-server/connectivity"
	"walkthrough-server/handlers"
	"walkthrough-server/source"
	"walkthrough-server/store"
	"walkthrough-server/upstream"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dbPath := flag.String("db", "/data/progress.sqlite", "path to SQLite database file")
	walkthroughsDir := flag.String("walkthroughs", "/walkthroughs", "path to walkthrough JSON directory (file mode)")
	staticDir := flag.String("static", "/static", "path to built webapp static files")
	flag.Parse()

	// Allow env var overrides
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

	// Open database — PostgreSQL via DATABASE_URL, or SQLite via DB_PATH.
	databaseURL := os.Getenv("DATABASE_URL")
	var db *store.DB
	if databaseURL != "" {
		var pgErr error
		db, pgErr = store.OpenPostgres(databaseURL)
		if pgErr != nil {
			log.Fatalf("open postgres: %v", pgErr)
		}
		log.Printf("  db:     postgres (DATABASE_URL)")
	} else {
		if err := os.MkdirAll(filepath.Dir(*dbPath), 0755); err != nil {
			log.Fatalf("create db dir: %v", err)
		}
		var sqliteErr error
		db, sqliteErr = store.OpenSQLite(*dbPath)
		if sqliteErr != nil {
			log.Fatalf("open sqlite: %v", sqliteErr)
		}
		log.Printf("  db:     sqlite (%s)", *dbPath)
	}
	defer db.Close()

	// APP_MODE determines the operating mode:
	//   "server" — fetches walkthroughs from GitHub, serves as authoritative source
	//   "client" — fetches walkthroughs from a remote server, syncs progress upstream
	//   (default) — reads walkthroughs from local filesystem (docker-compose dev)
	appMode := os.Getenv("APP_MODE")

	var src source.WalkthroughSource
	var progressSync *upstream.ProgressSync
	var cfgStore *configstore.Store
	var connMonitor *connectivity.Monitor

	switch appMode {
	case "server":
		repo := os.Getenv("GITHUB_REPO")
		if repo == "" {
			log.Fatal("APP_MODE=server requires GITHUB_REPO (e.g. owner/repo)")
		}
		parts := strings.SplitN(repo, "/", 2)
		if len(parts) != 2 {
			log.Fatalf("GITHUB_REPO must be in owner/repo format, got: %s", repo)
		}

		branch := envOrDefault("GITHUB_BRANCH", "main")
		ghPath := envOrDefault("GITHUB_PATH", "walkthroughs")
		interval := parseDuration(os.Getenv("GITHUB_REFRESH_INTERVAL"), 5*time.Minute)
		cacheDir := envOrDefault("GITHUB_CACHE_DIR", filepath.Dir(*dbPath))

		ghSrc := source.NewGitHubSource(source.GitHubConfig{
			Owner:    parts[0],
			Repo:     parts[1],
			Path:     ghPath,
			Branch:   branch,
			Token:    os.Getenv("GITHUB_TOKEN"),
			Interval: interval,
			CacheDir: cacheDir,
		})
		ghSrc.Start(context.Background())
		defer ghSrc.Close()
		src = ghSrc

		log.Printf("  mode:   server (github: %s/%s @ %s, refresh %s)", parts[0], parts[1], branch, interval)

	case "client":
		serverURL := strings.TrimRight(os.Getenv("REMOTE_SERVER_URL"), "/")
		interval := parseDuration(os.Getenv("REMOTE_REFRESH_INTERVAL"), 10*time.Minute)
		cacheDir := envOrDefault("LOCAL_CACHE_DIR", filepath.Dir(*dbPath))
		syncInterval := parseDuration(os.Getenv("PROGRESS_SYNC_INTERVAL"), 30*time.Second)

		// Persisted settings (config file) override env-var defaults.
		cfgPath := filepath.Join(filepath.Dir(*dbPath), "client-config.json")
		var cfgErr error
		cfgStore, cfgErr = configstore.Open(cfgPath)
		if cfgErr != nil {
			log.Printf("[config] failed to load config file (%s): %v — using defaults", cfgPath, cfgErr)
			cfgStore = configstore.NewInMemory()
		}
		saved := cfgStore.Get()
		if saved.ServerURL != "" {
			serverURL = saved.ServerURL
		}
		if saved.RefreshInterval != "" {
			if d, err := time.ParseDuration(saved.RefreshInterval); err == nil && d > 0 {
				interval = d
			}
		}
		if saved.SyncInterval != "" {
			if d, err := time.ParseDuration(saved.SyncInterval); err == nil && d > 0 {
				syncInterval = d
			}
		}
		if saved.CacheDir != "" {
			cacheDir = saved.CacheDir
		}
		// PSM presets override user-configured / env-var intervals at startup.
		if saved.PowerSaverMode {
			interval = configstore.PSMRefresh
			syncInterval = configstore.PSMSync
		}

		remoteSrc := source.NewRemoteSource(source.RemoteConfig{
			ServerURL: serverURL,
			Interval:  interval,
			CacheDir:  cacheDir,
			// CheckedOutFn governs which walkthrough *content* is prefetched and cached
			// locally on each refresh cycle. The checkout list is re-evaluated on every
			// refresh (default every 10 min, controlled by REMOTE_REFRESH_INTERVAL).
			CheckedOutFn: db.ListCheckoutIDs,
		})
		remoteSrc.Start(context.Background())
		defer remoteSrc.Close()
		src = remoteSrc

		// Start progress sync (pushes local changes upstream).
		// IsCheckedOutFn ensures only checked-out walkthroughs have their progress
		// pushed to or pulled from the remote server.
		progressSync = upstream.NewProgressSync(serverURL, db, syncInterval)
		progressSync.IsCheckedOutFn = db.IsCheckedOut

		// Create and start a connectivity monitor when a remote server is configured.
		// Both the remote source and progress sync use the monitor to skip HTTP calls
		// when the server is unreachable, preventing log spam and wasted CPU/battery.
		if serverURL != "" {
			connMonitor = connectivity.New(serverURL)
			// Apply PSM probe preset before Start so the loop uses the correct interval from tick one.
			if saved.PowerSaverMode {
				connMonitor.CheckInterval = configstore.PSMProbe
			}
			connMonitor.Start(context.Background())
			defer connMonitor.Stop()
			remoteSrc.Monitor = connMonitor
			progressSync.Monitor = connMonitor
		}

		progressSync.Start(context.Background())
		defer progressSync.Close()

		// Pull latest progress from the remote server on startup — only for checked-out walkthroughs.
		if serverURL != "" {
			go func() {
				ids, err := db.ListCheckoutIDs()
				if err != nil || len(ids) == 0 {
					return
				}
				progressSync.PullAll(context.Background(), ids)
			}()
		}

		if serverURL != "" {
			log.Printf("  mode:   client (server: %s, refresh %s)", serverURL, interval)
		} else {
			log.Printf("  mode:   client (no server URL configured — use /settings to configure)")
		}

	default:
		src = source.NewFileSource(*walkthroughsDir)
		log.Printf("  mode:   file (%s)", *walkthroughsDir)
	}

	h := &handlers.Handler{
		DB:           db,
		Source:       src,
		Sync:         progressSync,
		AppMode:      appMode,
		Ingest:       handlers.NewIngestManager(db),
		RemoteSource: remoteSrcForHandler(src),
		ConfigStore:  cfgStore,
		Monitor:      connMonitor,
	}

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /api/health", h.GetHealth)
	mux.HandleFunc("HEAD /api/health", h.GetHealth)
	mux.HandleFunc("GET /api/config", h.GetConfig)
	mux.HandleFunc("PUT /api/config", h.PutConfig)
	mux.HandleFunc("GET /api/walkthroughs", h.ListWalkthroughs)
	mux.HandleFunc("GET /api/walkthroughs/{id}", h.GetWalkthrough)
	mux.HandleFunc("GET /api/progress/{id}", h.GetProgress)
	mux.HandleFunc("PUT /api/progress/{id}", h.PutProgress)
	mux.HandleFunc("GET /api/checkouts", h.ListCheckouts)
	mux.HandleFunc("PUT /api/checkouts/{id}", h.PutCheckout)
	mux.HandleFunc("DELETE /api/checkouts/{id}", h.DeleteCheckout)

	// Server-mode-only API routes (walkthrough library management)
	mux.HandleFunc("POST /api/server/ingest", h.PostIngest)
	mux.HandleFunc("GET /api/server/ingest", h.ListIngestJobs)
	mux.HandleFunc("GET /api/server/ingest/{id}", h.GetIngestJob)
	mux.HandleFunc("GET /api/server/devices", h.GetDevices)
	mux.HandleFunc("PUT /api/server/checkouts/{id}", h.PutServerCheckout)
	mux.HandleFunc("DELETE /api/server/checkouts/{id}", h.DeleteServerCheckout)

	// Serve static PWA files — fallback to index.html for SPA routing
	mux.Handle("/", spaHandler(*staticDir))

	log.Printf("walkthrough-server listening on %s", *addr)
	log.Printf("  static: %s", *staticDir)

	if err := http.ListenAndServe(*addr, corsMiddleware(mux)); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func parseDuration(s string, defaultVal time.Duration) time.Duration {
	if d, err := time.ParseDuration(s); err == nil && d > 0 {
		return d
	}
	return defaultVal
}

// remoteSrcForHandler extracts the *source.RemoteSource from the active source,
// if the server is running in client mode.
func remoteSrcForHandler(src source.WalkthroughSource) *source.RemoteSource {
	if rs, ok := src.(*source.RemoteSource); ok {
		return rs
	}
	return nil
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
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Device-ID")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
