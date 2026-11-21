use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, Url, WindowEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntry {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    pub width: f64,
    pub height: f64,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub maximized: bool,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            width: 1280.0,
            height: 860.0,
            x: None,
            y: None,
            maximized: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DesktopConfig {
    #[serde(rename = "activeUrl", default)]
    pub active_url: String,
    #[serde(default)]
    pub servers: Vec<ServerEntry>,
    #[serde(default)]
    pub window: WindowConfig,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProbeResult {
    pub ok: bool,
    #[serde(rename = "normalizedUrl")]
    pub normalized_url: String,
    #[serde(rename = "latencyMs")]
    pub latency_ms: u64,
    pub message: String,
}

struct GuideUrlState(Mutex<Option<Url>>);

fn resolve_override_config_path() -> Option<PathBuf> {
    if let Ok(override_dir) = std::env::var("LIFEBOOK_DESKTOP_CONFIG_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed).join("desktop-config.json"));
        }
    }
    None
}

fn resolve_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = resolve_override_config_path() {
        return Ok(path);
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {e}"))?;
    Ok(dir.join("desktop-config.json"))
}

fn read_config_from_path(path: &PathBuf) -> DesktopConfig {
    if !path.is_file() {
        return DesktopConfig::default();
    }
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<DesktopConfig>(&raw).unwrap_or_default(),
        Err(_) => DesktopConfig::default(),
    }
}

fn write_config_to_path(path: &PathBuf, cfg: &DesktopConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let content =
        serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败: {e}"))?;
    fs::write(path, content).map_err(|e| format!("写入配置文件失败: {e}"))
}

fn read_config_from_disk(app: &AppHandle) -> DesktopConfig {
    let Ok(path) = resolve_config_path(app) else {
        return DesktopConfig::default();
    };
    read_config_from_path(&path)
}

fn write_config_to_disk(app: &AppHandle, cfg: &DesktopConfig) -> Result<(), String> {
    let path = resolve_config_path(app)?;
    write_config_to_path(&path, cfg)
}

fn persist_window_geometry(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let mut cfg = read_config_from_disk(app);
    let maximized = win.is_maximized().unwrap_or(false);
    cfg.window.maximized = maximized;

    if !maximized {
        let scale = win.scale_factor().unwrap_or(1.0);
        if let Ok(phys_size) = win.inner_size() {
            let logical = phys_size.to_logical::<f64>(scale);
            if logical.width >= 600.0 && logical.height >= 400.0 {
                cfg.window.width = logical.width.round();
                cfg.window.height = logical.height.round();
            }
        }
        if let Ok(phys_pos) = win.outer_position() {
            let logical_pos = phys_pos.to_logical::<i32>(scale);
            if (-3200..=7680).contains(&logical_pos.x) && (-2160..=4320).contains(&logical_pos.y) {
                cfg.window.x = Some(logical_pos.x);
                cfg.window.y = Some(logical_pos.y);
            }
        }
    }

    let _ = write_config_to_disk(app, &cfg);
}

fn validate_http_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("服务地址不能为空".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "服务地址格式无效，请以 http:// 或 https:// 开头".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("仅支持 http:// 或 https:// 协议".to_string());
    }
    Ok(parsed)
}

#[tauri::command]
fn get_desktop_config(app: AppHandle) -> DesktopConfig {
    read_config_from_disk(&app)
}

