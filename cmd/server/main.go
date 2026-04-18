package main

import (
	"compress/gzip"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/adrfranklin/pawn-playground/internal/store"
	webfiles "github.com/adrfranklin/pawn-playground/web"
	wasmfiles "github.com/adrfranklin/pawn-playground/web/wasm"
)

var (
	flagAddr = flag.String("addr", envOr("PLAYGROUND_ADDR", ":7070"), "listen address (env: PLAYGROUND_ADDR)")
	flagDB   = flag.String("db", envOr("PLAYGROUND_DB", "playground.db"), "path to SQLite database file (env: PLAYGROUND_DB)")
)

func main() {
	flag.Parse()

	db, err := store.Open(*flagDB)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer db.Close()
	log.Printf("snippet store: %s", *flagDB)

	mux := http.NewServeMux()

	// Share API.
	mux.HandleFunc("/api/share", func(w http.ResponseWriter, r *http.Request) {
		handleShare(w, r, db)
	})
	mux.HandleFunc("/api/share/", func(w http.ResponseWriter, r *http.Request) {
		handleGetShare(w, r, db)
	})
	mux.HandleFunc("/s/", func(w http.ResponseWriter, r *http.Request) {
		serveIndex(w, r)
	})
	mux.Handle("/wasm/", http.StripPrefix("/wasm/", noCacheHandler(http.FileServer(http.FS(wasmfiles.FS)))))
	mux.Handle("/", gzipHandler(http.FileServer(http.FS(webfiles.FS))))

	log.Printf("listening on %s", *flagAddr)
	if err := http.ListenAndServe(*flagAddr, securityHeaders(mux)); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

type shareRequest struct {
	Code string `json:"code"`
}

type shareResponse struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

const maxSnippetBytes = 64 * 1024 // 64 KB

// validID matches the 8-character base64url IDs produced by newID().
var validID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

func handleShare(w http.ResponseWriter, r *http.Request, db *store.Store) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxSnippetBytes+1))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	if len(body) > maxSnippetBytes {
		http.Error(w, "snippet too large (max 64 KB)", http.StatusRequestEntityTooLarge)
		return
	}
	var req shareRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Code == "" {
		http.Error(w, "code is required", http.StatusBadRequest)
		return
	}
	id, err := db.SaveSnippet(req.Code)
	if err != nil {
		log.Printf("save snippet: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(shareResponse{ID: id, URL: "/s/" + id}); err != nil {
		log.Printf("encode share response: %v", err)
	}
}

func handleGetShare(w http.ResponseWriter, r *http.Request, db *store.Store) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/share/")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	if !validID.MatchString(id) {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	code, ok, err := db.GetSnippet(id)
	if err != nil {
		log.Printf("get snippet: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"code": code}); err != nil {
		log.Printf("encode get-share response: %v", err)
	}
}

func serveIndex(w http.ResponseWriter, r *http.Request) {
	data, err := webfiles.FS.ReadFile("index.html")
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := w.Write(data); err != nil {
		log.Printf("serveIndex write: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func noCacheHandler(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		h.ServeHTTP(w, r)
	})
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.ServeHTTP(w, r)
	})
}

func gzipHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "" ||
			!strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gz, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		defer gz.Close()
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, gz: gz}, r)
	})
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	g.ResponseWriter.Header().Del("Content-Length")
	return g.gz.Write(b)
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	g.ResponseWriter.Header().Del("Content-Length")
	g.ResponseWriter.WriteHeader(code)
}
