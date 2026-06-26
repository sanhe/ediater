mod commands;
mod fs;
mod session;
mod state;

use state::AppState;

/// Build and run the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::load_session,
            commands::save_session,
            commands::list_directory,
            commands::read_file,
            commands::write_file,
            commands::watch_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ediater application");
}
