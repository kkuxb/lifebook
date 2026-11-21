# 人生簿（`lifebook`）`v0.2.0` 工程设计方案

- **日期与版本**：`2026-11-21` / `v0.2.0`（轻量桌面端与时间簿问答增强版）
- **状态与确认依据**：**已冻结**（由用户在 `2026-11-21` 正式确认方案边界、极简窗口交互、`V8`～`V11` 验收标准、预算及发版附带桌面安装包）
- **有效需求基准**：
  - [需求澄清与讨论纪要](../requirements/lifebook-讨论纪要.md)（`C-23`～`C-24`，沿用 `C-01`～`C-22` 既有业务口径）
  - [视觉与动效设计规范](../设计规范.md)

---

## 1. 业务合同与范围边界

- **目标能力**：
  1. **修复时间簿真实四层结构解析并接入首页「问问过去的自己」**：使统计页月/年复盘及首页回忆问答均能准确读取时间簿真实四层模型（`modules` 模块大类 → `tags` 细分标签 → `sessions` 单次计时记录与备注 → `todos`/`todo_checks` 待办完成情况），支持在首页直接按自然语言追问时间簿耗时，并与同期日记心情交叉结合回答；
  2. **构建发布超轻量极简桌面客户端（`apps/desktop`）**：基于 `Tauri v2` 复用系统 `WebView2`，实现连接引导、多服务器保存与切换、独立窗口尺寸记忆、断线友好兜底页、关闭直接退出，并产出标准 Windows 安装程序与绿色可执行程序。
- **明确非目标**：
  - **严禁改动兄弟项目「时间簿（`timebook`）」的任何源码、数据库或容器配置**（全程通过 `/api/login` 与 `/api/sync?since=0` 只读访问）；
  - 桌面端不内嵌本地独立 SQLite 服务库，不做多端离线全量数据库双向合并同步（沿用网页既有的断网编辑暂存与重连同步防丢机制）；
  - 桌面端采用极简窗口模式：**不驻留系统托盘、不注册全局快捷键、不做开机自启**；
  - 保持已有 Docker 容器部署链路不变（`Dockerfile` 与容器大小不受桌面端代码影响）。

---

## 2. 模块 A：时间簿真实四层结构全兼容与首页问答工具

### 2.1 对真实时间簿接口的实证核查事实（绿联生产库只读核验）

实际时间簿 SQLite 结构经只读核验包含：
- `modules`: `id`, `name`, `color_key`, `sort`, `created_at`, `updated_at`, `deleted_at`
- `tags`: `id`, `module_id`, `name`, `sort`, `created_at`, `updated_at`, `deleted_at`
- `sessions`: `id`, `tag_id`, `todo_id`, `title`, `start_at`（整数毫秒时间戳）, `end_at`, `source`, `created_at`, `updated_at`, `deleted_at`
- `todos`: `id`, `title`, `tag_id`, `plan_date`, `due_date`, `recur`, `done_at`, `created_at`, `updated_at`, `deleted_at`
- `todo_checks`（或驼峰 `todoChecks`）: `todo_id`, `date`（`YYYY-MM-DD`）, `done_at`, `updated_at`, `deleted_at`

此前 `v0.1.x` 中 `apps/api/src/services/timebook-sync.ts` 存在的历史缺陷：
1. 未索引 `tags` 表，导致仅带 `tag_id` 而无 `module_id` 的 `sessions` 全部落入 `"unknown"` 模块；
2. 仅按字符串 `.slice()` 解析时间与只认 `durationSeconds`/`durationMs`，遇到 Unix 毫秒整数（`start_at`/`end_at`）或 `done_at` 时段匹配失效、无法按 `Asia/Shanghai` 换算自然日。

### 2.2 `apps/api/src/services/timebook-sync.ts` 改造设计

