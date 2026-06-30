package auth

import (
	"fmt"
	"net/http"
	"slices"
)

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleOperator Role = "operator"
	RoleViewer   Role = "viewer"
	RoleAuditor  Role = "auditor"
)

var roleHierarchy = map[Role]int{
	RoleAdmin:    4,
	RoleOperator: 3,
	RoleAuditor:  2,
	RoleViewer:   1,
}

// Permission matrix per endpoint group
var endpointPermissions = map[string][]Role{
	// Auth - all authenticated users
	"auth.me":       {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},
	"auth.refresh":  {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},

	// Jobs - write: admin, operator | read: all
	"jobs.list":     {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},
	"jobs.get":      {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},
	"jobs.create":   {RoleAdmin, RoleOperator},
	"jobs.update":   {RoleAdmin, RoleOperator},
	"jobs.delete":   {RoleAdmin},
	"jobs.run":      {RoleAdmin, RoleOperator},
	"jobs.runs":     {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},

	// Repositories - write: admin | read: all
	"repos.list":    {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},
	"repos.get":     {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},
	"repos.create":  {RoleAdmin},
	"repos.update":  {RoleAdmin},
	"repos.delete":  {RoleAdmin},

	// Restore - admin, operator
	"restore.start":  {RoleAdmin, RoleOperator},
	"restore.status": {RoleAdmin, RoleOperator, RoleViewer},
	"restore.list":   {RoleAdmin, RoleOperator, RoleViewer},

	// Snapshots - all read
	"snapshots.list": {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},
	"snapshots.get":  {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},

	// Stats - all read
	"stats.get":      {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},

	// Health - public
	"health":         {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},

	// Users - admin only
	"users.list":     {RoleAdmin},
	"users.get":      {RoleAdmin},
	"users.create":   {RoleAdmin},
	"users.update":   {RoleAdmin},
	"users.delete":   {RoleAdmin},

	// Notifications - all
	"notifications.list": {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},
	"notifications.read": {RoleAdmin, RoleOperator, RoleViewer, RoleAuditor},
}

func HasPermission(userRole Role, permission string) bool {
	allowedRoles, ok := endpointPermissions[permission]
	if !ok {
		return false
	}
	return slices.Contains(allowedRoles, userRole)
}

func IsRoleHigherOrEqual(role Role, minRole Role) bool {
	roleLevel, ok := roleHierarchy[role]
	if !ok {
		return false
	}
	minLevel, ok := roleHierarchy[minRole]
	if !ok {
		return false
	}
	return roleLevel >= minLevel
}

func CheckPermission(r *http.Request, userRole Role, permission string) error {
	if !HasPermission(userRole, permission) {
		return fmt.Errorf("access denied: role %s lacks permission %s", userRole, permission)
	}
	return nil
}
