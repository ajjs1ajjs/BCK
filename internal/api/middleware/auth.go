package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/ajjs1ajjs/BCK/internal/auth"
	"github.com/ajjs1ajjs/BCK/internal/config"
	"go.uber.org/zap"
)

type contextKey string

const (
	UserIDKey   contextKey = "user_id"
	UsernameKey contextKey = "username"
	RoleKey     contextKey = "role"
)

func Auth(cfg *config.Config, logger *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"authorization header required"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				http.Error(w, `{"error":"invalid authorization header"}`, http.StatusUnauthorized)
				return
			}

			claims, err := auth.ValidateAccessToken(parts[1], cfg.Auth.JWTSecret)
			if err != nil {
				logger.Warn("invalid access token", zap.Error(err))
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, UsernameKey, claims.Username)
			ctx = context.WithValue(ctx, RoleKey, claims.Role)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetUserID(r *http.Request) string {
	val, _ := r.Context().Value(UserIDKey).(string)
	return val
}

func GetUsername(r *http.Request) string {
	val, _ := r.Context().Value(UsernameKey).(string)
	return val
}

func GetRole(r *http.Request) string {
	val, _ := r.Context().Value(RoleKey).(string)
	return val
}
