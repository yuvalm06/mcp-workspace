package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var httpClient = &http.Client{Timeout: 10 * time.Second}

// isAPIKey returns true if the token looks like a Horizon API key.
func isAPIKey(token string) bool {
	return strings.HasPrefix(token, "hzn_")
}

// verifyAPIKey looks up a hashed API key in the api_keys table via Supabase REST API.
func verifyAPIKey(key string) (string, error) {
	hash := sha256.Sum256([]byte(key))
	keyHash := hex.EncodeToString(hash[:])

	supabaseURL := os.Getenv("SUPABASE_URL")
	srkKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if supabaseURL == "" || srkKey == "" {
		return "", fmt.Errorf("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
	}

	url := supabaseURL + "/rest/v1/api_keys?key_hash=eq." + keyHash + "&select=user_id,revoked"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("apikey", srkKey)
	req.Header.Set("Authorization", "Bearer "+srkKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("api key lookup failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("api key lookup failed (status %d): %s", resp.StatusCode, string(body))
	}

	var rows []struct {
		UserID  string `json:"user_id"`
		Revoked bool   `json:"revoked"`
	}
	if err := json.Unmarshal(body, &rows); err != nil || len(rows) == 0 {
		return "", fmt.Errorf("invalid api key")
	}
	if rows[0].Revoked {
		return "", fmt.Errorf("api key has been revoked")
	}
	return rows[0].UserID, nil
}

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
	"/health":      true,
	"/metrics":     true,
	"/onboard":     true,
	"/auth/signup": true,
	"/auth/signin": true,
}

func isPublicRoute(path string) bool {
	if publicRoutes[path] {
		return true
	}
	// VNC static assets and websockify (noVNC requests these without auth headers)
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

// Auth returns JWT validation middleware using Supabase JWKS (RS256) with
// HS256 fallback for tokens issued without a kid header.
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

			// Check for API key (hzn_ prefix) before JWT parsing
			if isAPIKey(tokenStr) {
				userID, err := verifyAPIKey(tokenStr)
				if err != nil {
					fmt.Printf("[AUTH] API key validation failed: %v\n", err)
					http.Error(w, `{"error":"invalid or revoked api key"}`, http.StatusUnauthorized)
					return
				}
				fmt.Printf("[AUTH] API key OK, userId=%s\n", userID)
				ctx := context.WithValue(r.Context(), UserIDKey, userID)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Parse without verification first to get the kid header
			unverified, _, err := jwt.NewParser().ParseUnverified(tokenStr, jwt.MapClaims{})
			if err != nil {
				http.Error(w, `{"error":"invalid token format"}`, http.StatusUnauthorized)
				return
			}

			kid, hasKid := unverified.Header["kid"].(string)

			var sub string

			if !hasKid || kid == "" {
				// No kid — Supabase HS256 token. Verify with JWT secret.
				sub, err = verifyHS256(tokenStr)
				if err != nil {
					fmt.Printf("[AUTH] HS256 verification failed: %v\n", err)
					http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
					return
				}
			} else {
				// Has kid — RS256/ES256 token. Verify with JWKS.
				jwk, err := c.getKey(kid)
				if err != nil {
					http.Error(w, `{"error":"could not retrieve signing key"}`, http.StatusUnauthorized)
					return
				}

				pubKey, err := jwkToPublicKey(jwk)
				if err != nil {
					http.Error(w, `{"error":"invalid signing key"}`, http.StatusUnauthorized)
					return
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
					http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
					return
				}

				claims, ok := token.Claims.(jwt.MapClaims)
				if !ok {
					http.Error(w, `{"error":"invalid claims"}`, http.StatusUnauthorized)
					return
				}
				sub, _ = claims["sub"].(string)
				if sub == "" {
					http.Error(w, `{"error":"token missing sub claim"}`, http.StatusUnauthorized)
					return
				}
			}

			// Inject user_id into context and forward
			ctx := context.WithValue(r.Context(), UserIDKey, sub)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
