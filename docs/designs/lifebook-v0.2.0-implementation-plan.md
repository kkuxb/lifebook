# 人生簿（`lifebook`）`v0.2.0` 可执行实施计划

- **依据设计**：[v0.2.0 工程设计方案](lifebook-v0.2.0-design.md)（已于 `2026-11-21` 冻结）
- **测试参考**：[v0.2.0 独立测试计划](lifebook-v0.2.0-test-plan.md)
- **视觉基准**：[视觉与动效设计规范](../设计规范.md)

---

## 一、拟修改/新增的文件范围

```text
lifebook/
  package.json                                 # 版本号同步升级为 0.2.0
  .gitignore                                   # 忽略 apps/desktop/src-tauri/target/ 与 gen/
  README.md                                    # 更新版本链接至 v0.2.0，补充极简桌面端下载、安装与多地址使用说明
  scripts/
    release_app.py                             # 纳入 apps/desktop 源码(排除 target/) 与 v0.2.0 文档、扩展安全扫描后缀
  packages/
    core/package.json                          # 版本号 0.2.0（按需在 src/index.ts 补充问答/时间簿类型）
  apps/
    api/
      package.json                             # 版本号 0.2.0
      src/services/
        timebook-sync.ts                       # 兼容四层时间簿真实结构、Unix ms 时间戳、60s 缓存与 queryTimebookForQa
        ai-qa.ts                               # 按开关动态注入 query_timebook_stats 工具与跨库协同引导提示
      test/api.test.ts                         # 覆盖 V8、V9 与动态工具边界用例
    web/
      package.json                             # 版本号 0.2.0
    desktop/                                   # 新增轻量极简桌面客户端（Tauri v2）
      package.json                             # 版本号 0.2.0，提供 dev / build 命令
      ui/index.html                            # 护眼暖白纸面风格的连接引导、测通与多服务器切换单页
      src-tauri/
        Cargo.toml / build.rs / tauri.conf.json
        capabilities/default.json
        icons/                                 # 由暖金色书本 Logo 转换的标准 .ico 与多尺寸 .png 图标
        src/
          main.rs
          lib.rs                               # 配置持久化、窗口尺寸记忆、服务探测与跳转、极简菜单、关闭即退
  docs/
    README.md                                  # 记录 v0.2.0 发布状态与有效索引
```

---

## 二、分里程碑实施步骤

### 里程碑 1：时间簿真实四层结构全兼容与首页问答只读联动（模块 A）
1. 改造 `apps/api/src/services/timebook-sync.ts`：
   - 完整实现时间戳（Unix 毫秒 / 秒 / ISO 字符串）按上海时区转换为 `YYYY-MM-DD` / `YYYY-MM` 的标准化工具；
   - 构造 `modules` + `tags` + `sessions` + `todos` + `todoChecks`/`todo_checks` 四层关联索引，确保通过 `tag_id -> tags.module_id` 精确归并模块大类与细分标签名，同时保留与既有模拟结构字段（`moduleId`/`startedAt`/`durationSeconds` 等）双向兼容；
   - 实现 `60` 秒只读内存缓存及 `clearTimebookCache()`；
   - 升级 `fetchTimebookSummary` 使用新标准化数据；
   - 新增并导出 `queryTimebookForQa(db, masterKey, { startDate, endDate, keyword, groupBy })`：支持模块名/细分标签名/单次计时标题备注/待办名称多关键词模糊匹配，计算总时长、次数、单次最长、`byModule`、`byTag`、`topDays`、`timeline`、`todoSummary`；未开启或离线安全返回 `{ available: false, reason }`。
2. 改造 `apps/api/src/services/ai-qa.ts`：
   - 定义只读工具 `TIMEBOOK_QA_TOOL`（`query_timebook_stats`）；
   - 在 `runMemoryQa` 中判断时间簿开关与凭据是否有效：仅开启时将该工具加入本次模型请求的 `tools` 清单，并在动态 `systemPrompt` 指导模型结合时间簿 `topDays` 高耗时日期再去查询对应日记心情与正文；未开启时间簿时保持原 4 个工具不变。
   - 仍严格遵守 `QA_MAX_TOOL_ROUNDS = 4` 上限；`traces` 正常记录调用摘要。
3. 在 `apps/api/test/api.test.ts` 补齐测试：
   - 构造贴近真实时间簿字段（`tags[]`, `sessions[].tag_id`, `start_at`/`end_at` 整数毫秒时间戳, `title: "玩原神"`, `todos[]`, `todo_checks[]`）的模拟服务端响应；
   - 验证统计页月/年复盘精确汇总小时数；
   - 验证开启联动后首页问答调起 `query_timebook_stats` 与 `read_entry_full` / `list_entry_digests` 的全层级查询与跨库协同，以及关闭联动时工具清单严格为 4 项、时间簿离线时问答不报错降级。

