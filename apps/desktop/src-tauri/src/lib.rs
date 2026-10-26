// SPDX-License-Identifier: AGPL-3.0-or-later

//! Standard generic Tauri v2 host launcher.
//! All application logic, commands, and file processing are authored in TypeScript and WebAssembly.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
