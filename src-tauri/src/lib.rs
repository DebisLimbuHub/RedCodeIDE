mod commands;
mod db;
mod engine;
mod evidence;
mod scope;

use commands::{
    close_terminal, create_terminal, resize_terminal, write_terminal, TerminalState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TerminalState::new())
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RedCode IDE");
}
