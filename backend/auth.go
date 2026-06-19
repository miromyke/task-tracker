package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type ctxKey int

const userCtxKey ctxKey = 1

const cookieName = "reno_session"

// signToken builds an HMAC-signed token: base64(payload).base64(sig).
func (s *Server) signToken(username string) string {
	payload := username + "|" + strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, s.cfg.Secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) verifyToken(tok string) (string, bool) {
	parts := strings.SplitN(tok, ".", 2)
	if len(parts) != 2 {
		return "", false
	}
	payloadB, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	sigB, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, s.cfg.Secret)
	mac.Write(payloadB)
	if !hmac.Equal(sigB, mac.Sum(nil)) {
		return "", false
	}
	username, _, ok := strings.Cut(string(payloadB), "|")
	if !ok {
		return "", false
	}
	if _, allowed := s.cfg.AllowedUsers[username]; !allowed {
		return "", false
	}
	return username, true
}

func (s *Server) setSession(w http.ResponseWriter, username string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    s.signToken(username),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   60 * 60 * 24 * 365,
	})
}

func (s *Server) clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		username, ok := s.verifyToken(c.Value)
		if !ok {
			writeErr(w, http.StatusUnauthorized, "invalid session")
			return
		}
		user, err := s.store.GetUserByUsername(username)
		if err != nil || user == nil {
			writeErr(w, http.StatusUnauthorized, "unknown user")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, user)
		next(w, r.WithContext(ctx))
	}
}

func currentUser(r *http.Request) *User {
	u, _ := r.Context().Value(userCtxKey).(*User)
	return u
}
