fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            connect_to_server,
            trigger_backup,
            get_system_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn connect_to_server(url: String, token: String) -> Result<String, String> {
    Ok(format!("Connected to {}", url))
}

#[tauri::command]
async fn trigger_backup(job_id: String) -> Result<String, String> {
    Ok(format!("Backup triggered for job {}", job_id))
}

#[tauri::command]
async fn get_system_status() -> Result<String, String> {
    Ok(r#"{"status":"operational","uptime":"72h","jobs_active":5}"#.to_string())
}