1. **统一时间戳与四层关联标准化**：
   - 新增内部辅助函数：
     - `toEpochMs(v: unknown): number | null`：兼容 ISO 字符串、Unix 毫秒数（`>= 1e11`）、Unix 秒数（`< 1e11`）；
     - `epochMsToShanghaiDate(ms: number): string` 与 `epochMsToShanghaiMonth(ms: number): string`（统一按 `Asia/Shanghai` 时区格式为 `YYYY-MM-DD` / `YYYY-MM`）；
     - `getModuleColorByKey(colorKey?: string, rawColor?: string, idx?: number): string`：兼容真实时间簿的 `color_key`/`colorKey` 与直传 `color`。
   - 构造映射表：
     - `moduleMap`: active `modules` by `id`；
     - `tagMap`: active `tags` by `id`（含 `name`, `moduleId: t.moduleId || t.module_id || ""`）；
     - 每条 active `session` 归属：`tag = tagMap.get(s.tagId || s.tag_id)`；`modId = s.moduleId || s.module_id || tag?.moduleId || "unknown"`；`tagName = tag?.name || "未分类"`；`startMs` / `endMs` / `durationSec`（优先 `endMs - startMs`，兜底 `durationSeconds` 或 `durationMs / 1000`）；`shanghaiDate`（`YYYY-MM-DD`）；`title`（单次计时标题备注）。
     - 每条 active `todo`：`title`, `tagId`, `moduleId = tag?.moduleId || ""`, `dateStr = plan_date || due_date || epochDate(done_at || created_at)`, `isDone = Boolean(t.done_at || t.doneAt || t.completed || t.done)`。
     - `todoChecks`：同时读取 `payload.todoChecks` 与 `payload.todo_checks`，以 `deleted_at`/`deletedAt` 过滤，识别 `done_at`/`doneAt` 或 `checked !== false`。
2. **60 秒只读内存缓存**：
   - 以 `${cfg.url}|${sha256(cfg.password).slice(0, 16)}` 作为缓存键，缓存 `{ fetchedAtMs, normalizedData }` 有效期 **`60_000` ms**；
   - 导出 `clearTimebookCache()` 方便集成测试快速切换离线/在线态，避免测试互相污染。
3. **保留既有 `fetchTimebookSummary` 合同，精度大幅提升**：
   - 继续供月/年深度复盘使用，现已准确支持 `tags -> modules` 链路和整数时间戳按上海时区自然月/自然年精确聚合。
4. **新增 `queryTimebookForQa(db, masterKey, params)` 只读明细与关键词查询函数**：
   - 入参：`{ startDate?: string; endDate?: string; keyword?: string; groupBy?: "none" | "day" | "month" }`
   - 行为：
     - 若未开启或凭据缺失，直接返回 `{ available: false, reason: "时间簿联动未开启" }`；
     - 拉取或命中 60 秒缓存中的标准化集合；若请求失败，平滑返回 `{ available: false, reason: ... }`；
     - 按 `startDate` / `endDate`（`YYYY-MM-DD`）过滤 `sessions` 与待办：
       - 若 `keyword` 非空：按空白符拆分为最多 4 个词元（不区分大小写），要求所有词元均出现在 `moduleName + " " + tagName + " " + sessionTitle`（命中计时）或 `moduleName + " " + tagName + " " + todoTitle`（命中待办）中；
       - 计算核心指标：
         - `totalHours`（保留 1 位小数）、`totalMinutes`、`sessionCount`、`avgSessionMinutes`；
         - `longestSession`（`{ date, hours, minutes, moduleName, tagName, title }`）；
         - `byModule`（按小时降序，前 10 个，`{ name, hours, pct, sessionCount }`）；
         - `byTag`（按小时降序，前 15 个，`{ name, moduleName, hours, minutes, sessionCount }`）；
         - `topDays`（按小时降序前 10 天：`{ date, hours, minutes, sessionCount, sampleTitles }` —— 为大模型接着用 `read_entry_full` / `list_entry_digests` 关联日记提供精确日期抓手）；
         - `timeline`（仅当 `groupBy === "day"` 或 `"month"` 时输出，最多前 40 条）；
         - `todoSummary`（`{ total, done, rate, sampleItems }`，最多带 8 条匹配待办标题与状态）。

### 2.3 `apps/api/src/services/ai-qa.ts` 工具动态注册与提示词升级

1. **工具声明**：新增第 5 个只读工具 `TIMEBOOK_QA_TOOL`（名称 `query_timebook_stats`）：
   - `description`: `"只读查询关联「时间簿」中的真实耗时投入与待办完成情况：支持按起止日期范围、关键词（同时模糊匹配模块大类、细分标签、单次计时标题与待办名称，如“原神”“编码”“健身”）以及按日/月分组汇总，并返回投入最多的日期清单以便继续结合日记分析情绪。"`
   - `parameters`: `startDate`, `endDate`, `keyword`, `groupBy`（`none` / `day` / `month`）。
