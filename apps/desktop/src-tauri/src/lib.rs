#[tauri::command]
fn save_refresh_token(token: Option<String>) -> Result<(), String> {
    let entry = keyring::Entry::new("com.chatlite.desktop", "refresh-token")
        .map_err(|error| error.to_string())?;
    match token {
        Some(value) if !value.is_empty() => entry.set_password(&value).map_err(|error| error.to_string()),
        _ => {
            let _ = entry.delete_credential();
            Ok(())
        }
    }
}

#[tauri::command]
fn load_refresh_token() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("com.chatlite.desktop", "refresh-token")
        .map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_secure_value(name: String, value: Option<String>) -> Result<(), String> {
    let entry = keyring::Entry::new("com.chatlite.desktop.e2ee", &name)
        .map_err(|error| error.to_string())?;
    match value {
        Some(value) if !value.is_empty() => entry.set_password(&value).map_err(|error| error.to_string()),
        _ => {
            let _ = entry.delete_credential();
            Ok(())
        }
    }
}

#[tauri::command]
fn load_secure_value(name: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("com.chatlite.desktop.e2ee", &name)
        .map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_file(name: String, bytes: Vec<u8>) -> Result<bool, String> {
    let Some(path) = rfd::FileDialog::new().set_file_name(&name).save_file() else {
        return Ok(false);
    };
    std::fs::write(path, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_refresh_token, load_refresh_token, save_secure_value, load_secure_value, save_file])
        .run(tauri::generate_context!())
        .expect("error while running Chat Lite");
}
