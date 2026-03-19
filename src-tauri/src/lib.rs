mod commands;
mod db;
mod engine;
mod evidence;
mod scope;

use commands::{
    archive_engagement, bulk_import_targets, close_terminal, create_engagement,
    create_scope_rule, create_scope_target, create_terminal, delete_scope_rule,
    delete_scope_target, get_engagement, list_engagements, list_scope_rules, list_scope_targets,
    resize_terminal, update_engagement, update_scope_target, write_terminal, TerminalState,
};
use db::DbState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::init_db(app.handle())?;
            app.manage(DbState(std::sync::Mutex::new(conn)));
            Ok(())
        })
        .manage(TerminalState::new())
        .invoke_handler(tauri::generate_handler![
            // terminal
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            // engagements
            create_engagement,
            get_engagement,
            list_engagements,
            update_engagement,
            archive_engagement,
            // scope targets
            create_scope_target,
            list_scope_targets,
            update_scope_target,
            delete_scope_target,
            bulk_import_targets,
            // scope rules
            create_scope_rule,
            list_scope_rules,
            delete_scope_rule,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RedCode IDE");
}
