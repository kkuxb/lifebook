# 人生簿（lifebook）v0.2.0-R1 验证与验收报告

结论：**可收口（技术可测项全部通过，含沙盒环境客观未测项待用户真机桌面验收）**；用户业务确认：**技术验证完成，业务验收待确认（建议由用户在常规 Windows 桌面双击实测 `lifebook-desktop.exe` GUI 窗口流程后最终签收）**。

> **给 PM 的业务语言摘要**：`v0.2.0-R1` 独立发布包（`82` 个文件）通过清单校验与静态安全扫描（0 问题），在干净解压目录一次跑通 `corepack pnpm install`（18.2s）→ `typecheck` → `test`（15/15）→ `build`，独立桌面成品目录中的 `人生簿_0.2.0_x64-setup.exe`（`2.74 MB`）与 `lifebook-desktop.exe`（`11.32 MB`）均小于 `25 MB` 上限且版本元数据统一为 `0.2.0`。隔离盲测中：**`V8`（时间簿四层结构解析、上海时区归并、算术 100% 一致、60 秒缓存命中与离线降级）、`V9`（动态第 5 只读工具注入、全层级关键词命中、跨库结合日记问答、离线降级与 4 轮硬限）与 `V11`（7 份清单版本对齐 `0.2.0`、极简无托盘/快捷键/自启、纯中文 3 项菜单、隔离 `cargo test` 3/3 通过与包纯净度）全部通过**。**`V10` 桌面端实测需如实说明边界**：当前命令沙盒运行于无真实桌面窗口句柄的隔离会话，启动 `lifebook-desktop.exe` 时 WebView2 初始化稳定返回系统错误 `HRESULT(0x80070578)`（「无效的窗口句柄。」）以退出码 `101` 中止，故**桌面真机 GUI 窗口交互（首次连入跳转、缩放记忆、菜单切服、断线重启不白屏、点关闭退出）在当前沙盒中客观未测**；作为替代与补全证据，隔离目录 `cargo test`（3/3，含 `LIFEBOOK_DESKTOP_CONFIG_DIR` 与 `/api/health` 3 秒探测）及无头 Chrome 渲染 `apps/desktop/ui/index.html`（1280×860/960×640 亮暗色与模拟切服/断线态 5 张截图）已全部验证通过。全仓无“必须修复”级代码缺陷。

源码、安装副本、包版本与一致性：被测包 `workspace-data/outputs/lifebook/v0.2.0-R1/lifebook.zip`（ZIP SHA-256：`4204a977f985dc6536ec0df392fdeb8d95a3424fb1c8080563bf5e6b6304e56e`，82 个交付文件 + `_release-manifest.json` 共 83 个条目）；独立桌面产物 `workspace-data/outputs/lifebook/v0.2.0-R1/desktop/人生簿_0.2.0_x64-setup.exe`（`2,876,666` 字节 / `2.74 MB`）与 `lifebook-desktop.exe`（`11,868,672` 字节 / `11.32 MB`）；解压并验证于 `workspace-data/tmp/qa/v0.2.0-R1/pkg/lifebook`，未修改项目源码与被测包。
环境与测试范围：Windows 11 / Node v24.15.0 / pnpm 11.7.0 / Rust 1.100.0 (`cargo 1.100.0`) / 无头 Chrome（CDP 协议）；已完成静态安全扫描、全仓编译单测回归、`V8`、`V9`、`V11` 完整端到端隔离盲测，以及 `V10` 桌面 PE 核查、Rust 单测与引导页无头渲染；**未测项**：`V10` 在正常交互式 Windows 桌面（`WinSta0\Default`）下的 WebView2 实机窗口/菜单交互与 NSIS 安装器安装流程、Docker 容器实机运行、真实绿联 NAS / 真实时间簿 / 公网大模型联调。

---

## 实际结果

