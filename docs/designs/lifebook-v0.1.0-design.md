# 人生簿（`lifebook`）`v0.1.0` 一期工程设计方案

- **日期与版本**：`2026-11-21` / `v0.1.0`（一期正式版）
- **状态与确认依据**：**已冻结**（由用户在 `2026-11-21` 终审确认冻结全部需求、深度盘点质量标准、当日 5 份快照跨日清理规则、7 组隔离验收场景与返修预算）
- **有效需求与设计基准**：
  - [需求澄清与讨论纪要](../requirements/lifebook-讨论纪要.md)（`C-01`～`C-20`）
  - [视觉与动效设计规范](../设计规范.md)
  - [高保真交互原型（第 3 版）](../../prototype/index.html)

---

## 1. 业务合同

- **使用者与触发方式**：面向个人每日撰写日记、定期开展专项/月度/年度复盘与回顾过往记忆；由绿联家庭服务器容器提供网页服务端（电脑宽屏与手机全屏 `PWA` 同步使用），口令鉴权后单人访问。
- **核心输入与前置**：
  - 日常输入：用户每天的块级富文本日记（日期、一句话标题、多选 8 档心情、多选分类标签、正文块、粘贴或上传的本地图片）与不绑定单日的「专项复盘」。
  - 历史迁入：原平台标准导出压缩包（含文本页面、目录表格及附件图片，实盘规模 `1,244` 篇约 `85.3` 万字）。
  - 可选外部能力：大语言模型接口参数（`OpenAI` 兼容 / `Gemini` 原生 / `Anthropic` 原生）、兄弟项目「时间簿（`timebook`）」局域网服务地址与访问口令。
- **核心输出与去向**：
  - 全部日记、图片附件、快照、摘要缓存与周期复盘持久化保存在容器挂载卷 `/data`（宿主机 `/volume1/docker/lifebook/data`）；
  - 每日自动在线热备至 `/data/backups`，支持手动导出全量 `JSON` 与标准 `Markdown` 压缩包；
  - 大模型智能摘要、回忆问答（附原文日期出处）、深度月/年复盘与双高光时间轴呈现在对应前端视图，异常或未配置时平滑降级展示原文与基础统计。
- **完成与部分完成判据**：
  - 7 组隔离验收场景（`V1`～`V7`）全部满足合格判据，前端构建产物、`API` 集成测试与核心领域单测 100% 通过，独立容器构建与健康检查就绪。
  - 模型服务或时间簿服务未配置/不可达时，所有核心写日记、历史搬家、全文检索、热力图与基础统计仍 100% 正常工作（记为降级就绪，绝不报错阻断）。
- **质量底线**：
  - 删除关联日记的标签或心情时绝不删除任何一篇日记（后端事务强制校验替换目标）；
  - 模型密钥与时间簿口令加密保存、永不回传前端明文；
  - **月度四维与年度三线复盘必须按 `C-17` 要求深度展开**（月报每维 `150～260` 字、年报每线 `300～500` 字，含真实日期与时间簿对照事实），绝不输出两句话浅层概述；
  - 界面彻底移除「年度人物侧写」，全文纯中文简体。
- **一期明确非目标**：
  - 不做「灵感小记」模块（`C-01`）；
  - 一期不打包电脑端独立桌面安装包（留作二期，`C-02`）；
  - 不做多用户账号、公网社交或自动外发分享；
  - 不修改兄弟项目「时间簿」的任何源代码或容器挂载配置（`C-15`）。
- **已确认工程事实与兼容性边界**：
  - 本机研发测试运行环境实测为 `Node v24.15.0` + `pnpm 11.7.0` + `Python 3.13.2`；生产容器目标底座沿用兄弟项目 `node:20-bookworm-slim`；默认端口 `3220`（避开时间簿 `3210`）。
  - 兄弟项目 `timebook` 服务端接口实证：提供 `POST /api/login`（支持 `{ password }` 返回令牌）与 `GET /api/sync?since=0`（返回全量 `modules`、`tags`、`sessions`、`todos`、`todoChecks` 软删感知集合）。

---

## 2. 关键架构选择

