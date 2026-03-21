use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::db::DbState;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub id: String,
    pub engagement_id: String,
    pub title: String,
    pub description: Option<String>,
    /// "critical" | "high" | "medium" | "low" | "info"
    pub severity: String,
    /// "open" | "confirmed" | "false_positive" | "fixed"
    pub status: String,
    pub target_host: Option<String>,
    pub target_url: Option<String>,
    /// JSON array of MITRE ATT&CK technique IDs, e.g. ["T1190","T1059"]
    pub mitre_attack_ids: String,
    pub skill_source: Option<String>,
    pub proof_of_concept: Option<String>,
    pub remediation: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_findings(
    state: State<'_, DbState>,
    engagement_id: String,
    severity: Option<String>,
) -> Result<Vec<Finding>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, engagement_id, title, description, severity, status, target_host, \
             target_url, mitre_attack_ids, skill_source, proof_of_concept, remediation, \
             created_at, updated_at \
             FROM findings \
             WHERE engagement_id = ?1 \
               AND (?2 IS NULL OR severity = ?2) \
             ORDER BY \
               CASE severity \
                 WHEN 'critical' THEN 0 \
                 WHEN 'high'     THEN 1 \
                 WHEN 'medium'   THEN 2 \
                 WHEN 'low'      THEN 3 \
                 ELSE 4 \
               END, created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![engagement_id, severity], |row| {
            Ok(Finding {
                id: row.get(0)?,
                engagement_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                severity: row.get(4)?,
                status: row.get(5)?,
                target_host: row.get(6)?,
                target_url: row.get(7)?,
                mitre_attack_ids: row.get(8)?,
                skill_source: row.get(9)?,
                proof_of_concept: row.get(10)?,
                remediation: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

#[tauri::command]
pub fn add_finding(
    state: State<'_, DbState>,
    engagement_id: String,
    title: String,
    description: Option<String>,
    severity: String,
    target_host: Option<String>,
    target_url: Option<String>,
    mitre_attack_ids: Option<String>,
    skill_source: Option<String>,
    proof_of_concept: Option<String>,
    remediation: Option<String>,
) -> Result<Finding, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mitre = mitre_attack_ids.unwrap_or_else(|| "[]".to_string());

    db.execute(
        "INSERT INTO findings \
         (id, engagement_id, title, description, severity, status, target_host, target_url, \
          mitre_attack_ids, skill_source, proof_of_concept, remediation, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,'open',?6,?7,?8,?9,?10,?11,?12,?12)",
        params![
            id, engagement_id, title, description, severity,
            target_host, target_url, mitre, skill_source,
            proof_of_concept, remediation, now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(Finding {
        id,
        engagement_id,
        title,
        description,
        severity,
        status: "open".to_string(),
        target_host,
        target_url,
        mitre_attack_ids: mitre,
        skill_source,
        proof_of_concept,
        remediation,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_finding(
    state: State<'_, DbState>,
    id: String,
    title: String,
    description: Option<String>,
    severity: String,
    status: String,
    target_host: Option<String>,
    target_url: Option<String>,
    mitre_attack_ids: Option<String>,
    proof_of_concept: Option<String>,
    remediation: Option<String>,
) -> Result<Finding, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let mitre = mitre_attack_ids.unwrap_or_else(|| "[]".to_string());

    db.execute(
        "UPDATE findings SET \
           title = ?1, description = ?2, severity = ?3, status = ?4, \
           target_host = ?5, target_url = ?6, mitre_attack_ids = ?7, \
           proof_of_concept = ?8, remediation = ?9, updated_at = ?10 \
         WHERE id = ?11",
        params![
            title, description, severity, status,
            target_host, target_url, mitre,
            proof_of_concept, remediation, now, id
        ],
    )
    .map_err(|e| e.to_string())?;

    // Fetch the updated row to return a complete Finding
    db.query_row(
        "SELECT id, engagement_id, title, description, severity, status, target_host, \
         target_url, mitre_attack_ids, skill_source, proof_of_concept, remediation, \
         created_at, updated_at FROM findings WHERE id = ?1",
        params![id],
        |row| {
            Ok(Finding {
                id: row.get(0)?,
                engagement_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                severity: row.get(4)?,
                status: row.get(5)?,
                target_host: row.get(6)?,
                target_url: row.get(7)?,
                mitre_attack_ids: row.get(8)?,
                skill_source: row.get(9)?,
                proof_of_concept: row.get(10)?,
                remediation: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_finding(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM findings WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