任务及授权：在 `workspace-data/tmp/qa/v0.2.0-R1/` 解压、安装、构建，并在独立端口 `15308`～`15340`、隔离 `DATA_DIR`、隔离 `LIFEBOOK_DESKTOP_CONFIG_DIR` 与隔离 `CARGO_TARGET_DIR` 下执行 `V8`～`V11` 盲测；严禁修改源码或触碰真实 NAS、真实时间簿 `3210` 及真实系统用户配置目录。
目标/确认完成/未处理：`V8`、`V9`、`V11` 全部满足合格判据；`V10` 实机桌面启动因沙盒桌面句柄限制（`HRESULT(0x80070578)`）未能打开 GUI 窗口，已完成 PE 元数据、隔离 `cargo test`（3/3）及 `ui/index.html` 无头 Chrome 渲染替代核验。
证据位置：
- 计量汇总：`workspace-data/qa/v0.2.0-R1/metrics.json`
- 各场景实测结果、原始日志与截图：`workspace-data/tmp/qa/v0.2.0-R1/cases/V8-run1/`、`V9-run1/`、`V10-run1/`、`V11-run1/`

### 新增场景（`V8` ～ `V11`）实测核验结果

| 场景 | 隔离端口 / 目录 | 核心实测结果与客观边界 | 判定 |
| --- | --- | --- | --- |
| `V8` 时间簿四层结构兼容与统计复盘回归 | `15308` / Mock AI `15318` / Mock TB `15328` / CDP `15338` | `sessions` 仅带 `tag_id`（无 `module_id`）精确归并至 `modules`（工作学习 `#4F7BFF` / 娱乐休息 `#8B5CF6`）；排除 `deleted_at` 软删与按 `Asia/Shanghai` 跨 UTC 日归并（`2026-09-30T17:00Z` 计入 `2026-10`、`2026-10-31T18:00Z` 排除出 `2026-10`）；`2026-10`（10h、60% 待办、工作 8h/+3h、娱乐 2h/-1h）与 `2026-09`（8h、100% 待办、工作 5h/+3h、娱乐 3h/+3h）100% 匹配算术基准；4.37s 内连续 3 次请求 `/api/sync` 仅调用 1 次（命中 60s 缓存）；停服并待缓存过期（64.7s）后重算平滑降级为纯日记复盘不报错 | **通过** |
| `V9` 首页「问问过去的自己」时间簿查询与跨库结合 | `15309` / Mock AI `15319` / Mock TB `15329` / CDP `15339` | 关开关时传给模型严格仅 4 个日记只读工具；开开关后动态追加 `query_timebook_stats`（共 5 个）；全层级命中「原神」tag 及 `session.title` 含「原神」「海岛」共 4 次计时（6 小时，待办 1/2 = 50%），排除跨月与无关模块；第 1 轮查出 `topDays[0]=2026-10-18`（3.5h），第 2 轮 `read_entry_full` 读当日心情 `😄 开心`，第 3 轮跨库作答，可折叠轨迹与出处胶囊跳转原文正常；停掉时间簿待缓存过期后 `query_timebook_stats` 返回 `{available:false, reason:"fetch failed"}` 降级并用日记检索作答；无限 `tool_call` 严格截断于 4 轮并展示安全截断提示 | **通过** |
| `V10` 轻量极简桌面客户端实机链路 | `15310` / CDP `15340` / 隔离 `LIFEBOOK_DESKTOP_CONFIG_DIR` | ① **产物核查通过**：`人生簿_0.2.0_x64-setup.exe`（2.74 MB）与 `lifebook-desktop.exe`（11.32 MB）PE 版本均为 `0.2.0`，`< 25 MB`；<br>② **实机窗口受阻（如实记录）**：设隔离 `LIFEBOOK_DESKTOP_CONFIG_DIR` 与 `WEBVIEW2_USER_DATA_FOLDER` 启动 `lifebook-desktop.exe`，两次运行均在创建 WebView2 控件阶段触发 `WindowsError(HRESULT(0x80070578), "无效的窗口句柄。")` 退出码 `101`（详见 `V10-run1/logs/desktop-bt.stderr.log`），未能进入界面写入 `desktop-config.json`；<br>③ **替代核验通过**：隔离 `CARGO_TARGET_DIR` 执行 `cargo test` 3/3 通过；无头 Chrome 渲染 `apps/desktop/ui/index.html` 在 1280×860/960×640、亮/暗色与模拟切服/断线态均中文清晰无溢出；真实 `AppData` 未被污染、无进程残留 | **环境受阻（实机 GUI 待用户桌面复核）** |
| `V11` 全仓回归、版本统一与发布包纯净度终验 | `cases/V11-run1`（隔离 `CARGO_TARGET_DIR`） | 全仓 7 份清单（根 `package.json`、`core`、`api`、`web`、`desktop`、`Cargo.toml`、`tauri.conf.json`）及两个 PE 产物版本全部统一为 `0.2.0`；`Cargo.toml` 无 `tray`/快捷键/自启特性，`capabilities/default.json` 仅 `core:default`，`CloseRequested` 直接保存几何并 `exit(0)`，菜单仅「人生簿」下 3 项中文简体；隔离 `cargo test --locked` 3/3 通过（3.04s）且未改动 82 个受控文件哈希；`lifebook.zip` 无 `target/`、`gen/`、`node_modules/`、`dist/`、无本机路径/真实私网 IP/凭据 | **通过** |

