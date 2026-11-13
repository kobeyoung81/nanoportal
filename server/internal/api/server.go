package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
	"gitee.com/kobeyoung81/nanoportal/server/internal/repository"
)

type Server struct {
	repo     repository.Repository
	backends Backends
	proxy    *proxyClient
	// store is the portal's own data: agents, groups, binding preferences and
	// (from the session slice on) the conversation projection. It is the narrow
	// interface the handlers use, so the HTTP layer tests without a database.
	store PortalStore
}

func New(repo repository.Repository, backends Backends, st PortalStore, validator *auth.JWKSValidator) http.Handler {
	server := &Server{
		repo:     repo,
		backends: backends.normalize(),
		proxy:    newProxyClient(),
		store:    st,
	}
	jwtAuth := auth.NewJWTAuth(validator).Middleware

	mux := http.NewServeMux()

	// Public routes: health + auth (proxied to nanoauth via the bus).
	mux.HandleFunc("GET /healthz", server.handleHealth)
	// Identity is nanoauth's, and nginx routes /api/v1/auth/* (and the older
	// /api/auth/v1/*) straight there.
	// The portal keeps no auth proxy: a login that needs this service to be up
	// was one hop too many.

	// Admin-console section gates. Membership is explicit per section because
	// the roles are not strictly linear (Operations = support, DevOps = operator).
	console := auth.RequireSection(auth.SectionOverview)
	operations := auth.RequireSection(auth.SectionOperations)
	management := auth.RequireSection(auth.SectionManagement)
	auditSec := auth.RequireSection(auth.SectionAudit)

	// User namespace: anything a normal user needs. Ownership is enforced per
	// resource (owner or operator+); operators reuse these endpoints for the
	// cross-user admin views.
	userMux := http.NewServeMux()
	userMux.HandleFunc("GET /api/user/v1/me", server.handleMe)
	userMux.HandleFunc("POST /api/user/v1/me/password", server.handleChangeMyPassword)
	userMux.HandleFunc("GET /api/user/v1/me/detail", server.handleMeDetail)
	userMux.HandleFunc("GET /api/user/v1/me/agents", server.handleMeAgents)
	userMux.HandleFunc("POST /api/user/v1/me/container/restart", server.handleMeContainerRestart)

	// Agents + sessions: owner-or-operator.
	userMux.HandleFunc("POST /api/user/v1/agents", server.handleCreateAgent)
	userMux.HandleFunc("GET /api/user/v1/agents/{agentID}", server.handleAgent)
	userMux.HandleFunc("PUT /api/user/v1/agents/{agentID}", server.handleUpdateAgent)
	userMux.HandleFunc("POST /api/user/v1/agents/{agentID}/provision", server.handleProvisionAgent)
	userMux.HandleFunc("POST /api/user/v1/agents/{agentID}/restart", server.handleRestartAgent)
	userMux.HandleFunc("POST /api/user/v1/agents/{agentID}/restore", server.handleRestoreAgent)
	userMux.HandleFunc("DELETE /api/user/v1/agents/{agentID}", server.handleDeleteAgent)
	userMux.HandleFunc("GET /api/user/v1/agents/{agentID}/sessions", server.handleAgentSessions)
	// One per-agent setting's effective value ("inherit" needs to say what it
	// currently inherits).
	userMux.HandleFunc("GET /api/user/v1/agents/{agentID}/settings/{key}", server.handleAgentSetting)
	// Literal path, more specific than /api/user/v1/agents/{agentID}: the
	// attention snapshot covers every agent the caller owns, so it takes no id.
	userMux.HandleFunc("GET /api/user/v1/agents/attention", server.handleAgentAttention)

	// Agent groups: the caller's private organization of their own agents. The
	// literal /reorder is more specific than /{groupID}.
	userMux.HandleFunc("GET /api/user/v1/agent-groups", server.handleListAgentGroups)
	userMux.HandleFunc("POST /api/user/v1/agent-groups", server.handleCreateAgentGroup)
	userMux.HandleFunc("POST /api/user/v1/agent-groups/reorder", server.handleReorderAgentGroups)
	userMux.HandleFunc("POST /api/user/v1/agent-groups/arrange", server.handleArrangeAgentGroups)
	userMux.HandleFunc("PUT /api/user/v1/agent-groups/{groupID}", server.handleRenameAgentGroup)
	userMux.HandleFunc("DELETE /api/user/v1/agent-groups/{groupID}", server.handleDeleteAgentGroup)
	userMux.HandleFunc("GET /api/user/v1/sessions/{sessionID}", server.handleSession)
	userMux.HandleFunc("DELETE /api/user/v1/sessions/{sessionID}", server.handleArchiveSession)

	// Agent files browser + exchange (tunneled to the owning hypervisor).

	// Agent terminals (tunneled to the owning hypervisor; live io goes
	// over the gateway WebSocket).
	userMux.HandleFunc("GET /api/user/v1/agents/{agentID}/terminals", server.handleTerminalList)
	userMux.HandleFunc("POST /api/user/v1/agents/{agentID}/terminals/attach", server.handleTerminalAttach)
	userMux.HandleFunc("DELETE /api/user/v1/agents/{agentID}/terminals/{terminalID}", server.handleTerminalKill)

	// Git browser (browse + git ops, tunneled to the owning hypervisor).

	// Git browser shortcuts (server-side favorites, per user + agent).
	userMux.HandleFunc("GET /api/user/v1/me/shortcuts", server.handleListShortcuts)
	userMux.HandleFunc("POST /api/user/v1/me/shortcuts", server.handleAddShortcut)
	userMux.HandleFunc("DELETE /api/user/v1/me/shortcuts/{id}", server.handleDeleteShortcut)

	// User capability library + per-agent capability settings.
	userMux.HandleFunc("GET /api/user/v1/library", server.handleMyLibrary)
	userMux.HandleFunc("POST /api/user/v1/library/mcp", func(w http.ResponseWriter, r *http.Request) {
		server.handleMyLibraryCreate(w, r, "mcp")
	})
	userMux.HandleFunc("POST /api/user/v1/library/mcp/test", server.handleMyMcpTest)
	userMux.HandleFunc("PUT /api/user/v1/library/mcp/{id}", func(w http.ResponseWriter, r *http.Request) {
		server.handleMyLibraryUpdate(w, r, "mcp")
	})
	userMux.HandleFunc("DELETE /api/user/v1/library/mcp/{id}", func(w http.ResponseWriter, r *http.Request) {
		server.handleMyLibraryDelete(w, r, "mcp")
	})
	userMux.HandleFunc("POST /api/user/v1/library/skills", func(w http.ResponseWriter, r *http.Request) {
		server.handleMyLibraryCreate(w, r, "skills")
	})
	userMux.HandleFunc("PUT /api/user/v1/library/skills/{id}", func(w http.ResponseWriter, r *http.Request) {
		server.handleMyLibraryUpdate(w, r, "skills")
	})
	userMux.HandleFunc("DELETE /api/user/v1/library/skills/{id}", func(w http.ResponseWriter, r *http.Request) {
		server.handleMyLibraryDelete(w, r, "skills")
	})
	userMux.HandleFunc("GET /api/user/v1/agents/{agentID}/capabilities", server.handleAgentCapabilities)
	userMux.HandleFunc("PUT /api/user/v1/agents/{agentID}/capabilities", server.handleSetAgentCapability)
	userMux.HandleFunc("DELETE /api/user/v1/agents/{agentID}/capabilities", server.handleDeleteAgentCapability)

	// User model library (own scope; user supplies provider credentials).
	userMux.HandleFunc("GET /api/user/v1/agent-types", server.handleMyAgentTypes)
	userMux.HandleFunc("GET /api/user/v1/agents/{agentID}/prompt-blocks", server.handleUserPromptBlocks)
	// The account's language (the user-level half of the two-level setting).
	userMux.HandleFunc("GET /api/user/v1/preferences", server.handleMyPreferences)
	userMux.HandleFunc("PUT /api/user/v1/preferences", server.handleMyPreferencesSave)
	userMux.HandleFunc("GET /api/user/v1/permission-keys", server.handleMyPermissionKeys)
	userMux.HandleFunc("PUT /api/user/v1/agents/{agentID}/permissions", server.handleSetAgentPermissions)
	// Per-(agent, mode) override config (model/thinking/settings).
	userMux.HandleFunc("GET /api/user/v1/agents/{agentID}/modes/{typeID}", server.handleGetAgentMode)
	userMux.HandleFunc("PUT /api/user/v1/agents/{agentID}/modes/{typeID}", server.handleSetAgentMode)

	userMux.HandleFunc("GET /api/user/v1/models", server.handleMyModelsList)
	userMux.HandleFunc("POST /api/user/v1/models/providers", server.handleMyProviderCreate)
	userMux.HandleFunc("POST /api/user/v1/models/providers/test", server.handleMyProviderTest)
	userMux.HandleFunc("PUT /api/user/v1/models/providers/{id}", server.handleMyProviderUpdate)
	userMux.HandleFunc("DELETE /api/user/v1/models/providers/{id}", server.handleMyProviderDelete)
	userMux.HandleFunc("POST /api/user/v1/models/models", server.handleMyModelCreate)
	userMux.HandleFunc("POST /api/user/v1/models/test", server.handleMyModelTest)
	userMux.HandleFunc("PUT /api/user/v1/models/models/{id}", server.handleMyModelUpdate)
	userMux.HandleFunc("DELETE /api/user/v1/models/models/{id}", server.handleMyModelDelete)

	// Voice input for the composer: the settings, the one-time session mint and
	// the post-recording helpers. The audio stream is a WebSocket that nginx
	// passes straight to the bus, so it never reaches this service.
	userMux.HandleFunc("GET /api/user/v1/voice/config", server.handleVoiceConfig)
	userMux.HandleFunc("POST /api/user/v1/voice/session", server.handleVoiceSession)
	userMux.HandleFunc("POST /api/user/v1/voice/polish", server.handleVoicePolish)
	userMux.HandleFunc("POST /api/user/v1/voice/transcribe", server.handleVoiceTranscribe)
	userMux.HandleFunc("POST /api/user/v1/voice/refine", server.handleVoiceRefine)

	// Admin namespace: operational views and cross-user management. The base
	// gate admits any admin-console role; each route is then narrowed to the
	// section that owns it (see auth.SectionRoles).
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("GET /api/admin/v1/overview", server.handleOverview)
	adminMux.HandleFunc("GET /api/admin/v1/components", server.handleComponents)
	adminMux.HandleFunc("GET /api/admin/v1/components/{componentType}", server.handleComponent)

	// Operations (Users): user records plus their containers, agents and storage.
	adminMux.Handle("GET /api/admin/v1/users", operations(http.HandlerFunc(server.handleUsers)))
	adminMux.Handle("GET /api/admin/v1/users/{userID}", operations(http.HandlerFunc(server.handleUser)))
	adminMux.Handle("GET /api/admin/v1/users/{userID}/agents", operations(http.HandlerFunc(server.handleUserAgents)))
	adminMux.Handle("PATCH /api/admin/v1/users/{userID}/role", operations(http.HandlerFunc(server.handleUpdateUserRole)))
	adminMux.Handle("PATCH /api/admin/v1/users/{userID}/tier", operations(http.HandlerFunc(server.handleUpdateUserTier)))
	adminMux.Handle("POST /api/admin/v1/users/{userID}/freeze", operations(http.HandlerFunc(server.handleFreezeUser)))
	adminMux.Handle("POST /api/admin/v1/users/{userID}/unfreeze", operations(http.HandlerFunc(server.handleUnfreezeUser)))
	adminMux.Handle("POST /api/admin/v1/users/{userID}/restore", operations(http.HandlerFunc(server.handleRestoreUser)))
	adminMux.Handle("POST /api/admin/v1/users/{userID}/reset-password", operations(http.HandlerFunc(server.handleResetUserPassword)))
	adminMux.Handle("DELETE /api/admin/v1/users/{userID}", operations(http.HandlerFunc(server.handleDeleteUser)))
	adminMux.Handle("POST /api/admin/v1/containers/{userID}/dispose", operations(http.HandlerFunc(server.handleDisposeContainer)))
	adminMux.Handle("POST /api/admin/v1/containers/{userID}/restart", operations(http.HandlerFunc(server.handleRestartContainer)))
	adminMux.Handle("POST /api/admin/v1/containers/{userID}/reprovision", operations(http.HandlerFunc(server.handleReprovisionContainer)))

	// Management (platform catalog): configs, models, capabilities, agent types.
	// Config values may include secrets now that masking was removed, so the
	// read endpoints are gated to the Management section like the writes.

	// Directory login console: the settings themselves are read and written
	// through the config API above (they live in service_config_items); these
	// routes only carry the read-only diagnostics — a connection probe, the
	// directory tree, an attribute analysis and a login dry run.

	// Runners registry (DevOps infrastructure pruning).
	adminMux.Handle("GET /api/admin/v1/runners", management(http.HandlerFunc(server.handleRunners)))
	adminMux.Handle("DELETE /api/admin/v1/runners/{id}", management(http.HandlerFunc(server.handleDeleteRunner)))

	// Audit: operation logs plus conversation/runtime views.
	adminMux.Handle("GET /api/admin/v1/conversations", auditSec(http.HandlerFunc(server.handleConversations)))
	adminMux.Handle("GET /api/admin/v1/conversations/{sessionID}", auditSec(http.HandlerFunc(server.handleConversation)))
	adminMux.Handle("GET /api/admin/v1/runtime", auditSec(http.HandlerFunc(server.handleRuntime)))

	// Messages (alert rules).

	// Configuration, catalogues, prompts, permission keys, alert rules and the
	// audit trail are the admin module's; nginx routes those console paths there.

	// Internal endpoints: service-to-service calls authenticated with the shared
	// deployment token, not user traffic.
	mux.Handle("/internal/", accessLog(server.newInternalMux()))

	mux.Handle("/api/user/v1/", accessLog(jwtAuth(userMux)))
	mux.Handle("/api/admin/v1/", accessLog(jwtAuth(console(adminMux))))

	return withCORS(mux)
}

