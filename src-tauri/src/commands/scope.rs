use crate::db::DbState;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeTarget {
    pub id: String,
    pub engagement_id: String,
    pub target_type: String,
    pub value: String,
    pub ports: Option<String>,
    pub protocol: Option<String>,
    pub in_scope: bool,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeRule {
    pub id: String,
    pub engagement_id: String,
    pub rule_type: String,
    pub description: String,
    pub created_at: String,
}

fn row_to_target(row: &rusqlite::Row) -> rusqlite::Result<ScopeTarget> {
    Ok(ScopeTarget {
        id: row.get(0)?,
        engagement_id: row.get(1)?,
        target_type: row.get(2)?,
        value: row.get(3)?,
        ports: row.get(4)?,
        protocol: row.get(5)?,
        in_scope: row.get::<_, i64>(6)? != 0,
        notes: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn row_to_rule(row: &rusqlite::Row) -> rusqlite::Result<ScopeRule> {
    Ok(ScopeRule {
        id: row.get(0)?,
        engagement_id: row.get(1)?,
        rule_type: row.get(2)?,
        description: row.get(3)?,
        created_at: row.get(4)?,
    })
}

// ---------------------------------------------------------------------------
// Target type auto-detection
// ---------------------------------------------------------------------------

fn detect_target_type(value: &str) -> &'static str {
    let v = value.trim();
    if v.starts_with("http://") || v.starts_with("https://") {
        return "url";
    }
    if v.contains('/') {
        return "cidr";
    }
    let parts: Vec<&str> = v.splitn(2, '-').collect();
    if parts.len() == 2 && is_ipv4(parts[0].trim()) {
        return "range";
    }
    if is_ipv4(v) {
        return "ip";
    }
    "domain"
}

fn is_ipv4(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok())
}

// ---------------------------------------------------------------------------
// Scope target commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_scope_target(
    state: State<'_, DbState>,
    engagement_id: String,
    target_type: String,
    value: String,
    ports: Option<String>,
    protocol: Option<String>,
    in_scope: bool,
    notes: Option<String>,
) -> Result<ScopeTarget, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let in_scope_int: i64 = if in_scope { 1 } else { 0 };

    db.execute(
        "INSERT INTO scope_targets \
             (id, engagement_id, target_type, value, ports, protocol, in_scope, notes, created_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            id,
            engagement_id,
            target_type,
            value,
            ports,
            protocol,
            in_scope_int,
            notes,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(ScopeTarget {
        id,
        engagement_id,
        target_type,
        value,
        ports,
        protocol,
        in_scope,
        notes,
        created_at: now,
    })
}

#[tauri::command]
pub fn list_scope_targets(
    state: State<'_, DbState>,
    engagement_id: String,
) -> Result<Vec<ScopeTarget>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, engagement_id, target_type, value, ports, protocol, in_scope, notes, created_at \
             FROM scope_targets WHERE engagement_id=?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<Result<ScopeTarget, String>> = stmt
        .query_map(params![engagement_id], row_to_target)
        .map_err(|e| e.to_string())?
        .map(|r| r.map_err(|e| e.to_string()))
        .collect();
    rows.into_iter().collect()
}

#[tauri::command]
pub fn update_scope_target(
    state: State<'_, DbState>,
    id: String,
    target_type: String,
    value: String,
    ports: Option<String>,
    protocol: Option<String>,
    in_scope: bool,
    notes: Option<String>,
) -> Result<ScopeTarget, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let in_scope_int: i64 = if in_scope { 1 } else { 0 };

    let n = db
        .execute(
            "UPDATE scope_targets \
             SET target_type=?2, value=?3, ports=?4, protocol=?5, in_scope=?6, notes=?7 \
             WHERE id=?1",
            params![id, target_type, value, ports, protocol, in_scope_int, notes],
        )
        .map_err(|e| e.to_string())?;

    if n == 0 {
        return Err(format!("scope target '{id}' not found"));
    }

    db.query_row(
        "SELECT id, engagement_id, target_type, value, ports, protocol, in_scope, notes, created_at \
         FROM scope_targets WHERE id=?1",
        params![id],
        row_to_target,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_scope_target(state: State<'_, DbState>, id: String) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let n = db
        .execute("DELETE FROM scope_targets WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// Parse a block of text (one target per line) and bulk-insert.
/// Lines starting with '#' or blank lines are skipped.
/// Target type is auto-detected from the value.
#[tauri::command]
pub fn bulk_import_targets(
    state: State<'_, DbState>,
    engagement_id: String,
    text: String,
    in_scope: bool,
) -> Result<Vec<ScopeTarget>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let in_scope_int: i64 = if in_scope { 1 } else { 0 };
    let mut inserted = Vec::new();

    for raw in text.lines() {
        let value = raw.trim();
        if value.is_empty() || value.starts_with('#') {
            continue;
        }
        let target_type = detect_target_type(value);
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        db.execute(
            "INSERT INTO scope_targets \
                 (id, engagement_id, target_type, value, ports, protocol, in_scope, notes, created_at) \
             VALUES (?1,?2,?3,?4,NULL,NULL,?5,NULL,?6)",
            params![id, engagement_id, target_type, value, in_scope_int, now],
        )
        .map_err(|e| e.to_string())?;

        inserted.push(ScopeTarget {
            id,
            engagement_id: engagement_id.clone(),
            target_type: target_type.to_string(),
            value: value.to_string(),
            ports: None,
            protocol: None,
            in_scope,
            notes: None,
            created_at: now,
        });
    }

    Ok(inserted)
}

// ---------------------------------------------------------------------------
// Scope rule commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_scope_rule(
    state: State<'_, DbState>,
    engagement_id: String,
    rule_type: String,
    description: String,
) -> Result<ScopeRule, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    db.execute(
        "INSERT INTO scope_rules (id, engagement_id, rule_type, description, created_at) \
         VALUES (?1,?2,?3,?4,?5)",
        params![id, engagement_id, rule_type, description, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(ScopeRule {
        id,
        engagement_id,
        rule_type,
        description,
        created_at: now,
    })
}

#[tauri::command]
pub fn list_scope_rules(
    state: State<'_, DbState>,
    engagement_id: String,
) -> Result<Vec<ScopeRule>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, engagement_id, rule_type, description, created_at \
             FROM scope_rules WHERE engagement_id=?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<Result<ScopeRule, String>> = stmt
        .query_map(params![engagement_id], row_to_rule)
        .map_err(|e| e.to_string())?
        .map(|r| r.map_err(|e| e.to_string()))
        .collect();
    rows.into_iter().collect()
}

#[tauri::command]
pub fn delete_scope_rule(state: State<'_, DbState>, id: String) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let n = db
        .execute("DELETE FROM scope_rules WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}
