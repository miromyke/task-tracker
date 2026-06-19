package main

import (
	"crypto/rand"
	"log"
	"os"
	"strings"
	"time"
)

// Config holds runtime configuration sourced from environment variables.
type Config struct {
	Port         string
	DBPath       string
	UploadsDir   string
	StaticDir    string
	Secret       []byte
	AllowedUsers map[string]string // username -> display name
	Location     *time.Location
	Dev          bool
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// LoadConfig reads configuration from the environment, applying sensible defaults.
func LoadConfig() *Config {
	c := &Config{
		Port:       env("PORT", "8080"),
		DBPath:     env("DB_PATH", "./data/app.db"),
		UploadsDir: env("UPLOADS_DIR", "./data/uploads"),
		StaticDir:  env("STATIC_DIR", ""),
		Dev:        os.Getenv("APP_DEV") == "1",
	}

	if s := os.Getenv("APP_SECRET"); s != "" {
		c.Secret = []byte(s)
	} else {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		c.Secret = b
		log.Printf("WARNING: APP_SECRET not set; generated an ephemeral secret (all sessions reset on restart)")
	}

	// APP_USERS format: "alice:Alice Smith,bob:Bob" (display name optional).
	c.AllowedUsers = map[string]string{}
	for _, part := range strings.Split(env("APP_USERS", "admin:Admin"), ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		username, name, found := strings.Cut(part, ":")
		username = strings.TrimSpace(username)
		if username == "" {
			continue
		}
		if !found || strings.TrimSpace(name) == "" {
			name = username
		}
		c.AllowedUsers[username] = strings.TrimSpace(name)
	}

	tz := env("APP_TZ", "UTC")
	loc, err := time.LoadLocation(tz)
	if err != nil {
		log.Printf("invalid APP_TZ %q, falling back to UTC", tz)
		loc = time.UTC
	}
	c.Location = loc

	return c
}