### 里程碑 2：轻量极简桌面客户端 `apps/desktop`（模块 B）
1. 核实与配置 Rust + Tauri v2 依赖与最小权限清单：
   - 注意提前核实 Windows 本机链接器（VS Build Tools / Windows SDK）在独立环境变量下可正常找到 `link.exe`（若默认 PATH 无 `cl`/`link`，在 Cargo/VS 环境检查说明并记录构建环境要点）；
   - `Cargo.toml` 使用 `tauri = "2"`、`serde`、`serde_json`、`url`、`reqwest`（`blocking` 或 async + `rustls-tls`，避免系统 OpenSSL 依赖问题）或轻量 HTTP 客户端，保证不引入无用大型依赖，注意版本号统一为 `0.2.0`。
   - **严守边界**：不引入托盘插件、不注册全局快捷键、不做开机自启。
2. 准备应用图标资产：
   - 将 `apps/web/index.html` 内暖金色书本 SVG 转换为高清 PNG 并生成标准 Windows `icons/icon.ico` 及 `32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png`。
3. 实现 `apps/desktop/src-tauri/src/lib.rs`：
   - 配置路径解析支持 `LIFEBOOK_DESKTOP_CONFIG_DIR` 环境变量覆盖，读写 `desktop-config.json`（含 `activeUrl`、`servers` 列表、`window` 宽高/坐标/最大化状态）；
   - 主窗口初始化恢复 `window` 尺寸与位置；关闭请求时保存最新位置尺寸后直接 `app.exit(0)`；
   - 注册 Commands：`get_desktop_config`、`save_desktop_config`、`probe_server`（仅允许 `http://`/`https://`，`3` 秒超时校验 `/api/health` 返回 JSON 含 `ok: true`）、`navigate_to_server`、`return_to_guide`；
   - 配置极简中文顶部菜单「人生簿」（切换服务器地址… / 刷新当前页面 / 退出人生簿）。
4. 实现 `apps/desktop/ui/index.html`：
   - 暖白纸面风格的极简连接引导页与常用服务器卡片列表；
   - 启动若有 `activeUrl` 且非 `?mode=switch` 先静默探测，连通无感跳入，离线友好展示失败信息、重试与切换地址选项。
5. 编译与实机验证：
   - 执行 `corepack pnpm --filter @lifebook/desktop build`（或 `cargo tauri build`）产出 Windows NSIS 安装程序（`*-setup.exe`）与独立 `lifebook-desktop.exe`；
   - 使用独立 `LIFEBOOK_DESKTOP_CONFIG_DIR` 启动实机进程，连接本地测试端口 `153xx`，验证启动渲染、测通跳转、调整窗口大小重启记忆、菜单跳回引导页切换地址、服务器下线降级兜底与关闭进程零残留。

### 里程碑 3：版本同步、打包规范与文档完善
1. 同步 5 个清单文件版本号为 `0.2.0`：`package.json`、`packages/core/package.json`、`apps/api/package.json`、`apps/web/package.json`、`apps/desktop/package.json`（及 `Cargo.toml` / `tauri.conf.json`）。
2. 更新根目录 `.gitignore` 屏蔽 `target/` 与生成目录；更新 `scripts/release_app.py` 纳入 `apps/desktop` 纯净源码与 `v0.2.0` 文档、排除 `target/`、补充 `.rs/.toml/.svg` 安全扫描；更新 `README.md` 补充桌面端特性、下载安装指南与多地址切换说明（仍全中文简体，无敏感路径或私网真实 IP）。
3. 运行全仓检验：
   - `corepack pnpm typecheck`
   - `corepack pnpm test`
   - `corepack pnpm build`
   - `python scripts/release_app.py build --output workspace-data/outputs/lifebook/v0.2.0-R1/lifebook.zip`
4. 将构建完成的 Windows NSIS 安装包与绿色可执行文件归档至 `workspace-data/outputs/lifebook/v0.2.0-R1/desktop/`，并通过 Swarm 共享面板向 `@qa [review_requested]` 提交结构化交接清单。

---

## 三、计划五项自查结论

1. **需求覆盖**：完整覆盖 `C-23`～`C-24` 全部三项核心要求（四层时间簿对齐 + 首页全层级跨库问答 + 极简联机桌面端 + 同步升级打包发布）。
2. **接口一致性**：时间簿四层结构基于对绿联实际数据库的只读 SQLite 结构核验编写，前后端与桌面端配置数据结构均写明约束，无字段猜测。
3. **无未验证假设**：已实测本机 `rustc 1.100.0`、`cargo 1.100.0`、`VS 2022`、`WebView2 158.0` 与 `tauri` 缓存均存在，具备打包完整 Windows 安装包条件（若编译期遇链接器环境变量或 NSIS 工具链缺口，由 `dev` 按规则即时上报 `@coordinator [blocked]` 而不强行绕过）。
4. **可独立验证**：服务端通过本地模拟时间簿与模型 HTTP 验证 `V8`/`V9`；桌面端通过 `LIFEBOOK_DESKTOP_CONFIG_DIR` 隔离配置目录与本地空闲高端口完成真实启动、截图和关闭进程退出核验，零触碰生产环境。
5. **打包与运行边界清晰**：`release_app.py` 排除 `apps/desktop/src-tauri/target/` 保持源码发布包轻量干净；实际 Windows 安装程序产物独立放入 `desktop/` 目录供 `qa` 验证并在最终发布时随 Release 上传。
