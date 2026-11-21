# 人生簿（`lifebook`）`v0.1.0` 可执行实施计划

- **依据设计**：[v0.1.0 一期工程设计方案](lifebook-v0.1.0-design.md)（已于 `2026-11-21` 冻结）
- **测试参考**：[v0.1.0 测试计划](lifebook-v0.1.0-test-plan.md)
- **视觉基准**：[视觉与动效设计规范](../设计规范.md) 及第 3 版 [高保真交互原型](../../prototype/index.html)

---

## 一、拟新建/交付的文件结构

```text
lifebook/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  vitest.config.ts
  .env.example
  Dockerfile
  docker-compose.yml
  docs/
    绿联NAS部署与使用指南.md
  scripts/
    release_app.py                  # 构建独立发布包并产出 _release-manifest.json
  packages/
    core/
      package.json / tsconfig.json
      src/
        index.ts                    # 类型契约、字数统计、日期周期锁、旧12→新8心情映射
        highlights.ts               # 双高光时间轴本地规则打分初筛与日期溯源校验
        import-parser.ts            # 标题日期前缀剥离、空白草稿判定、冲突合并规则
        prompts.ts                  # 单篇结构化日概要、深度月/年复盘提示词与长度/结构检验
      test/*.test.ts
  apps/
    api/
      package.json / tsconfig.json
      src/
        server.ts / app.ts          # Hono 服务入口、静态托管与全部路由
        auth.ts / crypto.ts         # 口令认证、IP限流、AES-256-GCM 密钥加解密
        db/
          schema.ts / client.ts     # SQLite建表、WAL、FTS5 触发器与默认字典种子
        services/
          entries.ts                # 日记CRUD、当日5份快照截断与跨自然日清理、回收站
          tags-moods.ts             # 标签/8档心情管理与强制替换安全删除事务
          import-export.ts          # ZIP 压缩包解析导入、同日冲突处理、按批次撤销、热备导出
          ai-client.ts              # OpenAI兼容 / Gemini / Anthropic 原生轻量三协议适配器
          ai-qa.ts                  # 4个只读本地工具封装与硬限4轮回忆问答循环
          timebook-sync.ts          # 时间簿局域网只读登录与月/年耗时聚合器
          reviews.ts                # 结构化日概要缓存、深度月/年复盘生成与手动钉选合并
      test/*.test.ts
    web/
      package.json / tsconfig.json / vite.config.ts / index.html
      src/
        styles/tokens.css           # 严格还原设计规范的双主题色板、冷暖5档热力图与纸面质感
        components/
          RichEditor.tsx            # TipTap 块级编辑器（/ 斜杠菜单、快捷语法、划词格式条、插图）
          SettingsDrawer.tsx        # 模型服务、时间簿联动、标签心情与安全迁移弹窗、模板、导入、备份
          HighlightTimelineCard.tsx # 双高光时间轴组件（来源标签、直达原文、钉选与移出）
        pages/
          LoginPage.tsx / HomePage.tsx / EditorPage.tsx / CalendarPage.tsx / HistoryPage.tsx / StatsPage.tsx
        lib/
          api.ts / offlineQueue.ts  # 接口封装、断网防丢本地队列与恢复同步
```

---

## 二、分里程碑实施步骤

### 里程碑 0：工作区底座与 `better-sqlite3` 探针
1. 初始化 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`vitest.config.ts`，安装依赖（优先使用 `jszip`/`adm-zip` 或轻量纯 JS 解析 `ZIP`，`@tiptap/react`、`@tiptap/starter-kit`、`@tiptap/extension-task-list`、`@tiptap/extension-task-item`、`@tiptap/extension-highlight`、`@tiptap/extension-image`、`@tiptap/extension-placeholder`、`hono`、`@hono/node-server`、`better-sqlite3`、`zod`、`ulid`、`vite-plugin-pwa`）。
2. 在本机 `Node v24` 环境下运行最小只读探针验证 `better-sqlite3` 编译加载与 `FTS5` 虚表创建无报错。
   - 若无法在本机完成原生编译，立即 `@coordinator [blocked]` 上报并给出备选方案（不绕过规则）。

