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

	"golang.org/x/crypto/bcrypt"
)

// hashPassword returns a bcrypt hash of the given plaintext password.
func hashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}

// checkPassword reports whether plaintext matches the stored bcrypt hash.
func checkPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

type ctxKey int

const userCtxKey ctxKey = 1

const cookieName = "reno_session"

// minPasswordLen is the minimum length for a user password.
const minPasswordLen = 6

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
		if err != nil || user == nil || user.Disabled {
			writeErr(w, http.StatusUnauthorized, "unknown user")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, user)
		next(w, r.WithContext(ctx))
	}
}

// requireAdmin wraps requireAuth and additionally rejects non-admin users.
func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if u := currentUser(r); u == nil || !u.IsAdmin() {
			writeErr(w, http.StatusForbidden, "admin only")
			return
		}
		next(w, r)
	})
}

// requireCapability wraps requireAuth and rejects users who lack the named
// capability. Admins always pass (User.Has short-circuits on IsAdmin).
func (s *Server) requireCapability(cap string, next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if u := currentUser(r); u == nil || !u.Has(cap) {
			writeErr(w, http.StatusForbidden, "not permitted")
			return
		}
		next(w, r)
	})
}

// canAccessProject reports whether the user may see/act within a project: admins
// always can; everyone else must be a member. The boolean is used to return 404
// (blind) rather than 403, so non-members can't even confirm a project exists.
func (s *Server) canAccessProject(u *User, projectID int64) (bool, error) {
	if u == nil {
		return false, nil
	}
	if u.IsAdmin() {
		return true, nil
	}
	return s.store.IsProjectMember(projectID, u.ID)
}

// requireProjectAccess checks per-project access for the current user and, when
// denied, writes a 404 (blind to non-members) and returns false. Handlers guard
// with: if !s.requireProjectAccess(w, r, id) { return }.
func (s *Server) requireProjectAccess(w http.ResponseWriter, r *http.Request, projectID int64) bool {
	ok, err := s.canAccessProject(currentUser(r), projectID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return false
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "project not found")
		return false
	}
	return true
}

// visibleProjectScope returns the project ids a user may see across "all
// projects" reads. A nil slice means unrestricted (admins). For members it is the
// list of projects they belong to (possibly empty — a member of nothing).
func (s *Server) visibleProjectScope(u *User) ([]int64, error) {
	if u == nil || u.IsAdmin() {
		return nil, nil
	}
	ids, err := s.store.MemberProjectIDs(u.ID)
	if err != nil {
		return nil, err
	}
	if ids == nil {
		ids = []int64{}
	}
	return ids, nil
}

func currentUser(r *http.Request) *User {
	u, _ := r.Context().Value(userCtxKey).(*User)
	return u
}
