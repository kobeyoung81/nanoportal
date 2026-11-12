package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// Backends holds the upstream service base URLs the portal proxies to.
type Backends struct {
	// BusURL is the nanobus REST API base URL.
	BusURL string
	// AdminURL is the admin module's API base URL: configuration is saved there.
	AdminURL string
}

func (server *Server) adminURL() string {
	if server.backends.AdminURL == "" {
		return "http://127.0.0.1:8080"
	}
	return server.backends.AdminURL
}

func (b Backends) normalize() Backends {
	if b.BusURL == "" {
		b.BusURL = "http://127.0.0.1:9000"
	}
	return b
}

type proxyClient struct {
	http *http.Client
}

func newProxyClient() *proxyClient {
	return &proxyClient{
		// The files tunnel chain can take up to 60s (nanobus tunnel wait +
		// nanosec local bridge); this client must outlive that or slow container
		// responses would abort with "context deadline exceeded".
		//
		// Every request carries the bus's shared token: the bus refuses its
		// internal endpoints to anonymous callers, and the portal is one of its
		// callers.
		http: &http.Client{Timeout: 65 * time.Second, Transport: bustoken.Transport(nil)},
	}
}

func (client *proxyClient) forwardGET(w http.ResponseWriter, r *http.Request, target string, transform func([]byte) ([]byte, error)) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	// Conditional reads pass through: the session endpoint answers 304 when the
	// stored conversation is unchanged, which saves the whole messages payload.
	if value := r.Header.Get("If-None-Match"); value != "" {
		req.Header.Set("If-None-Match", value)
	}

	resp, err := client.http.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unavailable: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream read failed"})
		return
	}

	if resp.StatusCode >= http.StatusBadRequest {
		errorMsg := fmt.Sprintf("upstream error: %d", resp.StatusCode)
		var payload map[string]any
		if json.Unmarshal(body, &payload) == nil {
			if message, ok := payload["error"].(string); ok && message != "" {
				errorMsg = message
			}
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": errorMsg})
		return
	}

	// The validator travels back with the payload so the browser can send it as
	// If-None-Match on the next read...
	if etag := resp.Header.Get("ETag"); etag != "" {
		w.Header().Set("ETag", etag)
	}
	// ...and so does the freshness contract: the body may be stored, but the
	// browser must revalidate it (which the validator makes cheap).
	if cacheControl := resp.Header.Get("Cache-Control"); cacheControl != "" {
		w.Header().Set("Cache-Control", cacheControl)
	}

	if transform != nil {
		transformed, err := transform(body)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream payload parse failed"})
			return
		}
		body = transformed
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	if resp.StatusCode != http.StatusNotModified {
		_, _ = w.Write(body)
	}
}

func (client *proxyClient) forwardJSON(w http.ResponseWriter, r *http.Request, target string, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPut, target, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.http.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unavailable: " + err.Error()})
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream read failed"})
		return err
	}

	if resp.StatusCode >= http.StatusBadRequest {
		errorMsg := fmt.Sprintf("upstream error: %d", resp.StatusCode)
		var payload map[string]any
		if json.Unmarshal(respBody, &payload) == nil {
			if message, ok := payload["error"].(string); ok && message != "" {
				errorMsg = message
			}
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": errorMsg})
		return fmt.Errorf("upstream status %d", resp.StatusCode)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
	return nil
}

func (server *Server) busURL() string {
	return server.backends.BusURL
}

// agentAccessAllowed reports whether the caller may access the agent identified
// by agentID. Admin and Operations (support) may act on any agent; everyone else
// must be the agent owner. On a denied or failed lookup the response is already
// written and false is returned.
func (server *Server) agentAccessAllowed(w http.ResponseWriter, r *http.Request, agentID string) bool {
	identity := auth.FromContext(r.Context())
	if identity.CanManageUsers() {
		return true
	}
	owner, ok := server.agentOwner(w, r, agentID)
	if !ok {
		return false
	}
	if identity.UserID != owner {
		http.Error(w, "not the agent owner", http.StatusForbidden)
		return false
	}
	return true
}

func (server *Server) handleFileList(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	if !server.agentAccessAllowed(w, r, agentID) {
		return
	}
	path := r.URL.Query().Get("path")
	target := server.busURL() + "/api/v1/files/" + url.PathEscape(agentID)
	if path != "" {
		target += "?path=" + url.QueryEscape(path)
	}
	server.filesProxy(w, r, http.MethodGet, target, "", nil)
}

// handleTerminalList tunnels a live-terminal listing to the owning hypervisor.
func (server *Server) handleTerminalList(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	if !server.agentAccessAllowed(w, r, agentID) {
		return
	}
	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID) + "/terminals"
	server.filesProxy(w, r, http.MethodGet, target, "", nil)
}

