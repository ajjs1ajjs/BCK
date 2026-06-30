package auth

import (
	"testing"
)

func TestPassword_HashAndCheck(t *testing.T) {
	password := "MySecureP@ss1"

	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	if hash == "" {
		t.Fatal("hash is empty")
	}

	if err := CheckPassword(password, hash); err != nil {
		t.Errorf("check password failed: %v", err)
	}

	if err := CheckPassword("wrong-password", hash); err == nil {
		t.Error("wrong password should fail")
	}
}

func TestPassword_Strength(t *testing.T) {
	tests := []struct {
		password string
		valid    bool
	}{
		{"short", false},
		{"onlylowercase", false},
		{"ONLYUPPERCASE", false},
		{"NoDigits!", false},
		{"NoSpecial1", false},
		{"ValidP@ss1", true},
		{"C0mpl3x!P@ssw0rd", true},
	}

	for _, tt := range tests {
		err := ValidatePasswordStrength(tt.password)
		if tt.valid && err != nil {
			t.Errorf("password %q should be valid, got error: %v", tt.password, err)
		}
		if !tt.valid && err == nil {
			t.Errorf("password %q should be invalid", tt.password)
		}
	}
}

func TestRBAC_Permissions(t *testing.T) {
	tests := []struct {
		role       Role
		permission string
		allowed    bool
	}{
		{RoleAdmin, "jobs.create", true},
		{RoleOperator, "jobs.create", true},
		{RoleViewer, "jobs.create", false},
		{RoleAuditor, "jobs.create", false},

		{RoleAdmin, "repos.delete", true},
		{RoleOperator, "repos.delete", false},

		{RoleAdmin, "jobs.list", true},
		{RoleViewer, "jobs.list", true},
		{RoleAuditor, "jobs.list", true},

		{RoleAdmin, "users.create", true},
		{RoleOperator, "users.create", false},
	}

	for _, tt := range tests {
		if HasPermission(tt.role, tt.permission) != tt.allowed {
			t.Errorf("role=%s permission=%s: expected=%v", tt.role, tt.permission, tt.allowed)
		}
	}
}
