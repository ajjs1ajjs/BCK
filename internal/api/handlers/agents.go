package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ajjs1ajjs/BCK/internal/models"
	"github.com/ajjs1ajjs/BCK/internal/store"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func (h *Handler) ListAgents(w http.ResponseWriter, r *http.Request) {
	as := store.NewAgentStore(h.db)
	agents, err := as.List(r.Context())
	if err != nil {
		h.logger.Error("list agents", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to list agents")
		return
	}
	if agents == nil {
		agents = []models.Agent{}
	}
	respondJSON(w, http.StatusOK, agents)
}

func (h *Handler) GetAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	as := store.NewAgentStore(h.db)
	agent, err := as.Get(r.Context(), id)
	if err != nil {
		respondError(w, http.StatusNotFound, "agent not found")
		return
	}
	respondJSON(w, http.StatusOK, agent)
}

func (h *Handler) RegisterAgent(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" || req.Address == "" || req.Port == 0 {
		respondError(w, http.StatusBadRequest, "name, address, and port are required")
		return
	}
	if req.Port == 0 {
		req.Port = 50051
	}

	as := store.NewAgentStore(h.db)
	agent, err := as.Register(r.Context(), &req)
	if err != nil {
		h.logger.Error("register agent", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to register agent")
		return
	}
	respondJSON(w, http.StatusCreated, agent)
}

func (h *Handler) UpdateAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	as := store.NewAgentStore(h.db)
	if err := as.UpdateStatus(r.Context(), id, req.Status); err != nil {
		respondError(w, http.StatusNotFound, "agent not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	as := store.NewAgentStore(h.db)
	if err := as.Delete(r.Context(), id); err != nil {
		respondError(w, http.StatusNotFound, "agent not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