| 决策项 | 选定方案 | 放弃的备选方案 | 推荐与冻结依据 |
| --- | --- | --- | --- |
| **整体工程结构** | `pnpm` 多包单仓：`packages/core` + `apps/api`（`Hono` + `better-sqlite3`）+ `apps/web`（`React 18` + `Vite` + `PWA`） | 重型全栈框架或分仓部署 | 与「时间簿」同构，单镜像单端口 `3220` 部署于绿联，静态资源由 `Hono` 统一托管、免去跨域与反向代理烦恼 |
| **全文检索引擎** | `SQLite` 内置 `FTS5` 虚表（`unicode61` 分词 + 二元/子串兜底匹配） | 引入独立外部搜索引擎或纯内存全表扫描 | 零额外容器依赖，`85` 万字约 `1,250` 篇规模在几十毫秒内完成标题与正文高亮检索 |
| **块级富文本组件** | `TipTap`（基于 `ProseMirror`）+ 自研轻量化 `/` 斜杠菜单与划词气泡栏 | 简陋 `textarea` 或纯手写 `contenteditable` | 稳定支持二三级标题、有序/无序列表、待办复选框、引用、代码块、分割线、本地插图、`Markdown` 快捷键与历史快照无缝恢复 |
| **大模型接入方式** | 绿联服务端轻量直连三协议原生接口（`OpenAI` 兼容 / `Gemini` / `Anthropic`）+ 4 个只读工具函数循环 | 引入第三方重型智能体框架或前端直连模型 | 密钥不落地浏览器，无需重型框架依赖，工具调用硬限 4 轮且零写入工具暴露，绝对安全可控 |
| **时间簿联动方案** | 通过时间簿现成 `/api/login` + `/api/sync?since=0` 局域网只读拉取并在本服务端聚合 | 跨容器直接挂载时间簿 `SQLite` 文件 | 零改动时间簿代码与部署编排，无 `WAL` 跨容器锁冲突风险，离线自动降级 |

---

## 3. 职责、数据流与核心合同

### 3.1 三层智能摘要与周期复盘数据流

1. **第 1 层 · 单篇结构化日概要（保存时静默生成，按正文指纹缓存）**
   - 触发：日记正文保存/更新、日历按需点击补算、设置页批量补齐任务。
   - 输入：单篇日期、标题、心情、标签、纯文本正文。
   - 输出并落库字段（约 `220～320` 字/篇）：`short_title`（12～18 字）、`summary`（60～90 字）、`dim_life`、`dim_work`、`dim_leisure`、`dim_people_notes`、`key_events_json`（0～2 条含重要度 `1～5` 与性质）、`topics_json`（2～4 个主题词）、`reflection`（情绪诱因/反思一句话）。
2. **第 2 层 · 月度深度复盘与月度高光轴（进入次月 1 日后解锁生成并缓存）**
   - 自然月锁校验：依据 `Asia/Shanghai` 当前日期，若目标月份 `YYYY-MM >= 当月` 返回 `{ locked: true, unlockDate: "次月1日" }` 拒绝生成。
   - 上下文输入：当月全部单篇结构化日概要（按日期正序）+ 当月量化统计（写日记天数、总字数、均值、8 档心情分布）+ 本地规则初筛出的前 10～12 个月度高光候选 +（若时间簿已配且连通）时间簿当月模块总时长、占比、环比上月及待办完成率。
   - 深度质量合同（提示词与后端结构校验双保障）：月度总评 + 交叉洞察（联动开启时）+ **四维深度盘点（每维 150～260 字，按“带日期具体事实 → 过程规律与耗时对照 → 客观得失”展开）** + 下月 2～3 条具体小建议 + 月度高光精选 4～6 条（合并用户 `pinned_highlights` 锁定）。
