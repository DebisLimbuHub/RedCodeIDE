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
pub struct Engagement {
    pub id: String,
    pub name: String,
    pub client_name: String,
    pub engagement_type: String,
    pub methodology: String,
    pub status: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_engagement(row: &rusqlite::Row) -> rusqlite::Result<Engagement> {
    Ok(Engagement {
        id: row.get(0)?,
        name: row.get(1)?,
        client_name: row.get(2)?,
        engagement_type: row.get(3)?,
        methodology: row.get(4)?,
        status: row.get(5)?,
        start_date: row.get(6)?,
        end_date: row.get(7)?,
        notes: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

const SELECT_COLS: &str =
    "SELECT id, name, client_name, engagement_type, methodology, status, \
     start_date, end_date, notes, created_at, updated_at \
     FROM engagements";

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_engagement(
    state: State<'_, DbState>,
    name: String,
    client_name: String,
    engagement_type: String,
    methodology: String,
    start_date: Option<String>,
    end_date: Option<String>,
    notes: Option<String>,
) -> Result<Engagement, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    db.execute(
        "INSERT INTO engagements \
             (id, name, client_name, engagement_type, methodology, status, \
              start_date, end_date, notes, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,'active',?6,?7,?8,?9,?9)",
        params![
            id, name, client_name, engagement_type, methodology,
            start_date, end_date, notes, now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(Engagement {
        id,
        name,
        client_name,
        engagement_type,
        methodology,
        status: "active".into(),
        start_date,
        end_date,
        notes,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_engagement(state: State<'_, DbState>, id: String) -> Result<Engagement, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.query_row(
        &format!("{SELECT_COLS} WHERE id=?1"),
        params![id],
        row_to_engagement,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_engagements(
    state: State<'_, DbState>,
    status_filter: Option<String>,
) -> Result<Vec<Engagement>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;

    match status_filter.as_deref() {
        None | Some("all") => {
            let mut stmt = db
                .prepare(&format!(
                    "{SELECT_COLS} WHERE status != 'archived' ORDER BY updated_at DESC"
                ))
                .map_err(|e| e.to_string())?;
            let rows: Vec<Result<Engagement, String>> = stmt
                .query_map([], row_to_engagement)
                .map_err(|e| e.to_string())?
                .map(|r| r.map_err(|e| e.to_string()))
                .collect();
            rows.into_iter().collect()
        }
        Some(filter) => {
            let mut stmt = db
                .prepare(&format!("{SELECT_COLS} WHERE status=?1 ORDER BY updated_at DESC"))
                .map_err(|e| e.to_string())?;
            let rows: Vec<Result<Engagement, String>> = stmt
                .query_map(params![filter], row_to_engagement)
                .map_err(|e| e.to_string())?
                .map(|r| r.map_err(|e| e.to_string()))
                .collect();
            rows.into_iter().collect()
        }
    }
}

#[tauri::command]
pub fn update_engagement(
    state: State<'_, DbState>,
    id: String,
    name: String,
    client_name: String,
    engagement_type: String,
    methodology: String,
    status: String,
    start_date: Option<String>,
    end_date: Option<String>,
    notes: Option<String>,
) -> Result<Engagement, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    let n = db
        .execute(
            "UPDATE engagements \
             SET name=?2, client_name=?3, engagement_type=?4, methodology=?5, \
                 status=?6, start_date=?7, end_date=?8, notes=?9, updated_at=?10 \
             WHERE id=?1",
            params![
                id, name, client_name, engagement_type, methodology,
                status, start_date, end_date, notes, now
            ],
        )
        .map_err(|e| e.to_string())?;

    if n == 0 {
        return Err(format!("engagement '{id}' not found"));
    }

    db.query_row(
        &format!("{SELECT_COLS} WHERE id=?1"),
        params![id],
        row_to_engagement,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn archive_engagement(state: State<'_, DbState>, id: String) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let n = db
        .execute(
            "UPDATE engagements SET status='archived', updated_at=?2 WHERE id=?1",
            params![id, now],
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}
