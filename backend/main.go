package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	cfg := LoadConfig()

	if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0o755); err != nil {
		log.Fatalf("create db dir: %v", err)
	}
	if err := os.MkdirAll(cfg.UploadsDir, 0o755); err != nil {
		log.Fatalf("create uploads dir: %v", err)
	}

	store, err := OpenStore(cfg.DBPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer store.Close()

	if err := store.Migrate(); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if err := bootstrapAdmin(store, cfg); err != nil {
		log.Fatalf("bootstrap admin: %v", err)
	}

	srv := NewServer(cfg, store)
	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (tz=%s db=%s uploads=%s admin=%s)",
			cfg.Port, cfg.Location.String(), cfg.DBPath, cfg.UploadsDir, cfg.AdminUser)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

// bootstrapAdmin guarantees an admin account exists. APP_ADMIN_PASSWORD, when
// set, is hashed and (re)applied — the lockout-recovery path. If the admin does
// not yet exist and no password is given, it logs a warning: the account is
// created but cannot log in until a password is provided.
func bootstrapAdmin(store *Store, cfg *Config) error {
	var hash string
	if cfg.AdminPassword != "" {
		h, err := hashPassword(cfg.AdminPassword)
		if err != nil {
			return err
		}
		hash = h
	}
	if err := store.EnsureAdmin(cfg.AdminUser, cfg.AdminName, hash); err != nil {
		return err
	}
	if hash == "" {
		u, err := store.GetUserByUsername(cfg.AdminUser)
		if err == nil && u != nil && u.PasswordHash == nil {
			log.Printf("WARNING: admin %q has no password; set APP_ADMIN_PASSWORD to enable login", cfg.AdminUser)
		}
	}
	return nil
}
