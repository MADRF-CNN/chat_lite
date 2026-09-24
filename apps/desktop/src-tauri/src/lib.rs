use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Clone)]
struct WindowGeometry {
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
}

#[derive(Default)]
struct EdgeWindowState(Mutex<Option<WindowGeometry>>);

#[cfg(unix)]
fn lock_down(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn lock_down(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

fn secret_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let file: String = name
        .chars()
        .map(|value| if value.is_ascii_alphanumeric() || value == '-' || value == '_' { value } else { '_' })
        .collect();
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("secrets");
    Ok(dir.join(file))
}

fn write_secret_path(path: &Path, value: Option<String>) -> Result<(), String> {
    match value {
        Some(value) if !value.is_empty() => {
            let dir = path.parent().ok_or_else(|| "密钥路径无效".to_string())?;
            fs::create_dir_all(dir).map_err(|error| error.to_string())?;
            lock_down(dir, 0o700)?;
            fs::write(path, value).map_err(|error| error.to_string())?;
            lock_down(path, 0o600)
        }
        _ => match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        },
    }
}

fn read_secret_path(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_secret(app: &AppHandle, name: &str, value: Option<String>) -> Result<(), String> {
    write_secret_path(&secret_path(app, name)?, value)
}

fn read_secret(app: &AppHandle, name: &str) -> Result<Option<String>, String> {
    read_secret_path(&secret_path(app, name)?)
}

#[tauri::command]
fn save_refresh_token(app: AppHandle, token: Option<String>) -> Result<(), String> {
    write_secret(&app, "refresh-token", token)
}

#[tauri::command]
fn load_refresh_token(app: AppHandle) -> Result<Option<String>, String> {
    read_secret(&app, "refresh-token")
}

#[tauri::command]
fn save_secure_value(app: AppHandle, name: String, value: Option<String>) -> Result<(), String> {
    write_secret(&app, &name, value)
}

#[tauri::command]
fn load_secure_value(app: AppHandle, name: String) -> Result<Option<String>, String> {
    read_secret(&app, &name)
}

#[tauri::command]
fn save_file(name: String, bytes: Vec<u8>) -> Result<bool, String> {
    let Some(path) = rfd::FileDialog::new().set_file_name(&name).save_file() else {
        return Ok(false);
    };
    std::fs::write(path, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn set_edge_collapsed(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, EdgeWindowState>,
    collapsed: bool,
) -> Result<(), String> {
    if collapsed {
        let geometry = WindowGeometry {
            position: window.outer_position().map_err(|error| error.to_string())?,
            size: window.outer_size().map_err(|error| error.to_string())?,
        };
        *state.0.lock().map_err(|error| error.to_string())? = Some(geometry);

        let monitor = window.current_monitor().map_err(|error| error.to_string())?
            .ok_or_else(|| "无法获取当前显示器".to_string())?;
        let scale = monitor.scale_factor();
        let handle_size = tauri::LogicalSize::new(42.0, 112.0).to_physical::<u32>(scale);
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let handle_position = tauri::PhysicalPosition::new(
            monitor_position.x + monitor_size.width as i32 - handle_size.width as i32,
            monitor_position.y + (monitor_size.height as i32 - handle_size.height as i32) / 2,
        );

        window.set_min_size(None::<tauri::Size>).map_err(|error| error.to_string())?;
        window.set_decorations(false).map_err(|error| error.to_string())?;
        window.set_resizable(false).map_err(|error| error.to_string())?;
        window.set_always_on_top(true).map_err(|error| error.to_string())?;
        window.set_size(handle_size).map_err(|error| error.to_string())?;
        window.set_position(handle_position).map_err(|error| error.to_string())?;
    } else {
        let geometry = state.0.lock().map_err(|error| error.to_string())?.take();
        window.set_decorations(true).map_err(|error| error.to_string())?;
        window.set_resizable(true).map_err(|error| error.to_string())?;
        window.set_always_on_top(false).map_err(|error| error.to_string())?;
        window.set_min_size(Some(tauri::LogicalSize::new(320.0, 300.0))).map_err(|error| error.to_string())?;
        if let Some(geometry) = geometry {
            window.set_size(geometry.size).map_err(|error| error.to_string())?;
            window.set_position(geometry.position).map_err(|error| error.to_string())?;
        }
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(EdgeWindowState::default())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![save_refresh_token, load_refresh_token, save_secure_value, load_secure_value, save_file, set_edge_collapsed])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Chat Lite");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{read_secret_path, write_secret_path};
    use std::fs;
    use std::path::PathBuf;

    fn sandbox(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("chat-lite-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir.join("secrets").join("identity_user1")
    }

    #[test]
    fn round_trips_secret() {
        let path = sandbox("round-trip");
        assert_eq!(read_secret_path(&path).unwrap(), None);
        write_secret_path(&path, Some("hunter2".to_string())).unwrap();
        assert_eq!(read_secret_path(&path).unwrap(), Some("hunter2".to_string()));
        write_secret_path(&path, Some("rotated".to_string())).unwrap();
        assert_eq!(read_secret_path(&path).unwrap(), Some("rotated".to_string()));
        write_secret_path(&path, None).unwrap();
        assert_eq!(read_secret_path(&path).unwrap(), None);
        write_secret_path(&path, Some(String::new())).unwrap();
        assert_eq!(read_secret_path(&path).unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn locks_down_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let path = sandbox("permissions");
        write_secret_path(&path, Some("value".to_string())).unwrap();
        let file = fs::metadata(&path).unwrap().permissions().mode();
        let dir = fs::metadata(path.parent().unwrap()).unwrap().permissions().mode();
        assert_eq!(file & 0o777, 0o600);
        assert_eq!(dir & 0o777, 0o700);
    }
}
