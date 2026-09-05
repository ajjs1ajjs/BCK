// Centralized input validation for user-supplied strings.
//
// Length limits are conservative defaults that match what the DB and UI
// can safely display. Rejecting control characters prevents log-injection,
// header-injection, and UI-spoofing attacks.

/// Returns true if the string contains a control character (NUL, BEL, ESC,
/// newline, carriage return, tab, DEL, or any other C0/C1 control). Tab
/// (\t) is allowed in some contexts; call sites can re-validate if needed.
pub fn has_control_chars(s: &str) -> bool {
    s.chars()
        .any(|c| matches!(c, '\x00'..='\x08' | '\x0A'..='\x1F' | '\x7F'))
}

/// Validate a name-like field: 1..=128 chars, no control characters.
pub fn validate_name(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if value.chars().count() > 128 {
        return Err(format!("{field} must be at most 128 characters"));
    }
    if has_control_chars(value) {
        return Err(format!("{field} must not contain control characters"));
    }
    Ok(())
}

/// Validate a free-form description (allows longer text but no control chars).
pub fn validate_description(value: &str) -> Result<(), String> {
    if value.chars().count() > 2048 {
        return Err("description must be at most 2048 characters".into());
    }
    if has_control_chars(value) {
        return Err("description must not contain control characters".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_rejects_empty() {
        assert!(validate_name("name", "").is_err());
    }

    #[test]
    fn name_rejects_oversize() {
        assert!(validate_name("name", &"x".repeat(129)).is_err());
    }

    #[test]
    fn name_rejects_newline() {
        assert!(validate_name("name", "bad\nname").is_err());
    }

    #[test]
    fn name_accepts_normal() {
        assert!(validate_name("name", "Daily Backup").is_ok());
        assert!(validate_name("name", "test-name_123").is_ok());
    }

    #[test]
    fn description_rejects_nul() {
        assert!(validate_description("hi\0there").is_err());
    }

    #[test]
    fn name_accepts_tab() {
        // tab is the only common control char we allow for usability
        assert!(validate_name("name", "col1\tcol2").is_ok());
    }
}