// handleTerminalAttach creates (or re-attaches to) a terminal session on the
// owning hypervisor, returning {terminal_id, replay}.
func (server *Server) handleTerminalAttach(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	if !server.agentAccessAllowed(w, r, agentID) {
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read request body"})
		return
	}
	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID) + "/terminals/attach"
	server.filesProxy(w, r, http.MethodPost, target, "", body)
}

// handleTerminalKill terminates a terminal session on the owning hypervisor.
func (server *Server) handleTerminalKill(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	terminalID := r.PathValue("terminalID")
	if !server.agentAccessAllowed(w, r, agentID) {
		return
	}
	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID) + "/terminals/" + url.PathEscape(terminalID)
	server.filesProxy(w, r, http.MethodDelete, target, "", nil)
}

// handleFileContentGET downloads a file from the agent's files. Accessible
// to the agent owner or operators and above.
func (server *Server) handleFileContentGET(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	if !server.agentAccessAllowed(w, r, agentID) {
		return
	}
	path := r.URL.Query().Get("path")
	target := server.busURL() + "/api/v1/files/" + url.PathEscape(agentID) + "/content"
	if path != "" {
		target += "?path=" + url.QueryEscape(path)
	}
	server.filesProxy(w, r, http.MethodGet, target, "", nil)
}

// handleFileContentPUT uploads a file into the agent's files. Writes are
// restricted to the agent owner (operators may not mutate another user's
// files).
func (server *Server) handleFileContentPUT(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	identity := auth.FromContext(r.Context())
	owner, ok := server.agentOwner(w, r, agentID)
	if !ok {
		return
	}
	if identity.UserID != owner {
		http.Error(w, "not the agent owner", http.StatusForbidden)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxFileUploadSize+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read request body"})
		return
	}
	if len(body) > maxFileUploadSize {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds max size"})
		return
	}
	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	path := r.URL.Query().Get("path")
	target := server.busURL() + "/api/v1/files/" + url.PathEscape(agentID) + "/content"
	if path != "" {
		target += "?path=" + url.QueryEscape(path)
	}
	server.filesProxy(w, r, http.MethodPut, target, contentType, body)
}

// handleFileContentDELETE deletes a file from the agent's files. Deletes
// are restricted to the agent owner, mirroring the upload access control.
func (server *Server) handleFileContentDELETE(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	identity := auth.FromContext(r.Context())
	owner, ok := server.agentOwner(w, r, agentID)
	if !ok {
		return
	}
	if identity.UserID != owner {
		http.Error(w, "not the agent owner", http.StatusForbidden)
		return
	}

	path := r.URL.Query().Get("path")
	target := server.busURL() + "/api/v1/files/" + url.PathEscape(agentID) + "/content"
	if path != "" {
		target += "?path=" + url.QueryEscape(path)
	}
	server.filesProxy(w, r, http.MethodDelete, target, "", nil)
}

// handleFileMkdir creates a directory in the agent's files. Writes are
// restricted to the agent owner, mirroring the upload access control.
func (server *Server) handleFileMkdir(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	identity := auth.FromContext(r.Context())
	owner, ok := server.agentOwner(w, r, agentID)
	if !ok {
		return
	}
	if identity.UserID != owner {
		http.Error(w, "not the agent owner", http.StatusForbidden)
		return
	}

	path := r.URL.Query().Get("path")
	target := server.busURL() + "/api/v1/files/" + url.PathEscape(agentID) + "/mkdir"
	if path != "" {
		target += "?path=" + url.QueryEscape(path)
	}
	server.filesProxy(w, r, http.MethodPost, target, "", nil)
}

// handleFileRename renames an entry in the agent's files. Writes are
// restricted to the agent owner, mirroring the upload access control.
func (server *Server) handleFileRename(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	identity := auth.FromContext(r.Context())
	owner, ok := server.agentOwner(w, r, agentID)
	if !ok {
		return
	}
	if identity.UserID != owner {
		http.Error(w, "not the agent owner", http.StatusForbidden)
		return
	}

	query := url.Values{}
	if path := r.URL.Query().Get("path"); path != "" {
		query.Set("path", path)
	}
	if to := r.URL.Query().Get("to"); to != "" {
		query.Set("to", to)
	}
	target := server.busURL() + "/api/v1/files/" + url.PathEscape(agentID) + "/rename"
	if encoded := query.Encode(); encoded != "" {
		target += "?" + encoded
	}
	server.filesProxy(w, r, http.MethodPost, target, "", nil)
}

