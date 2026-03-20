// Scope enforcement logic
mod checker;
pub use checker::{
    check_scope, check_scope_with_conn, extract_targets_from_command, log_command, ScopeCheckResult,
};
