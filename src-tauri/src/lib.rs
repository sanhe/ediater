mod action_log;
mod commands;
mod fs;
mod pty;
mod session;
mod state;

use state::AppState;

/// Build and run the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // Prune stale action-log files in the background of startup.
            if let Ok(dir) = action_log::logs_dir(app.handle()) {
                let _ = action_log::sweep_retention(&dir, action_log::RETENTION_DAYS);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::load_session,
            commands::save_session,
            commands::list_directory,
            commands::read_file,
            commands::write_file,
            commands::watch_paths,
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::append_action_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ediater application");
}