#[tauri::command]
fn save_desktop_config(app: AppHandle, mut cfg: DesktopConfig) -> Result<DesktopConfig, String> {
    let existing = read_config_from_disk(&app);
    if cfg.window.width < 600.0 || cfg.window.height < 400.0 {
        cfg.window = existing.window;
    }
    write_config_to_disk(&app, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
async fn probe_server(url: String) -> Result<ProbeResult, String> {
    let parsed = match validate_http_url(&url) {
        Ok(u) => u,
        Err(msg) => {
            return Ok(ProbeResult {
                ok: false,
                normalized_url: url.trim().to_string(),
                latency_ms: 0,
                message: msg,
            });
        }
    };

    let normalized = parsed.as_str().trim_end_matches('/').to_string();
    let health_url = format!("{normalized}/api/health");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("初始化网络客户端失败: {e}"))?;

    let started = Instant::now();
    let resp = match client.get(&health_url).send().await {
        Ok(r) => r,
        Err(err) => {
            let reason = if err.is_timeout() {
                "连接超时（超过 3 秒），请核对端口与网络连通性".to_string()
            } else {
                format!("无法连接到服务器：{err}")
            };
            return Ok(ProbeResult {
                ok: false,
                normalized_url: normalized,
                latency_ms: started.elapsed().as_millis() as u64,
                message: reason,
            });
        }
    };

    let latency_ms = started.elapsed().as_millis() as u64;
    if !resp.status().is_success() {
        return Ok(ProbeResult {
            ok: false,
            normalized_url: normalized,
            latency_ms,
            message: format!("目标地址返回异常状态（HTTP {}）", resp.status().as_u16()),
        });
    }

    let body_text = resp.text().await.unwrap_or_default();
    match serde_json::from_str::<serde_json::Value>(&body_text) {
        Ok(json) if json.get("ok").and_then(|v| v.as_bool()) == Some(true) => Ok(ProbeResult {
            ok: true,
            normalized_url: normalized,
            latency_ms,
            message: format!("连接成功（{latency_ms} ms）"),
        }),
        _ => Ok(ProbeResult {
            ok: false,
            normalized_url: normalized,
            latency_ms,
            message: "目标地址返回的不是人生簿服务接口，请检查端口号是否正确".to_string(),
        }),
    }
}

#[tauri::command]
fn navigate_to_server(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = validate_http_url(&url)?;
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不可用".to_string())?;
    win.navigate(parsed)
        .map_err(|e| format!("页面跳转失败: {e}"))
}

fn return_to_guide_impl(app: &AppHandle, guide_state: State<'_, GuideUrlState>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if let Ok(guard) = guide_state.0.lock() {
        if let Some(base) = guard.as_ref() {
            let mut target = base.clone();
            target.set_query(Some("mode=switch"));
            let _ = win.navigate(target);
        }
    }
}