// handleFileCopy copies an entry in the agent's files. Writes are
// restricted to the agent owner, mirroring the upload access control.
func (server *Server) handleFileCopy(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	identity := auth.FromContext(r.Context())
	owner, ok := server.agentOwner(w, r, agentID)
	if !ok {
		return
	}
	if identity.UserID != owner {
		http.Error(w, "not the agent owner", http.StatusForbidden)
		return
	}

	query := url.Values{}
	if path := r.URL.Query().Get("path"); path != "" {
		query.Set("path", path)
	}
	if to := r.URL.Query().Get("to"); to != "" {
		query.Set("to", to)
	}
	target := server.busURL() + "/api/v1/files/" + url.PathEscape(agentID) + "/copy"
	if encoded := query.Encode(); encoded != "" {
		target += "?" + encoded
	}
	server.filesProxy(w, r, http.MethodPost, target, "", nil)
}

// maxFileUploadSize caps uploads buffered for the retry loop, mirroring the
// hypervisor's 10 MiB file limit.
const maxFileUploadSize = 10 << 20

type upstreamResult struct {
	status  int
	headers http.Header
	body    []byte
	err     error
}

// doUpstream performs a single upstream HTTP request without writing to w, so
// transient failures can be retried before any response is sent to the caller.
func (client *proxyClient) doUpstream(ctx context.Context, method, target, contentType string, body []byte) upstreamResult {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return upstreamResult{err: err}
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := client.http.Do(req)
	if err != nil {
		return upstreamResult{err: err}
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return upstreamResult{err: err}
	}
	return upstreamResult{status: resp.StatusCode, headers: resp.Header, body: respBody}
}

// filesProxy runs a retryable upstream request and mirrors the final
// response. Transient failures (transport errors and 5xx upstream responses,
// e.g. "hypervisor tunnel not registered" while a container boots) are retried
// with backoff; deterministic 4xx responses (agent/file not found) are returned
// immediately.
func (server *Server) filesProxy(w http.ResponseWriter, r *http.Request, method, target, contentType string, body []byte) {
	const attempts = 3
	backoff := 500 * time.Millisecond

	var result upstreamResult
	for attempt := 1; attempt <= attempts; attempt++ {
		result = server.proxy.doUpstream(r.Context(), method, target, contentType, body)
		if result.err == nil && result.status < http.StatusInternalServerError {
			break
		}
		if attempt < attempts {
			time.Sleep(backoff)
			backoff *= 2
		}
	}

	if result.err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unavailable: " + result.err.Error()})
		return
	}
	contentTypeOut := result.headers.Get("Content-Type")
	if contentTypeOut == "" {
		contentTypeOut = "application/json"
	}
	w.Header().Set("Content-Type", contentTypeOut)
	if cd := result.headers.Get("Content-Disposition"); cd != "" {
		w.Header().Set("Content-Disposition", cd)
	}
	w.WriteHeader(result.status)
	_, _ = w.Write(result.body)
}

func (server *Server) handleRestartContainer(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userID")
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userID is required"})
		return
	}

	target := server.busURL() + "/api/v1/containers/" + url.PathEscape(userID) + "/restart"
	if err := server.proxy.forwardPOST(w, r, target); err != nil {
		return
	}

	identity := auth.FromContext(r.Context())
	server.recordAudit(r, model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "container.restart",
		ResourceType: "container",
		ResourceID:   userID,
		IP:           clientIP(r),
	})
}

func (server *Server) handleDisposeContainer(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userID")
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userID is required"})
		return
	}

	target := server.busURL() + "/api/v1/containers/" + url.PathEscape(userID) + "/dispose"
	if err := server.proxy.forwardPOST(w, r, target); err != nil {
		return
	}

	identity := auth.FromContext(r.Context())
	server.recordAudit(r, model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "container.dispose",
		ResourceType: "container",
		ResourceID:   userID,
		IP:           clientIP(r),
	})
}

