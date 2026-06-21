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
	Location      *time.Location
	Dev           bool
	Env           string // deployment label, e.g. "sandbox"; empty for production
	AdminUser     string // bootstrap admin username
	AdminName     string // bootstrap admin display name
	AdminPassword string // bootstrap admin password; (re)applied on boot when set
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
		Env:        strings.TrimSpace(os.Getenv("APP_ENV")),
	}

	if s := os.Getenv("APP_SECRET"); s != "" {
		c.Secret = []byte(s)
	} else {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		c.Secret = b
		log.Printf("WARNING: APP_SECRET not set; generated an ephemeral secret (all sessions reset on restart)")
	}

	// Bootstrap admin. This is the only account defined outside the app; every
	// other member is created in-app by an admin. APP_ADMIN_PASSWORD is the
	// lockout-recovery path: when set, it is (re)applied to the admin on boot.
	c.AdminUser = strings.TrimSpace(env("APP_ADMIN_USER", "admin"))
	c.AdminName = strings.TrimSpace(os.Getenv("APP_ADMIN_NAME"))
	if c.AdminName == "" {
		c.AdminName = c.AdminUser
	}
	c.AdminPassword = os.Getenv("APP_ADMIN_PASSWORD")

	tz := env("APP_TZ", "UTC")
	loc, err := time.LoadLocation(tz)
	if err != nil {
		log.Printf("invalid APP_TZ %q, falling back to UTC", tz)
		loc = time.UTC
	}
	c.Location = loc

	return c
}
