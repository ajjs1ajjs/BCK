package middleware

import (
	"net/http"

	"github.com/ajjs1ajjs/BCK/internal/auth"
)

func RequireRole(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userRole := auth.Role(GetRole(r))

			if !auth.HasPermission(userRole, permission) {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