// handleLogin proxies the password grant to nanoauth (/auth/v1/token via the bus).
// handleRegister proxies account registration to nanoauth (/auth/v1/register).
// nanoauth returns tokens on success, so the client can sign in immediately.
// handleRefresh proxies refresh-token rotation to nanoauth (/auth/v1/token/refresh).
// handleLogout proxies refresh-token revocation to nanoauth (/auth/v1/logout).
func (server *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (server *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, auth.FromContext(r.Context()))
}

// handleMeDetail returns the caller's own account detail (tier, containers,
// effective config) without requiring operator privileges.
func (server *Server) handleMeDetail(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	user, err := server.repo.GetUser(r.Context(), identity.UserID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// handleMeAgents returns the caller's own agents.
// handleMeContainerRestart restarts the caller's own agent container.
func (server *Server) handleMeContainerRestart(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	userID := identity.UserID

	target := server.busURL() + "/api/v1/containers/" + url.PathEscape(userID) + "/restart"
	if err := server.proxy.forwardPOST(w, r, target); err != nil {
		return
	}

	server.recordAudit(r, model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "container.restart",
		ResourceType: "container",
		ResourceID:   userID,
		IP:           clientIP(r),
	})
}

func (server *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := server.repo.GetOverview(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (server *Server) handleComponents(w http.ResponseWriter, r *http.Request) {
	components, err := server.repo.ListComponents(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, components)
}

func (server *Server) handleComponent(w http.ResponseWriter, r *http.Request) {
	component, err := server.repo.GetComponent(r.Context(), r.PathValue("componentType"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, component)
}

func (server *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	includeDeleted := r.URL.Query().Get("include_deleted") == "true"
	users, err := server.repo.ListUsers(r.Context(), includeDeleted)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (server *Server) handleUser(w http.ResponseWriter, r *http.Request) {
	user, err := server.repo.GetUser(r.Context(), r.PathValue("userID"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (server *Server) handleRunners(w http.ResponseWriter, r *http.Request) {
	runners, err := server.repo.ListRunners(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, runners)
}

func (server *Server) handleDeleteRunner(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := server.repo.DeleteRunner(r.Context(), id); err != nil {
		writeError(w, err)
		return
	}

	identity := auth.FromContext(r.Context())
	server.recordAudit(r, model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "runner.delete",
		ResourceType: "runner",
		ResourceID:   id,
		IP:           clientIP(r),
	})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "deleted"})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if strings.Contains(strings.ToLower(err.Error()), "not found") {
		status = http.StatusNotFound
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
