package auth

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"github.com/golang-jwt/jwt/v5"
)

// JWKSValidator validates nanoauth-issued JWTs against the JWKS endpoint and
// returns the token claims.
type JWKSValidator struct {
	jwksURL   string
	client    *http.Client
	keyCache  map[string]*rsa.PublicKey
	lastFetch time.Time
	cacheTTL  time.Duration
	mu        sync.RWMutex
}

func NewJWKSValidator(jwksURL string) *JWKSValidator {
	return &JWKSValidator{
		jwksURL: jwksURL,
		// The default JWKS URL is served through the bus, whose internal
		// endpoints require the shared token.
		client:   &http.Client{Timeout: 10 * time.Second, Transport: bustoken.Transport(nil)},
		keyCache: make(map[string]*rsa.PublicKey),
		cacheTTL: 5 * time.Minute,
	}
}

// ValidateToken parses and verifies the token, returning the raw claims.
func (v *JWKSValidator) ValidateToken(tokenStr string) (map[string]any, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		kid, ok := t.Header["kid"].(string)
		if !ok {
			return nil, fmt.Errorf("missing kid in token header")
		}
		return v.fetchKey(kid)
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	result := make(map[string]any, len(claims))
	for k, value := range claims {
		result[k] = value
	}
	return result, nil
}

func (v *JWKSValidator) fetchKey(kid string) (*rsa.PublicKey, error) {
	v.mu.RLock()
	if key, ok := v.keyCache[kid]; ok && time.Since(v.lastFetch) < v.cacheTTL {
		v.mu.RUnlock()
		return key, nil
	}
	v.mu.RUnlock()

	v.mu.Lock()
	defer v.mu.Unlock()

	if key, ok := v.keyCache[kid]; ok && time.Since(v.lastFetch) < v.cacheTTL {
		return key, nil
	}

	resp, err := v.client.Get(v.jwksURL)
	if err != nil {
		return nil, fmt.Errorf("fetch jwks: %w", err)
	}
	defer resp.Body.Close()

	var jwks struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("decode jwks: %w", err)
	}

	v.keyCache = make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, key := range jwks.Keys {
		pub, err := parseJWKKey(key.Kty, key.N, key.E)
		if err != nil {
			continue
		}
		v.keyCache[key.Kid] = pub
	}
	v.lastFetch = time.Now()

	if key, ok := v.keyCache[kid]; ok {
		return key, nil
	}
	return nil, fmt.Errorf("no matching key in jwks for kid %q", kid)
}

func parseJWKKey(kty, n, e string) (*rsa.PublicKey, error) {
	if kty != "RSA" {
		return nil, fmt.Errorf("unsupported kty %q", kty)
	}
	nBytes, err := base64.RawURLEncoding.DecodeString(n)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(e)
	if err != nil {
		return nil, err
	}
	if len(eBytes) == 0 {
		eBytes = []byte{0}
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(new(big.Int).SetBytes(eBytes).Int64()),
	}, nil
}