### 里程碑 1：`@lifebook/core` 领域纯函数与单元测试
1. 实现日期（`Asia/Shanghai` 自然日/自然月/自然年边界判定及次月 1 日/次年 1 月 1 日解锁函数）、中文有效字数统计、`HTML → 纯文本` 提取。
2. 实现 `C-11` 旧 12 项→新 8 档核心心情默认映射表、导入标题重复日期前缀剥离（如 `2025-11-20 `、`2025年11月20日 ` 等常见格式）、空白占位草稿识别、以及同日冲突「跳过 / 覆盖 / 合并追加」逻辑。
3. 实现 `C-16` 双高光时间轴本地规则初筛打分（重要事件/节点/旅行/年度复盘加权、字数 ≥ 均值 `1.4` 倍、情绪峰值、日概要关键事件重要度 ≥ 4 分）与真实日期溯源过滤纯函数。
4. 实现 `C-17` 月度四维与年度三线深度盘点提示词模板与结构/深度检验函数。
5. 编写并跑通 `packages/core` 全部 Vitest 单测。

### 里程碑 2：`@lifebook/api` 核心存储、日记与导入备份闭环
1. 建表初始化（`entries`、`entries_fts`、`tags`、`moods`、`entry_tags`、`entry_moods`、`entry_snapshots`、`entry_ai_digests`、`period_reviews`、`pinned_highlights`、`templates`、`import_batches`、`settings`、`heartbeat`），预置 9 个默认标签、8 档核心心情与 2 套默认写作模板。
2. 实现认证鉴权（口令验证、60 秒 IP 限流、`HttpOnly Cookie` + `Bearer` 令牌）与 `AES-256-GCM` 配置加密存储。
3. 实现日记 CRUD、每日日记防重复校验、专项复盘、图片上传限制与读取、`FTS5` 全文检索（含时间范围 `startDate/endDate`、标签、心情、类型筛选与高亮摘要）、30 天回收站还原。
4. **严格落盘 `C-18` 快照策略**：每次写入快照前先 `DELETE FROM entry_snapshots WHERE snapshot_date < ?`（清理早于今日上海日期的历史快照），再保留同 `entry_id` 最新 `5` 份，超过即删最旧；另在每日定时热备任务同步清扫过期快照。
5. 实现标签与心情安全删除事务（`DELETE /api/tags/:id`、`DELETE /api/moods/:id` 遇关联日记 `> 0` 时强校验 `replaceWithId`，执行替换与去重，零删除日记）。
6. 实现原平台 `ZIP` 导出包解析预览（`Markdown`/`CSV`/附件图片提取）、同日冲突清单（`skip`/`overwrite`/`merge`）、按批次撤销、以及每日 `SQLite` 热备 + `JSON`/`Markdown` 导出。
7. 编写并跑通 `apps/api` 核心路由集成测试。

### 里程碑 3：大模型三协议适配、回忆问答、时间簿联动与深度月/年复盘
1. 实现零重型框架的轻量 `ai-client.ts`：统一封装 `OpenAI` 兼容（`/chat/completions`）、`Gemini` 原生（`generateContent`）、`Anthropic` 原生（`/v1/messages`）的文本生成、工具调用与连通测试，超时与鉴权错误返回可读中文提示，永不向前端泄漏明文密钥。
2. 实现单篇结构化 6 字段日概要生成与指纹缓存、日历单篇按需补算接口、以及可暂停/断点续跑的批量补齐后台状态机。
3. 实现 `ai-qa.ts` 首页回忆问答：硬封装 `search_entries_fts`、`list_entry_digests`、`read_entry_full`、`aggregate_entry_stats` 4 个只读工具，硬限最多 4 轮调用循环与单次上下文上限，输出带耗时/步数的工具轨迹与真实日期出处列表。
4. 实现 `timebook-sync.ts`：读取加密保存的时间簿地址与口令，调用其 `POST /api/login` 与 `GET /api/sync?since=0`，按自然月/自然年汇总模块总小时数、环比差值与待办完成率；未配或异常时平滑降级返回 `available: false`。
5. 实现 `reviews.ts`：月度/年度自然周期锁判定、深度月报与深度年报生成（月报四维每维目标 `150～260` 字、输出上限 `3,000` 词元；年报三线每线目标 `300～500` 字、输出上限 `5,000` 词元；内置日期引用与深度提示词约束）、双高光两阶段筛选与 `pinned_highlights` 手动钉选/移出锁定保留逻辑。
6. 使用 Node 内置 `http` 启动本地模拟大模型与时间簿服务，编写并跑通全套联动、锁态、平滑降级与异常集成测试。