3. **第 3 层 · 年度深度复盘与年度高光轴（每年 1 月 1 日后解锁上一自然年并缓存）**
   - 自然年锁校验：依据 `Asia/Shanghai` 当前日期，若目标年份 `YYYY >= 当年` 返回 `{ locked: true, unlockDate: "次年1月1日" }`。
   - 上下文输入：全年可用月度复盘全量摘要 + 全年量化统计 + 全年专项/年度复盘原文 + 全年高光候选池（各月月轴条目 + 全年带「重要事件」「节点事件」「年度复盘」标签的日记防漏兜底）+（若时间簿已配）全年模块投入聚合。
   - 深度质量合同：年度总评 + 四季节奏迁移（`Q1～Q4`）+ **工作积累/生活秩序/个人成长三线深度盘点（每线 300～500 字，按“全年演进脉络 → 跨月事实例证与量化佐证 → 深层收获与瓶颈”展开）** + 跨月重复行为模式 + 来年 3 条锚点 + 年度高光精选 8～12 条（去重合并连续事件并尊重 `pinned_highlights`）。

### 3.2 数据库核心表结构（`SQLite` + `FTS5`）

| 表名 | 核心字段与约束 | 说明 |
| --- | --- | --- |
| `entries` | `id`, `kind` (`daily`\|`special`), `date` (`YYYY-MM-DD`), `title`, `content_html`, `content_text`, `word_count`, `import_batch`, `created_at`, `updated_at`, `deleted_at` | 对 `kind='daily' AND deleted_at IS NULL` 建部分唯一索引 `date`，防止同日重复日记 |
| `entries_fts` | `FTS5` 虚表：`entry_id`, `title`, `content_text` | 由事务同步更新；同时辅以短词 `LIKE` 兜底保证中文单字/双字 100% 命中 |
| `tags` | `id`, `name`（唯一未删除）, `color_key`, `color`, `tint`, `ink`, `dark_tint`, `dark_ink`, `enabled`, `sort`, `created_at`, `updated_at` | 预置 `C-01`/`设计规范` 的 9 个标签与 10 套精选色板 |
| `moods` | `id`, `emoji`, `name`, `label`, `tone`, `level`, `sort`, `created_at`, `updated_at` | 预置 `C-11` 确认的 8 档核心心情 |
| `entry_tags` / `entry_moods` | `(entry_id, tag_id)` / `(entry_id, mood_id)` 复合主键 | 支持标签/心情安全替换与 `INSERT OR IGNORE` 去重 |
| `entry_snapshots` | `id`, `entry_id`, `snapshot_date`, `title`, `content_html`, `word_count`, `created_at` | **写入时自动删除 `snapshot_date < 当日上海日期` 的全部旧快照，并截断保留同 `entry_id` 当日最新 5 份** |
| `entry_ai_digests` | `entry_id`（主键）, `content_hash`, `short_title`, `summary`, `dim_life`, `dim_work`, `dim_leisure`, `dim_people_notes`, `key_events_json`, `topics_json`, `reflection`, `updated_at` | 按正文指纹永久缓存 |
| `period_reviews` | `id`, `scope`, `period_key`, `with_timebook`, `overview_json`, `cross_insights_json`, `dimensions_json`, `next_actions_json`, `highlights_json`, `token_usage_json`, `created_at`, `updated_at` | `(scope, period_key)` 唯一索引缓存 |
| `pinned_highlights` | `id`, `scope`, `period_key`, `entry_id`, `action` (`pin`\|`exclude`), `updated_at` | 记录用户手动钉选或移出锁定 |
| `templates` / `import_batches` / `settings` / `heartbeat` | 模板分段、导入批次、加密配置键值、健康检查表 | `settings` 中含密钥字段使用 `AES-256-GCM` 密文保存，接口响应一律掩码化 |

### 3.3 核心服务端路由契约