// handleReprovisionContainer revives a user's disposed/failed container request
// so nanorunner provisions a fresh container, closing the admin lifecycle loop
// without needing a provision triggered from chat traffic.
func (server *Server) handleReprovisionContainer(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userID")
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userID is required"})
		return
	}

	target := server.busURL() + "/api/v1/containers/" + url.PathEscape(userID) + "/reprovision"
	if err := server.proxy.forwardPOST(w, r, target); err != nil {
		return
	}

	identity := auth.FromContext(r.Context())
	server.recordAudit(r, model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "container.reprovision",
		ResourceType: "container",
		ResourceID:   userID,
		IP:           clientIP(r),
	})
}

func (client *proxyClient) forwardPOST(w http.ResponseWriter, r *http.Request, target string) error {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return err
	}

	resp, err := client.http.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unavailable: " + err.Error()})
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream read failed"})
		return err
	}

	if resp.StatusCode >= http.StatusBadRequest {
		errorMsg := fmt.Sprintf("upstream error: %d", resp.StatusCode)
		var payload map[string]any
		if json.Unmarshal(respBody, &payload) == nil {
			if message, ok := payload["error"].(string); ok && message != "" {
				errorMsg = message
			}
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": errorMsg})
		return fmt.Errorf("upstream status %d", resp.StatusCode)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
	return nil
}

// forwardStream POSTs the caller's body to the target unchanged, preserving its
// content type, and mirrors the response. The body is streamed rather than
// buffered, so an audio upload never sits in the portal's memory.
func (client *proxyClient) forwardStream(w http.ResponseWriter, r *http.Request, target string) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, r.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.ContentLength = r.ContentLength

	resp, err := client.http.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unavailable: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		errorMsg := fmt.Sprintf("upstream error: %d", resp.StatusCode)
		var payload map[string]any
		if json.Unmarshal(body, &payload) == nil {
			if message, ok := payload["error"].(string); ok && message != "" {
				errorMsg = message
			}
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": errorMsg})
		return
	}

	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// forwardPOSTJSON POSTs a JSON body to the target and mirrors the upstream
// response back to the caller (used for the nanoauth proxy endpoints).
func (client *proxyClient) forwardPOSTJSON(w http.ResponseWriter, r *http.Request, target string, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, bytes.NewReader(payload))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.http.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unavailable: " + err.Error()})
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream read failed"})
		return err
	}

	if resp.StatusCode >= http.StatusBadRequest {
		errorMsg := fmt.Sprintf("upstream error: %d", resp.StatusCode)
		var payload map[string]any
		if json.Unmarshal(respBody, &payload) == nil {
			if message, ok := payload["error"].(string); ok && message != "" {
				errorMsg = message
			}
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": errorMsg})
		return fmt.Errorf("upstream status %d", resp.StatusCode)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
	return nil
}

// forwardDELETE sends a DELETE to the target and mirrors the upstream response.
func (client *proxyClient) forwardDELETE(w http.ResponseWriter, r *http.Request, target string) error {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodDelete, target, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return err
	}

	resp, err := client.http.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unavailable: " + err.Error()})
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream read failed"})
		return err
	}

	if resp.StatusCode >= http.StatusBadRequest {
		errorMsg := fmt.Sprintf("upstream error: %d", resp.StatusCode)
		var payload map[string]any
		if json.Unmarshal(respBody, &payload) == nil {
			if message, ok := payload["error"].(string); ok && message != "" {
				errorMsg = message
			}
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": errorMsg})
		return fmt.Errorf("upstream status %d", resp.StatusCode)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
	return nil
}

// getJSON performs a GET and returns the raw response body.
func (client *proxyClient) getJSON(r *http.Request, target string) ([]byte, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upstream unavailable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("upstream read failed: %w", err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("upstream error: %d", resp.StatusCode)
	}
	return body, nil
}

// handleGitProxy tunnels any git-browser request (browse + git operations) to
// the bus, which forwards it through the owning user's hypervisor tunnel.
// Reads are owner-or-operator; mutations are owner-only (mirroring the files
// content access model). The full path and query are forwarded verbatim.
func (server *Server) handleGitProxy(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	if agentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agentID is required"})
		return
	}
	identity := auth.FromContext(r.Context())
	if r.Method != http.MethodGet {
		owner, ok := server.agentOwner(w, r, agentID)
		if !ok {
			return
		}
		if identity.UserID != owner {
			http.Error(w, "not the agent owner", http.StatusForbidden)
			return
		}
	} else if !server.agentAccessAllowed(w, r, agentID) {
		return
	}

	// The user routes live under /api/user/v1; the bus serves the same routes
	// under /api/v1.
	suffix := strings.TrimPrefix(r.URL.Path, "/api/user/v1")
	target := server.busURL() + "/api/v1" + suffix
	if q := r.URL.RawQuery; q != "" {
		target += "?" + q
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxFileUploadSize+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read request body"})
		return
	}
	server.filesProxy(w, r, r.Method, target, r.Header.Get("Content-Type"), body)
}

