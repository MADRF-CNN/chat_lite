use std::sync::Mutex;
use tauri::Manager;

#[derive(Clone)]
struct WindowGeometry {
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
}

#[derive(Default)]
struct EdgeWindowState(Mutex<Option<WindowGeometry>>);

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
        window.set_min_size(Some(tauri::LogicalSize::new(520.0, 420.0))).map_err(|error| error.to_string())?;
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