### 七维复盘

| 维度 | 观察及依据 | 判断/影响范围 |
|---|---|---|
| 业务完成度 | 模块 A（时间簿四层结构兼容、上海时区归并、60s 缓存、`query_timebook_stats` 动态注入与跨库联合问答）经 `V8`、`V9` 端到端全通过；模块 B（`apps/desktop` 极简源码、图标、版本对齐与 < 25 MB 双安装包）已完整交付且 Rust 单测及 `ui/index.html` 渲染全通，仅真机 WebView2 窗口受沙盒环境句柄限制未测 | **部分实测通过（真机 GUI 待常规桌面复核）** |
| 质量 | 经 QA 亲眼核对 `V8` 统计页时间簿/降级截图、`V9` 跨库问答轨迹与降级截图、`V10` 引导页亮/暗色与断线兜底截图，UI 排版、色阶与中文文案均还原设计规范；全仓 `typecheck` 零错误、`vitest` 15/15 全过、`cargo test` 3/3 全过 | **通过**（引导页为静态 HTML 无头渲染核验） |
| 权限与副作用 | 静态安全扫描 0 问题；`query_timebook_stats` 仅在时间簿开启且配置有效时动态暴露且为严格只读，未开启时严格维持原 4 工具；桌面测试全量设置 `LIFEBOOK_DESKTOP_CONFIG_DIR` 与 `CARGO_TARGET_DIR`，核实真实 `AppData` 未写入，所有 153xx 端口与子进程已清理 | **通过** |
| 异常处理 | 时间簿停服离线时统计复盘与首页问答均自动平滑降级为纯日记模式不报错；`query_timebook_stats` 与既有工具仍受 4 轮硬限保护；桌面 Rust `probe_server` 经 `cargo test` 实测覆盖 3s 超时/500/非人生簿 HTML 识别与损坏配置 JSON 降级 | **通过** |
| 效率与成本 | 60 秒内存缓存使 4.37s 内 3 次月报切换仅触发 1 次 `/api/sync`；`vitest run` 全套 15 项仅 2.88s；4 组子智能体实测耗时 `373.0s～694.0s`（均未超 `900s` 硬上限） | **通过** |
| 复杂度 | 未引入托盘/快捷键/自启或桌面端内嵌后端数据库；时间簿四层解析与 `queryTimebookForQa` 集中收敛于 `timebook-sync.ts`；桌面安装包 `2.74 MB` / 便携版 `11.32 MB` 极致轻量 | **通过** |
| 迁移与使用体验 | `README.md` 已同步补充桌面端特点、安装与多地址使用说明；但 `README.md` 中引用的若干图片（`docs/screenshots/*.png`）、`LICENSE` 与 `v0.1.0-acceptance.md` 未打入 `lifebook.zip` 独立发布包（不影响部署运行，记录为非阻断提示） | **通过（附 1 条非阻断文档链接提示）** |

> 已测与未测说明：已完成 `v0.2.0-R1` 发布包清单哈希与静态扫描、全仓 `install -> typecheck -> test -> build`、`cargo test` 3/3、`V8`、`V9`、`V11` 全量隔离盲测及 `V10` 成品核查与引导页无头渲染。**未测项**：正常交互式 Windows 桌面下运行 `人生簿_0.2.0_x64-setup.exe` 安装与 `lifebook-desktop.exe` WebView2 实机窗口/菜单交互、Docker 容器实机运行、真实绿联 NAS / 真实时间簿 / 公网模型联调。

---

## 计量与修复

起止事件：包校验与全仓回归 `2026-11-21T17:04:39+08:00`～`17:05:45+08:00`；`V8`～`V11` 四路并行隔离盲测 `2026-11-21T17:06:10+08:00`～`17:18:01+08:00`。
业务时长与测试子智能体原生计量（数据源：`transcript.jsonl` + `fde-qa/scripts/metrics.py`）：