#[tauri::command]
fn return_to_guide(app: AppHandle, guide_state: State<'_, GuideUrlState>) {
    return_to_guide_impl(&app, guide_state);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(GuideUrlState(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // 1. 记录初始引导页真实 URL（兼容 Windows http://tauri.localhost 与其它平台）
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(initial_url) = win.url() {
                    if let Ok(mut guard) = app.state::<GuideUrlState>().0.lock() {
                        *guard = Some(initial_url);
                    }
                }

                // 2. 恢复上次保存的窗口尺寸与坐标
                let cfg = read_config_from_disk(&handle);
                let w = cfg.window.width.clamp(960.0, 3840.0);
                let h = cfg.window.height.clamp(640.0, 2160.0);
                let _ = win.set_size(LogicalSize::new(w, h));
                if let (Some(x), Some(y)) = (cfg.window.x, cfg.window.y) {
                    if (-3200..=7680).contains(&x) && (-2160..=4320).contains(&y) {
                        let _ = win.set_position(LogicalPosition::new(x, y));
                    }
                }
                if cfg.window.maximized {
                    let _ = win.maximize();
                }
            }

            // 3. 极简原生菜单：「人生簿」
            let switch_item = MenuItemBuilder::with_id("switch_server", "切换服务器地址…")
                .build(app)?;
            let reload_item = MenuItemBuilder::with_id("reload_page", "刷新当前页面")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit_app", "退出人生簿")
                .build(app)?;

            let submenu = SubmenuBuilder::new(app, "人生簿")
                .item(&switch_item)
                .item(&reload_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let menu = MenuBuilder::new(app).item(&submenu).build()?;
            app.set_menu(menu)?;

            app.on_menu_event(|app_handle, event| match event.id().as_ref() {
                "switch_server" => {
                    let state = app_handle.state::<GuideUrlState>();
                    return_to_guide_impl(app_handle, state);
                }
                "reload_page" => {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.eval("window.location.reload()");
                    }
                }
                "quit_app" => {
                    persist_window_geometry(app_handle);
                    app_handle.exit(0);
                }
                _ => {}
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app_handle = window.app_handle();
                persist_window_geometry(app_handle);
                app_handle.exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_config,
            save_desktop_config,
            probe_server,
            navigate_to_server,
            return_to_guide
        ])
        .run(tauri::generate_context!())
        .expect("启动人生簿桌面端失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn spawn_mock_http(
        status_line: &'static str,
        body: &'static str,
        delay: Duration,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test port");
        let addr = listener.local_addr().expect("local addr");
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                if !delay.is_zero() {
                    thread::sleep(delay);
                }
                let resp = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    #[test]
    fn validates_http_and_https_urls_only() {
        assert_eq!(
            validate_http_url(" http://127.0.0.1:3220/ ")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:3220/"
        );
        assert_eq!(
            validate_http_url("https://diary.example.com/")
                .unwrap()
                .as_str(),
            "https://diary.example.com/"
        );
        assert!(validate_http_url("").is_err());
        assert!(validate_http_url("file:///C:/test.html").is_err());
        assert!(validate_http_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn persists_and_recovers_desktop_config_in_isolated_dir() {
        let tmp_dir = std::env::temp_dir().join(format!(
            "lifebook_desktop_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp_dir);
        fs::create_dir_all(&tmp_dir).expect("create temp dir");

        std::env::set_var("LIFEBOOK_DESKTOP_CONFIG_DIR", &tmp_dir);
        let resolved = resolve_override_config_path().expect("override path");
        assert_eq!(resolved, tmp_dir.join("desktop-config.json"));

        let default_cfg = read_config_from_path(&resolved);
        assert_eq!(default_cfg.window.width, 1280.0);
        assert_eq!(default_cfg.window.height, 860.0);
        assert!(default_cfg.servers.is_empty());

        let cfg = DesktopConfig {
            active_url: "http://127.0.0.1:3220".to_string(),
            servers: vec![
                ServerEntry {
                    name: "家庭服务器".to_string(),
                    url: "http://127.0.0.1:3220".to_string(),
                },
                ServerEntry {
                    name: "备用地址".to_string(),
                    url: "https://nas.example.com".to_string(),
                },
            ],
            window: WindowConfig {
                width: 1440.0,
                height: 920.0,
                x: Some(120),
                y: Some(80),
                maximized: false,
            },
        };
        write_config_to_path(&resolved, &cfg).expect("write config");
        let loaded = read_config_from_path(&resolved);
        assert_eq!(loaded.active_url, "http://127.0.0.1:3220");
        assert_eq!(loaded.servers.len(), 2);
        assert_eq!(loaded.window.width, 1440.0);
        assert_eq!(loaded.window.x, Some(120));

        // 损坏 JSON 时安全降级到默认配置
        fs::write(&resolved, "{not-valid-json").expect("corrupt file");
        let recovered = read_config_from_path(&resolved);
        assert_eq!(recovered.window.width, 1280.0);

        std::env::remove_var("LIFEBOOK_DESKTOP_CONFIG_DIR");
        let _ = fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn probes_lifebook_health_and_handles_timeout_or_invalid_service() {
        tauri::async_runtime::block_on(async {
            let ok_url = spawn_mock_http("200 OK", r#"{"ok":true}"#, Duration::ZERO);
            let ok_res = probe_server(format!("{ok_url}/")).await.expect("probe ok");
            assert!(ok_res.ok);
            assert_eq!(ok_res.normalized_url, ok_url);

            let other_url = spawn_mock_http("200 OK", r#"{"service":"other"}"#, Duration::ZERO);
            let other_res = probe_server(other_url).await.expect("probe other");
            assert!(!other_res.ok);
            assert!(other_res.message.contains("不是人生簿服务"));

            let err_url = spawn_mock_http("500 Internal Server Error", "fail", Duration::ZERO);
            let err_res = probe_server(err_url).await.expect("probe 500");
            assert!(!err_res.ok);
            assert!(err_res.message.contains("500"));

            let slow_url = spawn_mock_http("200 OK", r#"{"ok":true}"#, Duration::from_millis(3800));
            let slow_res = probe_server(slow_url).await.expect("probe timeout");
            assert!(!slow_res.ok);
            assert!(slow_res.message.contains("超时"));
        });
    }
}