2. **动态注入边界**：
   - 在 `runMemoryQa` 中检查 `const tbCfg = getTimebookConfigFull(db, masterKey); const tbActive = Boolean(tbCfg.enabled && tbCfg.url && tbCfg.password);`
   - 仅当 `tbActive === true` 时：
     - 将 `TIMEBOOK_QA_TOOL` 追加到传给模型的 `tools`（工具集共 `5` 个只读工具）；
     - 在 `buildQaSystemPrompt(db, tbActive)` 中补充说明：「已开启时间簿只读联动：凡涉及时间投入、花费时长、加班、运动、娱乐、具体某项活动/游戏耗时及待办完成率的问题，调用 `query_timebook_stats`；若用户同时询问期间状态或心情感受，可根据其返回的 `topDays` 高耗时日期再调用 `read_entry_full` 或 `list_entry_digests` 结合日记正文客观作答。」
   - 若 `tbActive === false`：传给模型的 `tools` **严格保持原有 4 个日记工具不变**（确保 `V5/V6` 既有工具列表断言与零干扰降级不变）。
   - 工具调用循环仍严格受 `QA_MAX_TOOL_ROUNDS = 4` 硬限保护；`executeReadonlyTool` 执行 `query_timebook_stats` 后在 `traces` 记录可读摘要（如 `时间簿查询「原神」：命中 12 次计时，共 18.5 小时`）。

---

## 3. 模块 B：轻量极简桌面客户端（`apps/desktop`）

### 3.1 技术选型与目录布局

- 技术栈：`Tauri v2`（Rust 后端 + 系统原生 `WebView2`），零重框架依赖：
  ```text
  apps/desktop/
    package.json                        # 脚本：dev / build / icon 等，版本号 0.2.0
    ui/
      index.html                        # 极简连接引导页与多服务器管理界面（护眼暖白风格）
    src-tauri/
      Cargo.toml                        # tauri = "2", tauri-plugin-window-state = "2", reqwest (rustls-tls, blocking/async) 或 tokio/reqwest, serde, serde_json, url
      tauri.conf.json                   # productName: "人生簿", version: "0.2.0", window defaults, bundle nsis targets
      capabilities/
        default.json                    # core:default 等最小必需权限
      build.rs                          # tauri_build::build()
      icons/                            # 从暖金色书本 Logo 生成的 icon.ico、32x32.png、128x128.png 等
      src/
        main.rs
        lib.rs                          # 配置读写、窗口尺寸记忆、服务健康探测、极简原生菜单、跳转命令
  ```
- **打包体积与性能底线**：依赖本机系统已有 `WebView2` 运行时，不打包 Chromium 内核；NSIS 安装程序目标体积 `<= 25MB`，冷启动后不常驻多余后台进程，点关闭直接退出。

### 3.2 Rust 主进程核心合同（`apps/desktop/src-tauri/src/lib.rs`）

1. **配置路径与数据结构**（支持测试环境安全隔离）：
   - `resolve_config_path(app: &AppHandle) -> PathBuf`：若环境变量 `LIFEBOOK_DESKTOP_CONFIG_DIR` 非空，则存放在 `<该目录>/desktop-config.json`；否则存放在 `app.path().app_config_dir()/desktop-config.json`。
   - `DesktopConfig` JSON 字段：
     ```json
     {
       "activeUrl": "http://...",
       "servers": [
         { "name": "家里绿联 NAS", "url": "http://..." }
       ],
       "window": {
         "width": 1280,
         "height": 860,
         "x": null,
         "y": null,
         "maximized": false
       }
     }
     ```
2. **暴露给本地引导页的 Tauri Commands（`#[tauri::command]`）**：
   - `get_desktop_config() -> DesktopConfig`
   - `save_desktop_config(cfg: DesktopConfig) -> Result<DesktopConfig, String>`
   - `probe_server(url: String) -> Result<ProbeResult, String>`：规范化去除末尾 `/`（校验仅允许 `http://` 或 `https://` 协议），带 `3` 秒超时请求 `${cleanUrl}/api/health`，校验 HTTP `200` 且返回 JSON 中含 `"ok": true`（若为 HTML 误指端口则返回可读中文提示）；返回 `{ ok: true, normalizedUrl, latencyMs, message }` 或 `{ ok: false, message }`。
   - `navigate_to_server(app: AppHandle, url: String) -> Result<(), String>`：先校验 `http://` 或 `https://` 合法 URL，通过主窗口导航至目标地址（`webview_window.navigate(parsed_url)`）。
   - `return_to_guide(app: AppHandle)`：将主窗口安全跳回内置引导页并附 `?mode=switch`（供界面识别当前处于手动切换服务器态而非自动重连）。
3. **极简原生菜单栏（中文简体，无多余杂项）**：
   - 仅设一个顶级菜单「人生簿」含三项：
     - `切换服务器地址…` → 导航回本地引导页 `?mode=switch`；
     - `刷新当前页面` → `window.reload()`；
     - `退出人生簿` → 保存当前窗口状态并调用 `app.exit(0)`。
