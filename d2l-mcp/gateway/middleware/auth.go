package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDKey contextKey = "user_id"

// jwksKey represents a single JSON Web Key.
type jwksKey struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	// RSA fields
	N string `json:"n"`
	E string `json:"e"`
	// EC fields
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

type jwksResponse struct {
	Keys []jwksKey `json:"keys"`
}

// jwksCache holds the cached JWKS data.
type jwksCache struct {
	mu          sync.RWMutex
	keys        map[string]*jwksKey
	lastFetched time.Time
	jwksURL     string
}

var cache *jwksCache
var cacheOnce sync.Once

func initCache(jwksURL string) *jwksCache {
	cacheOnce.Do(func() {
		cache = &jwksCache{
			keys:    make(map[string]*jwksKey),
			jwksURL: jwksURL,
		}
	})
	return cache
}

// fetchJWKS fetches and caches the JWKS from Supabase.
func (c *jwksCache) refresh() error {
	resp, err := http.Get(c.jwksURL)
	if err != nil {
		return fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("failed to decode JWKS: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.keys = make(map[string]*jwksKey)
	for i := range jwks.Keys {
		k := jwks.Keys[i]
		c.keys[k.Kid] = &k
	}
	c.lastFetched = time.Now()
	fmt.Printf("[AUTH] JWKS refreshed: %d key(s)\n", len(c.keys))
	return nil
}

// getKey retrieves a key by kid, refreshing if stale (>5 min).
func (c *jwksCache) getKey(kid string) (*jwksKey, error) {
	c.mu.RLock()
	stale := time.Since(c.lastFetched) > 5*time.Minute
	key, ok := c.keys[kid]
	c.mu.RUnlock()

	if stale || !ok {
		if err := c.refresh(); err != nil {
			return nil, err
		}
		c.mu.RLock()
		key, ok = c.keys[kid]
		c.mu.RUnlock()
		if !ok {
			return nil, fmt.Errorf("key %q not found in JWKS", kid)
		}
	}
	return key, nil
}

// publicRoutes are paths that do NOT require JWT authentication.
var publicRoutes = map[string]bool{
	"/health":       true,
	"/metrics":      true,
	"/onboard":      true,
	"/auth/signup":  true,
	"/auth/signin":  true,
	"/auth/refresh": true,
}

func isPublicRoute(path string) bool {
	if publicRoutes[path] {
		return true
	}
	// VNC static assets and websockify
	if strings.HasPrefix(path, "/vnc/") || path == "/websockify" {
		return true
	}
	// D2L status polling — sessionId is the secret, no JWT needed
	if strings.HasPrefix(path, "/auth/d2l/status/") {
		return true
	}
	return false
}

// verifyHS256 verifies a Supabase HS256 JWT using the JWT secret env var.
func verifyHS256(tokenStr string) (string, error) {
	secret := os.Getenv("SUPABASE_JWT_SECRET")
	if secret == "" {
		return "", fmt.Errorf("SUPABASE_JWT_SECRET not set")
	}
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return "", fmt.Errorf("invalid HS256 token: %w", err)
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("invalid claims")
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", fmt.Errorf("missing sub claim")
	}
	return sub, nil
}

// verifyWithJWKS verifies a token using a JWKS key.
func verifyWithJWKS(tokenStr string, jwk *jwksKey) (string, error) {
	pubKey, err := jwkToPublicKey(jwk)
	if err != nil {
		return "", fmt.Errorf("invalid signing key: %w", err)
	}

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		switch t.Method.(type) {
		case *jwt.SigningMethodRSA:
		case *jwt.SigningMethodECDSA:
		default:
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return pubKey, nil
	})
	if err != nil || !token.Valid {
		return "", fmt.Errorf("invalid or expired token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("invalid claims")
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", fmt.Errorf("missing sub claim")
	}
	return sub, nil
}

// Auth returns JWT validation middleware using Supabase JWKS (ES256/RS256) with
// HS256 fallback for tokens issued without a kid header or with an unknown kid.
func Auth(jwksURL string) func(http.Handler) http.Handler {
	c := initCache(jwksURL)
	// Pre-fetch JWKS on startup (non-fatal if it fails)
	if err := c.refresh(); err != nil {
		fmt.Printf("[AUTH] Initial JWKS fetch failed (will retry): %v\n", err)
	}

	// Background refresh every 5 minutes
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if err := c.refresh(); err != nil {
				fmt.Printf("[AUTH] JWKS refresh error: %v\n", err)
			}
		}
	}()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for public routes
			if isPublicRoute(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			// Extract Bearer token
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, `{"error":"missing or invalid Authorization header"}`, http.StatusUnauthorized)
				return
			}
			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

			// Parse without verification first to inspect header
			unverified, _, err := jwt.NewParser().ParseUnverified(tokenStr, jwt.MapClaims{})
			if err != nil {
				http.Error(w, `{"error":"invalid token format"}`, http.StatusUnauthorized)
				return
			}

			kid, hasKid := unverified.Header["kid"].(string)
			var sub string

			if !hasKid || kid == "" {
				// No kid — HS256 token. Verify with JWT secret.
				sub, err = verifyHS256(tokenStr)
				if err != nil {
					fmt.Printf("[AUTH] HS256 verification failed (no kid): %v\n", err)
					http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
					return
				}
			} else {
				// Has kid — try JWKS first.
				jwk, jwkErr := c.getKey(kid)
				if jwkErr != nil {
					// kid not in JWKS — could be a rotated key or an HS256 token that
					// happens to have a kid field. Try HS256 fallback.
					fmt.Printf("[AUTH] kid=%q not in JWKS (%v), trying HS256 fallback\n", kid, jwkErr)
					sub, err = verifyHS256(tokenStr)
					if err != nil {
						fmt.Printf("[AUTH] HS256 fallback failed for kid=%q: %v\n", kid, err)
						http.Error(w, `{"error":"could not retrieve signing key"}`, http.StatusUnauthorized)
						return
					}
				} else {
					// JWKS key found — verify with public key.
					sub, err = verifyWithJWKS(tokenStr, jwk)
					if err != nil {
						fmt.Printf("[AUTH] JWKS verification failed for kid=%q: %v\n", kid, err)
						http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
						return
					}
				}
			}

			// Inject user_id into context and forward
			ctx := context.WithValue(r.Context(), UserIDKey, sub)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