| 场景 | 并发数 (`--parallel`) | 宿主机状态 / 业务终态 | 真实时长 (`duration_seconds`) | 模型调用步数 (`api_calls`) | 原生输入 Token (`input_tokens`) | 原生输出 Token (`output_tokens`) | 缓存读取 Token (`cache_read_tokens`，另列) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `V8` | `4` | `completed` / 业务通过 | `694.0s` | `33` | `283,954` | `33,783` | `2,583,123` |
| `V9` | `4` | `completed` / 业务通过 | `599.0s` | `34` | `165,913` | `36,218` | `2,897,043` |
| `V10` | `4` | `completed` / 沙盒 GUI 受阻（PE/单测/UI 渲染已完） | `373.0s` | `25` | `111,905` | `25,608` | `1,293,988` |
| `V11` | `4` | `completed` / 业务通过 | `571.0s` | `20` | `208,555` | `16,526` | `981,662` |
| **合计** | — | **4/4 完成** | — | **`112`** | **`770,327`** | **`112,135`** | **`7,755,816`** |

- 人工等待：`0s`；费用：`不可用`（无账单遥测）。
- **预算对照说明**：4 组场景全部低于 `900s` 硬上限（`failed_runs = 0`）；`V10`（`373.0s`）低于 `420s` 目标，`V8`（`694.0s`）、`V9`（`599.0s`）与 `V11`（`571.0s`）高于 `420s` 目标（其中 `V8`、`V9` 均包含显式等待 `> 60 秒` 缓存自然过期及代理现场编写模拟服务/CDP 脚本耗时，非被测产品响应瓶颈）。

必修问题及最小修复：本轮无任何“必须修复”级代码缺陷。
定向回归结果：不适用（首轮一次通过）。
用户接受限制：
1. **沙盒环境无法渲染 `V10` 桌面端 WebView2 GUI 窗口**：受限于自动化命令沙盒会话无有效交互窗口句柄（`HRESULT(0x80070578)`），建议由用户在本人常规 Windows 桌面双击 `workspace-data/outputs/lifebook/v0.2.0-R1/desktop/lifebook-desktop.exe`（或安装包）实测一次引导连接、菜单切服、窗口缩放记忆与关闭退出；
2. 桌面安装包与便携程序未购买代码签名证书（Windows 首次运行若弹 SmartScreen 提示属未签名常态）；
3. Docker 容器实机运行与真实绿联 NAS / 真实时间簿 / 公网模型联调待实际部署验收。

非阻断建议：
1. **[V11 / 独立包文档链接]** `README.md` 引用的 `docs/screenshots/*.png`、`LICENSE` 与 `docs/deliveries/lifebook-v0.1.0-acceptance.md` 未被 `scripts/release_app.py` 纳入独立 `lifebook.zip`，如需发布包内独立离线阅读完整 README 附图可按需补充（或在仓库内保留原样）。

---

## 发布

包清单、哈希与实际内容检查：`unpack_verify.py` 验证 `v0.2.0-R1/lifebook.zip`（SHA-256：`4204a977f985dc6536ec0df392fdeb8d95a3424fb1c8080563bf5e6b6304e56e`）82 个交付文件哈希一致；静态扫描无 `target/`、`gen/`、`*.tsbuildinfo`、`.env`、`*.sqlite*`、本机路径或真实私网 IP。独立桌面目录 `desktop/` 含 `人生簿_0.2.0_x64-setup.exe`（`2.74 MB`）与 `lifebook-desktop.exe`（`11.32 MB`）。
安装/调用入口：服务端通过 `corepack pnpm install && corepack pnpm build` 后运行 `node apps/api/dist/server.js` 或 `docker compose up -d --build`（端口 `3220`）；桌面端运行 `人生簿_0.2.0_x64-setup.exe` 安装或直接启动便携版 `lifebook-desktop.exe`。
升级保留内容与回滚：服务端 `/data` 数据卷与既有接口完全向下兼容；桌面端配置独立保存于用户配置目录 `desktop-config.json`（不修改服务端数据库），随时可卸载或替换回旧版。
维护人及目标环境未测项：交由 PM 与用户在常规 Windows 桌面实测 `V10` GUI 窗口交互后完成终审签收；容器实机及真实 NAS/时间簿联调待部署后验收。
