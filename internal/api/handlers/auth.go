package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ajjs1ajjs/BCK/internal/auth"
	"github.com/ajjs1ajjs/BCK/internal/api/middleware"
	"github.com/ajjs1ajjs/BCK/internal/config"
	"github.com/ajjs1ajjs/BCK/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Handler struct {
	cfg    *config.Config
	db     *pgxpool.Pool
	redis  *redis.Client
	logger *zap.Logger
}

func New(cfg *config.Config, db *pgxpool.Pool, redis *redis.Client, logger *zap.Logger) *Handler {
	return &Handler{
		cfg:    cfg,
		db:     db,
		redis:  redis,
		logger: logger,
	}
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	err := h.db.Ping(r.Context())
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "database not ready")
		return
	}

	if err := h.redis.Ping(r.Context()).Err(); err != nil {
		respondError(w, http.StatusServiceUnavailable, "redis not ready")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Username == "" || req.Password == "" {
		respondError(w, http.StatusBadRequest, "username and password are required")
		return
	}

	var user models.User
	err := h.db.QueryRow(r.Context(),
		`SELECT id, username, email, password_hash, role, is_active
		 FROM users WHERE username = $1`, req.Username,
	).Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Role, &user.IsActive)

	if err != nil {
		h.logger.Warn("login failed: user not found", zap.String("username", req.Username))
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if !user.IsActive {
		respondError(w, http.StatusForbidden, "account is disabled")
		return
	}

	if err := auth.CheckPassword(req.Password, user.PasswordHash); err != nil {
		h.logger.Warn("login failed: invalid password", zap.String("username", req.Username))
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	accessToken, expiresIn, err := auth.GenerateAccessToken(
		user.ID, user.Username, string(user.Role),
		h.cfg.Auth.JWTSecret, h.cfg.Auth.TokenExpiry,
	)
	if err != nil {
		h.logger.Error("failed to generate access token", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	refreshToken, err := auth.GenerateRefreshToken(
		user.ID, h.cfg.Auth.RefreshSecret, h.cfg.Auth.RefreshTokenExpiry,
	)
	if err != nil {
		h.logger.Error("failed to generate refresh token", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	// Store refresh token hash
	refreshHash, _ := auth.HashPassword(refreshToken)
	_, err = h.db.Exec(r.Context(),
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		 VALUES ($1, $2, NOW() + $3::interval)`,
		user.ID, refreshHash, h.cfg.Auth.RefreshTokenExpiry.String(),
	)
	if err != nil {
		h.logger.Error("failed to store refresh token", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to store token")
		return
	}

	// Update last login
	h.db.Exec(r.Context(),
		`UPDATE users SET last_login_at = NOW() WHERE id = $1`, user.ID,
	)

	user.PasswordHash = ""

	respondJSON(w, http.StatusOK, models.LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    expiresIn,
		User:         &user,
	})
}

func (h *Handler) RefreshToken(w http.ResponseWriter, r *http.Request) {
	var req models.RefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	claims, err := auth.ValidateRefreshToken(req.RefreshToken, h.cfg.Auth.RefreshSecret)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	// Verify token exists in DB
	var tokenHash string
	err = h.db.QueryRow(r.Context(),
		`SELECT token_hash FROM refresh_tokens
		 WHERE user_id = $1 AND expires_at > NOW()
		 ORDER BY created_at DESC LIMIT 1`,
		claims.Subject,
	).Scan(&tokenHash)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "refresh token not found")
		return
	}

	// Verify hash matches
	if err := auth.CheckPassword(req.RefreshToken, tokenHash); err != nil {
		respondError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	var user models.User
	err = h.db.QueryRow(r.Context(),
		`SELECT id, username, email, role, is_active FROM users WHERE id = $1`,
		claims.Subject,
	).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.IsActive)
	if err != nil || !user.IsActive {
		respondError(w, http.StatusUnauthorized, "user not found or inactive")
		return
	}

	accessToken, expiresIn, err := auth.GenerateAccessToken(
		user.ID, user.Username, string(user.Role),
		h.cfg.Auth.JWTSecret, h.cfg.Auth.TokenExpiry,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	refreshToken, err := auth.GenerateRefreshToken(
		user.ID, h.cfg.Auth.RefreshSecret, h.cfg.Auth.RefreshTokenExpiry,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	// Delete old refresh tokens and store new
	h.db.Exec(r.Context(),
		`DELETE FROM refresh_tokens WHERE user_id = $1`, user.ID,
	)
	refreshHash, _ := auth.HashPassword(refreshToken)
	h.db.Exec(r.Context(),
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		 VALUES ($1, $2, NOW() + $3::interval)`,
		user.ID, refreshHash, h.cfg.Auth.RefreshTokenExpiry.String(),
	)

	respondJSON(w, http.StatusOK, models.LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    expiresIn,
	})
}

func (h *Handler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var user models.User
	err := h.db.QueryRow(r.Context(),
		`SELECT id, username, email, role, is_active, last_login_at, created_at, updated_at
		 FROM users WHERE id = $1`, userID,
	).Scan(&user.ID, &user.Username, &user.Email, &user.Role,
		&user.IsActive, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}

	respondJSON(w, http.StatusOK, user)
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}