- **健康与认证**：`GET /api/health`（写读 `heartbeat` 验证数据库健康）、`POST /api/login`（5 次失败锁定 60 秒 IP 限流）、`POST /api/logout`、`GET /api/auth/me`。
- **日记与快照**：`GET /api/entries`（支持 `q`、`startDate`、`endDate`、`kind`、`tagId`、`moodId`、`page`、`pageSize`）、`GET /api/entries/:id`、`GET /api/entries/by-date/:date`（包含同日历年「那年今日」与摘要）、`PUT /api/entries/:id` / `POST /api/entries`、`DELETE /api/entries/:id`（软删进 30 天回收站）、`GET /api/entries/:id/snapshots`（仅返回当日最新最多 5 份）、`POST /api/entries/:id/snapshots/:snapId/restore`。
- **图片附件与回收站**：`POST /api/uploads`（存 `/data/uploads`，校验图片 `MIME` 与大小限制 `<= 10MB`）、`GET /api/uploads/:filename`、`GET /api/trash`、`POST /api/trash/:id/restore`、`DELETE /api/trash/:id`。
- **标签、心情与模板**：`GET/POST/PATCH /api/tags`、`DELETE /api/tags/:id`（存在关联日记时若未传合法 `replaceWithId` 返回 `400` 拒绝；事务内迁移并去重，零删除日记）、`GET/POST/PATCH /api/moods`、`DELETE /api/moods/:id`（同安全替换逻辑）、`GET/PUT /api/templates`。
- **热力图与基础统计**：`GET /api/stats/heatmap?year=YYYY`、`GET /api/stats/overview?year=all|YYYY`（汇总篇数、字数、月度趋势、8 档心情分布）。
- **原平台导入与备份导出**：`POST /api/import/preview`、`POST /api/import/commit`、`GET /api/import/batches`、`DELETE /api/import/batches/:batchId`、`GET /api/backup/status`、`POST /api/backup/run`、`GET /api/export?format=json|markdown`。
- **模型配置、智能摘要、回忆问答与时间簿联动**：
  - `GET/PUT /api/settings/ai`、`POST /api/settings/ai/test`、`POST /api/ai/batch/start`、`POST /api/ai/batch/pause`、`GET /api/ai/batch/status`、`POST /api/entries/:id/digest/refresh`；
  - `POST /api/ai/qa`（硬封装 4 个只读工具，最多 4 轮调用，返回 `answer`、`traces`、`citations`、`tokenUsage`）；
  - `GET/PUT /api/settings/timebook`、`POST /api/settings/timebook/test`；
  - `GET /api/reviews/monthly/:ym`、`POST /api/reviews/monthly/:ym/generate`、`GET /api/reviews/yearly/:year`、`POST /api/reviews/yearly/:year/generate`、`POST /api/reviews/:scope/:periodKey/highlights/pin`、`POST /api/reviews/:scope/:periodKey/highlights/exclude`。

---

## 4. 风险、预算与安全边界

- **授权与副作用边界**：
  - 所有外部模型与时间簿请求均由用户主动配置并触发；开发与测试阶段使用本地模拟 `HTTP` 服务验证三协议及时间簿联动，**零真实外部付费调用、零访问用户真实生产绿联服务**。
  - 删除标签/心情/软删恢复/快照清理均受数据库事务保护，任何情况不丢失正文数据。
- **效率与成本预算**：
  - 全文检索（`1,250` 篇规模）响应 `< 100ms`；常规页面接口 `< 50ms`。
  - 单篇摘要约 `220～320` 字并永久缓存；回忆问答最多 `4` 轮只读工具调用（单次总上下文上限 `16,000` 字符）；月报输出上限 `3,000` 词元，年报输出上限 `5,000` 词元。
- **返修与质量预算**：
  - 研发自测 + `qa` 隔离盲测共 7 个代表性场景（`V1`～`V7`）；发现实现缺陷授权最多 **3 轮**点对点退修，超轮次或需调整业务口径立即上报 `PM`。

---

## 5. 部署与验收摘要

- **部署产物**：`Dockerfile`（多阶段精简镜像，默认端口 `3220`，持久化 `/data`）、`docker-compose.yml`、`.env.example`、`docs/绿联NAS部署与使用指南.md`、`scripts/release_app.py`。
- **发布包与验收**：由 `scripts/release_app.py` 打包至 `workspace-data/outputs/lifebook/v0.1.0-R<轮次>/lifebook.zip`（含 `_release-manifest.json` 并通过静态安全扫描）；`qa` 仅对解压后的独立发布包执行编译单测与 `V1`～`V7` 隔离子智能体盲测，最后由 `PM` 独立核对产物并与用户完成最终验收与本地 `Git` 归档。
