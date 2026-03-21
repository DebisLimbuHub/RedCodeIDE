mod commands;
mod db;
mod engine;
mod evidence;
mod scope;

use commands::{
    add_credential, add_finding, add_recon_data, archive_engagement, bulk_import_targets,
    close_terminal, create_engagement, create_scope_rule, create_scope_target, create_terminal,
    delete_credential, delete_finding, delete_payload_template, delete_recon_data,
    delete_scope_rule, delete_scope_target, force_execute, get_attack_techniques, get_engagement,
    get_recon_data, get_recon_summary, import_recon_data, list_credentials, list_engagements,
    list_findings, list_payload_templates, list_scope_rules, list_scope_targets,
    list_technique_log, log_technique_used, resize_terminal, save_custom_payload,
    set_terminal_engagement, update_credential_status, update_engagement, update_finding,
    update_scope_target, write_terminal, TerminalState,
};
use db::DbState;
use scope::{check_scope, log_command};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::init_db(app.handle())?;
            commands::exploit::seed_payload_defaults(&conn);
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
            // scope enforcement
            check_scope,
            log_command,
            // terminal helpers
            set_terminal_engagement,
            force_execute,
            // recon
            get_recon_summary,
            get_recon_data,
            add_recon_data,
            import_recon_data,
            delete_recon_data,
            // exploit
            list_credentials,
            add_credential,
            update_credential_status,
            delete_credential,
            list_payload_templates,
            save_custom_payload,
            delete_payload_template,
            get_attack_techniques,
            log_technique_used,
            list_technique_log,
            // findings
            list_findings,
            add_finding,
            update_finding,
            delete_finding,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RedCode IDE");
}
