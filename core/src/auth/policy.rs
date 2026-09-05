// Centralized authorization policy for BCK Enterprise.
//
// All routes should use these helpers instead of comparing `claims.role ==
// "super_admin"` directly. The typed `UserRole` enum and the explicit
// `tenant_allows` helpers close the cross-tenant bypass that was possible when
// routes trusted the token claim string verbatim.

use crate::auth::jwt::Claims;
use crate::auth::{UserRole, User};

/// Effective authority of the caller, derived from `claims.role` (the token
/// claim). Use this everywhere instead of string comparison.
pub fn role_of(claims: &Claims) -> UserRole {
    UserRole::from_str(&claims.role).unwrap_or(UserRole::Viewer)
}

/// Is the caller a global administrator (super_admin or admin without a
/// tenant)? Used for cross-tenant surfaces (tenants, SSO providers, etc.).
pub fn is_global_admin(claims: &Claims) -> bool {
    matches!(role_of(claims), UserRole::SuperAdmin)
        || (role_of(claims) == UserRole::Admin && claims.tenant_id.is_none())
}

/// Is the caller at least a tenant-scoped admin? They can manage their own
/// tenant but not other tenants.
pub fn is_tenant_admin(claims: &Claims, tenant_id: &str) -> bool {
    if is_global_admin(claims) {
        return true;
    }
    if role_of(claims) != UserRole::Admin {
        return false;
    }
    claims.tenant_id.as_deref() == Some(tenant_id)
}

/// Can the caller mutate state (jobs, repositories, snapshots, etc.)?
pub fn can_mutate(claims: &Claims) -> bool {
    let r = role_of(claims);
    matches!(
        r,
        UserRole::SuperAdmin | UserRole::Admin | UserRole::Operator
    )
}

/// Can the caller perform restore operations?
pub fn can_restore(claims: &Claims) -> bool {
    let r = role_of(claims);
    matches!(
        r,
        UserRole::SuperAdmin
            | UserRole::Admin
            | UserRole::Operator
            | UserRole::RestoreOperator
    )
}

/// Can the caller manage hypervisors and run VM backups?
pub fn can_manage_hypervisors(claims: &Claims) -> bool {
    let r = role_of(claims);
    matches!(r, UserRole::SuperAdmin | UserRole::Admin | UserRole::Operator)
}

/// Can the caller delete an agent or create tasks for one?
pub fn can_manage_agents(claims: &Claims) -> bool {
    let r = role_of(claims);
    matches!(r, UserRole::SuperAdmin | UserRole::Admin)
}

/// Can the caller execute DR failover/failback?
pub fn can_execute_dr(claims: &Claims) -> bool {
    let r = role_of(claims);
    matches!(r, UserRole::SuperAdmin | UserRole::Admin)
}

/// Can the caller register a new DR site or plan?
pub fn can_manage_dr(claims: &Claims) -> bool {
    let r = role_of(claims);
    matches!(r, UserRole::SuperAdmin | UserRole::Admin)
}

/// The tenant the caller is scoped to, or `None` for global admins.
///
/// This is the single source of truth for "what tenant does this caller own?".
/// It mirrors the previous `scoped_tenant` helpers scattered across route
/// modules so a route cannot accidentally get the semantics wrong.
pub fn scoped_tenant(claims: &Claims) -> Option<String> {
    if is_global_admin(claims) {
        None
    } else {
        claims.tenant_id.clone()
    }
}

/// Does the caller's tenant scope permit operating on a resource owned by
/// `owner`? `owner == None` means "global" and is only accessible to global
/// admins.
pub fn tenant_allows(claims: &Claims, owner: Option<&str>) -> bool {
    match scoped_tenant(claims) {
        None => true,
        Some(mine) => owner == Some(mine.as_str()),
    }
}

/// Can the caller create tenants? Only global admins (no tenant scope).
pub fn can_create_tenants(claims: &Claims) -> bool {
    is_global_admin(claims)
}

/// Can the caller manage (CRUD) the given tenant? Tenant admins manage their
/// own tenant; global admins manage any tenant.
pub fn can_manage_tenant(claims: &Claims, tenant_id: &str) -> bool {
    if is_global_admin(claims) {
        return true;
    }
    claims.tenant_id.as_deref() == Some(tenant_id)
}

impl From<&Claims> for User {
    fn from(c: &Claims) -> Self {
        User {
            id: c.sub.clone(),
            username: c.username.clone(),
            role: role_of(c),
            email: None,
            enabled: true,
            tenant_id: c.tenant_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims_with(role: &str, tenant: Option<&str>) -> Claims {
        Claims {
            sub: "u1".into(),
            username: "u1".into(),
            role: role.into(),
            exp: 0,
            iat: 0,
            tenant_id: tenant.map(String::from),
        }
    }

    #[test]
    fn super_admin_is_global() {
        let c = claims_with("super_admin", None);
        assert!(is_global_admin(&c));
        assert!(scoped_tenant(&c).is_none());
    }

    #[test]
    fn admin_with_tenant_is_not_global() {
        let c = claims_with("admin", Some("t1"));
        assert!(!is_global_admin(&c));
        assert_eq!(scoped_tenant(&c).as_deref(), Some("t1"));
    }

    #[test]
    fn admin_without_tenant_is_global() {
        let c = claims_with("admin", None);
        assert!(is_global_admin(&c));
    }

    #[test]
    fn operator_can_mutate_not_admin() {
        let c = claims_with("operator", Some("t1"));
        assert!(can_mutate(&c));
        assert!(!is_global_admin(&c));
    }

    #[test]
    fn viewer_cannot_mutate() {
        let c = claims_with("viewer", Some("t1"));
        assert!(!can_mutate(&c));
        assert!(!can_restore(&c));
    }

    #[test]
    fn restore_operator_can_restore_but_not_mutate_jobs() {
        let c = claims_with("restore_operator", Some("t1"));
        assert!(can_restore(&c));
        assert!(!can_mutate(&c));
    }

    #[test]
    fn unknown_role_is_treated_as_viewer() {
        let c = claims_with("root", Some("t1"));
        assert!(!can_mutate(&c));
        assert!(!can_restore(&c));
    }

    #[test]
    fn tenant_allows_only_same_tenant() {
        let c = claims_with("operator", Some("t1"));
        assert!(tenant_allows(&c, Some("t1")));
        assert!(!tenant_allows(&c, Some("t2")));
        assert!(!tenant_allows(&c, None));
    }

    #[test]
    fn global_admin_sees_all() {
        let c = claims_with("super_admin", None);
        assert!(tenant_allows(&c, Some("t1")));
        assert!(tenant_allows(&c, None));
    }

    #[test]
    fn can_manage_tenant_isolated() {
        let c = claims_with("admin", Some("t1"));
        assert!(can_manage_tenant(&c, "t1"));
        assert!(!can_manage_tenant(&c, "t2"));
    }
}
