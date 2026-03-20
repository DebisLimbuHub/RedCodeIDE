use rusqlite::{Connection, Result as SqliteResult};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbState(pub Mutex<Connection>);

pub fn init_db(app: &AppHandle) -> SqliteResult<Connection> {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

    let db_path = app_dir.join("redcode.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

const SCHEMA: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS engagements (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    client_name     TEXT NOT NULL,
    engagement_type TEXT NOT NULL,
    methodology     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    start_date      TEXT,
    end_date        TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_targets (
    id              TEXT PRIMARY KEY,
    engagement_id   TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    target_type     TEXT NOT NULL,
    value           TEXT NOT NULL,
    ports           TEXT,
    protocol        TEXT,
    in_scope        INTEGER NOT NULL DEFAULT 1,
    notes           TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_rules (
    id              TEXT PRIMARY KEY,
    engagement_id   TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    rule_type       TEXT NOT NULL,
    description     TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_log (
    id              TEXT PRIMARY KEY,
    engagement_id   TEXT NOT NULL,
    command         TEXT NOT NULL,
    scope_type      TEXT NOT NULL,
    scope_detail    TEXT,
    executed        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recon_data (
    id              TEXT PRIMARY KEY,
    engagement_id   TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    target_id       TEXT REFERENCES scope_targets(id) ON DELETE SET NULL,
    data_type       TEXT NOT NULL,
    value           TEXT NOT NULL,
    source          TEXT,
    confidence      REAL NOT NULL DEFAULT 0.5,
    created_at      TEXT NOT NULL,
    UNIQUE(engagement_id, data_type, value)
);

CREATE INDEX IF NOT EXISTS idx_recon_data_engagement ON recon_data(engagement_id);
CREATE INDEX IF NOT EXISTS idx_recon_data_type ON recon_data(engagement_id, data_type);
CREATE INDEX IF NOT EXISTS idx_recon_data_target ON recon_data(engagement_id, target_id);
"#;