### 里程碑 4：`@lifebook/web` 完整前端与块级编辑器
1. 对齐 [视觉与动效设计规范](../设计规范.md) 建立 `tokens.css`（护眼暖白纸面、夜间深炭纸面、冷暖五档高反差热力图、10 套标签色、8 档心情色、减少动态效果适配）。
2. 构建顶栏/手机底栏四栏导航、主题切换、离线同步状态胶囊与断网本地草稿防丢队列（恢复联网自动补写同步）。
3. 基于 `TipTap` 实现沉浸式居中写作页：`/` 斜杠命令浮层、行首 `###` / `- ` / `1.` / `>` / `---` 快捷排版、划词格式工具栏（加粗、斜体、暖黄高亮、删除线）、粘贴/选图上传、默认模板套用、当日最多 5 份快照预览恢复、右侧可展开「那年今日」摘要/原文切换侧栏。
4. 实现首页（「✦ 问问过去的自己」问答框与工具轨迹/出处跳转、那年今日智能概要与平滑降级、冷暖高反差热力图、启用标签墙）、日历页（智能短标题与未总结日按需「✦ 补算概要」）、历史页（关键词荧光高亮与快捷时间段 + 自定义起止日期筛选）。
5. 实现统计页（基础指标、月度柱图、8 档心情条、**深度月度/年度复盘**含自然周期锁态与时间簿交叉对比、**月度/年度双高光时间轴**含直达原文与手动钉选/移出、快乐触发器/消耗点与可点选词云；**确保全页绝无「年度人物侧写」**）。
6. 实现设置抽屉（`✦ 模型服务` + `⏱ 时间簿只读联动` + `标签与心情管理（含未选目标禁止确认删除弹窗）` + `日记模板` + `历史数据搬家（含同日冲突处理与旧12→新8映射微调）` + `备份与 30 天回收站`）及 `PWA` 配置。

### 里程碑 5：容器编排、部署指南与独立打包脚本
1. 编写 `Dockerfile`（参考 `timebook/Dockerfile` 多阶段构建，`EXPOSE 3220`，`HEALTHCHECK /api/health`）、`docker-compose.yml`（默认端口 `3220:3220`，卷 `/volume1/docker/lifebook/data:/data`）、`.env.example`（仅含占位示例，绝不放真实口令）。
2. 编写纯中文的 [绿联NAS部署与使用指南](../绿联NAS部署与使用指南.md)（含容器部署步骤、首次访问初始化、模型/时间簿联动配置说明、手机全屏安装与每日备份还原指引）。
3. 编写 `scripts/release_app.py`（扫描项目产出 `_release-manifest.json` 并执行静态安全检查，排除 `node_modules`、`dist`、`workspace-data`、`.env`、`*.sqlite*`、本机用户路径与硬编码局域网 IP；注意仅对源码安全扫描，不包含原型里的示例展示）。

### 里程碑 6：全量自测与打包移交 `qa`
1. 依次执行 `corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build`，全部零错误通过。
2. 本地起独立临时端口冒烟跑通登录、写入、快照、检索、模拟模型问答与月度复盘后彻底清理临时目录与进程。
3. 运行 `python scripts/release_app.py build --output workspace-data/outputs/lifebook/v0.1.0-R1/lifebook.zip` 构建第 1 轮独立发布包。
4. 通过 Swarm 共享面板发 `@qa [review_requested]` 附上结构化交接清单，进入 `swarm_wait` 等待评审。

---

## 三、计划五项自查结论

1. **需求覆盖**：已完整覆盖 `C-01`～`C-20`（含深度月/年复盘、时间簿只读联动、双高光轴及手动钉选、当日 5 份快照跨日清理、导入同日冲突策略、标签迁移安全删除、三协议模型适配与回忆问答）。
2. **接口一致性**：`@lifebook/core` 与 `@lifebook/api`、前端 `api.ts` 共用同一份类型定义；时间簿接口经只读源码验证，完全匹配 `/api/login` 与 `/api/sync?since=0`。
3. **无未验证假设**：本机 `Node v24.15.0`、`pnpm 11.7.0`、`Python 3.13.2` 已实际验证，里程碑 0 首步即验 `better-sqlite3` 原生加载，有明确失败上报出口。
4. **可独立验证**：全流程均可使用 `SQLite` 独立目录、空闲高端口及本地模拟模型/时间簿 `HTTP` 服务闭环验证，零外部费用、零触碰真实家庭服务器。
5. **打包与运行边界清晰**：`scripts/release_app.py` 与 `fde-qa/scripts/unpack_verify.py` 清单格式对齐，发布包自包含且不掺杂开发态运行数据。