4. **窗口生命周期、断线与跨页兼容策略（重要！防止连接远程后丢掉「切换服务器」入口及防白屏）**：
   - 启动时读取 `desktop-config.json` 中 `window` 宽高（限制在合理屏幕范围，默认 `1280×860`，最小 `960×640`）并应用到主窗口（或居中）；
   - 监听 `on_window_event`：
     - `CloseRequested` / `Destroyed`：实时保存当前物理/逻辑尺寸与坐标及是否最大化到 `desktop-config.json`，随后直接 `app.exit(0)` **干净退出（绝不隐藏到托盘）**；
   - **当窗口成功打开远端服务器页面后**：
     - 如果未来某次启动远端服务器关机：引导页加载 `index.html`，自动调用 `probe_server(activeUrl)` 探测失败后停留在引导页显示清晰错误说明与「重试连接 / 切换服务器」卡片，**绝不会盲目 `window.location` 导致 WebView2 原生错误白屏**；
     - 进入远端页面后，顶部原生菜单栏「人生簿 → 切换服务器地址…」始终随时可用，让用户一键返回连接引导页切换地址（例如从公司外网切回家里局域网）；
     - 外部超链接或外跳兼容：遵循标准单窗口打开与本地协议白名单（仅允许 `http://` / `https://` 与 Tauri 内置协议）。

### 3.3 本地引导页体验（`apps/desktop/ui/index.html`）

- 视觉完全对齐 [视觉与动效设计规范](../设计规范.md)：护眼暖白背景（`#F6F7FA` / `#FAF7F0` 纸面卡片）、暖金色书本矢量 Logo（`#FFD43B` / `#111827`）、中文简体文案、支持自动适配系统深浅色或清晰按钮质感。
- 启动探测状态：
  - 若存在 `activeUrl` 且 URL 不带 `?mode=switch`：展示简洁居中的「正在连接人生簿服务…」状态卡片（带地址预览与「取消并切换地址」小按钮），立即执行 `probe_server(activeUrl)`：
    - 连通 → 自动 `navigate_to_server(activeUrl)`；
    - 失败 → 切换到友好配置卡片，显示超时/拒连等可读原因，高亮「重试连接」按钮与下方地址列表/表单。
- 地址管理卡片：
  - 展示已保存服务器卡片列表（可点击「连接」或「删除」）；
  - 添加/测试表单：备注名（如 `家里绿联 NAS`）+ 服务地址（如 `http://nas.local:3220`）+「测试并进入」主按钮；输入支持回车直接触发，测通自动写入配置表并设为当前 `activeUrl` 跳转进入。
  - **严格脱敏合规**：引导页示例占位符仅使用 `http://nas.local:3220` 或 `http://127.0.0.1:3220`，源码严禁写死 `192.168.*` 真实局域网段或个人域名。

### 3.4 容器与发布包兼容性约定

- 根目录 `.gitignore` 新增 `apps/desktop/src-tauri/target/` 及 `apps/desktop/src-tauri/gen/`；
- `scripts/release_app.py` 更新：
  - `EXCLUDE_DIRS` 增加 `"target"`, `"gen"`；
  - `INCLUDE_DIRS` 纳入 `"apps/desktop"`（排除 `target/` 编译产物，仅打轻量源码与图标/配置）；
  - `INCLUDE_DOC_FILES` 纳入 `v0.2.0` 设计、实施与测试计划文档；
  - `TEXT_SUFFIXES` 补充 `.rs`, `.toml`, `.svg` 以确保 Rust 源码与配置同样接受敏感信息静态安全扫描。
- 安装包编译导出位置：通过 `tauri build` 生成 Windows NSIS 安装程序（`*-setup.exe`）与独立主程序（`lifebook-desktop.exe`），研发复制重命名为规范命名并归档到 `workspace-data/outputs/lifebook/v0.2.0-R<轮次>/desktop/`，同时随 `lifebook.zip` 一并移交 `qa` 独立真机测通。

---

## 4. 预算与质量门禁

- **测试预算**：新增 `V8`～`V11` 全部在独立临时端口（`15300+`）、临时数据库及 `LIFEBOOK_DESKTOP_CONFIG_DIR` 隔离目录下完成，**严禁触碰绿联生产服务器与用户个人目录**；研发–测试最多 `3` 轮返修上限。
- **质量与体验底线**：全仓 `typecheck`、`vitest run`、`pnpm build`、`cargo check` / `tauri build` 全部通过；桌面安装包真实启动并通过无头或窗口验证截图核验无误，点击关闭后无进程残留；所有对外界面、文档与安装程序名称均为中文简体。