func (server *Server) handleListShortcuts(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	agentID := r.URL.Query().Get("agentID")
	shortcuts, err := server.repo.ListGitShortcuts(r.Context(), identity.UserID, agentID)
	if err != nil {
		writeError(w, err)
		return
	}
	if shortcuts == nil {
		shortcuts = []model.GitShortcut{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"shortcuts": shortcuts})
}

func (server *Server) handleAddShortcut(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AgentID string `json:"agent_id"`
		Path    string `json:"path"`
		Label   string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.AgentID == "" || body.Path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agent_id and path are required"})
		return
	}
	// Reject oversized input up front so the schema widths (user_id/agent_id
	// VARCHAR(64), path VARCHAR(512), label VARCHAR(255)) never surface as a
	// strict-mode DB error (1406) -> HTTP 500.
	if err := validateShortcutFields(body.AgentID, body.Path, body.Label); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	identity := auth.FromContext(r.Context())
	shortcut, err := server.repo.AddGitShortcut(r.Context(), identity.UserID, body.AgentID, body.Path, body.Label)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, shortcut)
}

func (server *Server) handleDeleteShortcut(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid shortcut id"})
		return
	}
	identity := auth.FromContext(r.Context())
	if err := server.repo.DeleteGitShortcut(r.Context(), identity.UserID, id); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "deleted"})
}

// shortcutFieldLimits mirror the git_browser_shortcuts column widths
// (migrations/038): internal ids are VARCHAR(64), paths VARCHAR(512) and the
// optional label VARCHAR(255). Validate before hitting MySQL so an oversized
// input returns a clean 400 instead of a strict-mode DB error -> 500.
const (
	maxShortcutAgentIDLen = 64
	maxShortcutPathLen    = 512
	maxShortcutLabelLen   = 255
)

func validateShortcutFields(agentID, path, label string) error {
	if utf8Len(agentID) > maxShortcutAgentIDLen {
		return fmt.Errorf("agent_id exceeds %d characters", maxShortcutAgentIDLen)
	}
	if utf8Len(path) > maxShortcutPathLen {
		return fmt.Errorf("path exceeds %d characters", maxShortcutPathLen)
	}
	if utf8Len(label) > maxShortcutLabelLen {
		return fmt.Errorf("label exceeds %d characters", maxShortcutLabelLen)
	}
	return nil
}

func utf8Len(s string) int {
	return len([]rune(s))
}

// directoryOps is the allowlist of read-only diagnostics the directory console
// may drive. The configuration itself is edited through the config API, not
// here.
var directoryOps = map[string]bool{
	"validate": true,
	"test":     true,
	"browse":   true,
	"analyze":  true,
	"search":   true,
	"check":    true,
}

// maxDirectoryBodyBytes caps a console request: a draft configuration plus the
// parameters of one diagnostic, CA certificate included.
const maxDirectoryBodyBytes = 256 << 10

// handleDirectoryEffective forwards the settings currently in force.
// handleDirectoryOp forwards one console diagnostic to nanoauth.
// forwardDirectory proxies a console call to nanoauth, carrying the caller's
// token: nanoauth verifies it again and enforces the management role, so a
// direct call to the auth service is held to the same rule as a call through
// this portal.
// upstreamMessage is the sentence an upstream error body carries, for a message
// that has to be reworded (see the 401/403 case above). It prefers the body's
// "error" field and falls back to the raw text, capped so a large or unexpected
// body cannot be reflected back to the caller.
func upstreamMessage(body []byte) string {
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err == nil && payload.Error != "" {
		return payload.Error
	}
	text := strings.TrimSpace(string(body))
	if len(text) > 120 {
		text = text[:120]
	}
	return text
}

func clientIP(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if ip != "" {
		if comma := strings.Index(ip, ","); comma > 0 {
			ip = ip[:comma]
		}
		return strings.TrimSpace(ip)
	}
	host := r.RemoteAddr
	if comma := strings.LastIndex(host, ":"); comma > 0 {
		host = host[:comma]
	}
	return host
}
