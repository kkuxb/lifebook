# 人生簿 `v0.2.1` 维护简报（设计 · 实施 · 独立测试）

- **版本标识**：`lifebook v0.2.1`（局部简改，合并设计、实施与测试计划）
- **冻结日期**：`2026-11-28`
- **业务依据**：[需求澄清与讨论纪要](../requirements/lifebook-讨论纪要.md) `C-25`（部分替代 `C-08` 中关于自动保存静默更新摘要的旧口径）
- **用户原话摘要**：「需要改为，只有写完日记，点击“保存”按钮，才触发一次模型调用。」三项拍板确认：① 点击「立即保存」采用异步更新（秒响应不卡顿）；② 仅点「立即保存」触发，点「返回」不触发；③ 确认规则与三组验收场景并授权实施。

---

## 一、目标与业务口径

### 1.1 问题背景
在 `v0.2.0` 及以前版本中，前端编辑器（`EditorPage.tsx`）每停顿 `650ms` 会自动保存一次日记，而后端 `POST /api/entries` 与 `PUT /api/entries/:id` 在每次入库后都会无条件在后台异步调用 `generateAndCacheEntryDigest`。导致用户在开启模型开关后写长日记时，每停顿输入就会频繁静默调用大模型，且无同篇并发去重，产生大量无感知的模型费用消耗。

### 1.2 新业务口径（唯一执行依据）
1. **彻底切断自动保存与非保存动作的模型调用**：
   - 编辑器 `650ms` 防抖自动保存（`scheduleAutoSave`）：照常落库与保留当日 5 份防丢快照（沿用 `C-18`），但**严禁触发大模型调用**。
   - 点击编辑器左上角「← 返回」触发的兜底防丢保存：**严禁触发大模型调用**。
   - 断网恢复后自动执行的离线草稿队列同步（`flushOfflineQueue`）：**严禁触发大模型调用**。
   - 未显式声明触发摘要的接口写入调用：后端默认不调用大模型（安全默认值 `triggerDigest = false`）。
2. **唯一触发保存摘要的入口（异步非阻塞）**：
   - 仅当用户在编辑器中手动点击右上角「立即保存」按钮时，前端显式传入 `triggerDigest: true`。
   - 后端完成正文入库后，**立刻返回保存结果（不阻塞界面）**；若同时满足「模型开关已开启 + 已配置有效密钥 + 本篇标题/正文非空 + 标题与正文内容哈希相对已有缓存有变化」，才在后台异步触发 **1 次**单篇智能概要生成。
3. **防误触重复调用与并发去重**：
   - 若标题与正文未发生变化且已有同哈希缓存，再次点击「立即保存」直接跳过（`0` 次模型调用）。
   - 若同一篇日记正在生成摘要（在途请求尚未返回），用户快速连点「立即保存」时，服务端按 `entryId` + 内容哈希去重，不发出并发重复请求。
4. **未点「立即保存」离开时的降级体验**：
   - 仅靠自动保存或直接点「返回」离开的日记，不自动调用模型；首页「那年今日」与日历页平滑降级展示原标题与原文。用户后续可随时再点「立即保存」、日历页单篇「补算概要」或设置页「批量补齐」补算。
5. **非目标（保持现状不动）**：
   - 设置页「检测连通性」「批量补齐历史智能摘要」、日历页单篇「补算概要」、首页「问问过去的自己」、统计页「月度 / 年度深度复盘」保持原有手动触发机制不变。
   - 不改动桌面端（`apps/desktop`）与数据表结构。

---

## 二、技术方案与可执行实施清单（供 `dev` 执行）

### 2.1 接口与代码改动范围

1. **后端路由 [`apps/api/src/app.ts`](../../apps/api/src/app.ts)**
   - 在 `upsertEntrySchema` 新增可选字段：`triggerDigest: z.boolean().optional().default(false)`。
   - 在 `POST /api/entries` 与 `PUT /api/entries/:id` 中：
     - 将原本无条件执行的 `void generateAndCacheEntryDigest(db, masterKey, saved.id, false).catch(() => {});` 改为仅在 `if (body.triggerDigest)` 时调用。
     - 响应保持返回 `saved`（不破坏现有 `EntryRecord` 响应契约）。

2. **后端单篇摘要并发防重 [`apps/api/src/services/reviews.ts`](../../apps/api/src/services/reviews.ts)**
   - 在 `generateAndCacheEntryDigest` 中增加进程内并发去重保护：
     - 维护 `inFlightDigestTasks = new Map<string, Promise<EntryAiDigest | null>>()`（键为 `${entry.id}:${contentHash}`，同时当 `force === false` 时若同键已在途则直接复用同一个 `Promise`，不重复调用模型）。
     - 在 `finally` 中确保清理 `inFlightDigestTasks` 对应条目，避免异常后残留。
     - 保持原有的 `computeDigestHash` 哈希命中跳过逻辑、`cfg.enabled && cfg.apiKey` 守卫以及单篇格式容错自动重试逻辑不变。

3. **前端接口封装 [`apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts)**
   - `api.saveEntry` 入参新增可选字段 `triggerDigest?: boolean`，透传至请求体。

4. **前端编辑器 [`apps/web/src/pages/EditorPage.tsx`](../../apps/web/src/pages/EditorPage.tsx)**
   - `persistNow(createSnapshot: boolean = true, triggerDigest: boolean = false)`：
     - 调用 `api.saveEntry` 时显式传入 `triggerDigest`。
   - `scheduleAutoSave()`：保持 `650ms` 防抖，调用 `void persistNow(true, false)`。
   - 左上角「← 返回」按钮：先清理未触发的 `saveTimerRef.current`，再调用 `void persistNow(true, false)`，不触发模型。
   - 右上角「立即保存」按钮：先清理未触发的 `saveTimerRef.current`（防止 650ms 后重复提交），再调用 `void persistNow(true, true)`；
     - 成功提示文案优化：当 `status === "synced"` 时，若 `aiConfig.enabled` 为 `true`，提示 `"已保存至服务器（若内容有更新将在后台生成一次智能概要）"`；否则保持 `"已保存至服务器"`。
   - 卸载清理：组件卸载时 `window.clearTimeout(saveTimerRef.current)`，避免离开编辑器后残留防抖定时器再触发一次保存。

5. **前端离线队列 [`apps/web/src/lib/offlineQueue.ts`](../../apps/web/src/lib/offlineQueue.ts)**
   - `flushOfflineQueue()` 调用 `api.saveEntry` 时显式传入 `triggerDigest: false`，确保断网恢复自动同步绝不静默消耗模型额度。

6. **打包清单同步 [`scripts/release_app.py`](../../scripts/release_app.py)**
   - 在 `INCLUDE_DOC_FILES` 中加入 `"docs/designs/lifebook-v0.2.1-brief.md"`。

7. **自动化集成测试补充 [`apps/api/test/api.test.ts`](../../apps/api/test/api.test.ts)**
   - 在现有测试套件中新增专门用例，配合现有本地模拟模型服务器记录摘要接口调用次数（`digestCallCount`）：
     1. 开启模型开关后，调用 `POST /api/entries` 与 `PUT /api/entries/:id`（不传 `triggerDigest` 以及显式传 `triggerDigest: false`），等待异步队列排空，断言 `digestCallCount === 0` 且数据库中该篇无摘要、正文与当日快照均正常落库。
     2. 调用 `PUT /api/entries/:id` 并传 `triggerDigest: true`，等待后台摘要完成后，断言 `digestCallCount === 1` 且数据库中已生成该篇摘要。
     3. 标题与正文未变化时，再次传 `triggerDigest: true`，断言 `digestCallCount` 仍为 `1`（命中哈希缓存，增量 `0`）。
     4. 修改正文后并发发出两次 `triggerDigest: true`（配合短暂模拟延迟），断言 `digestCallCount` 仅增加 `1`（并发去重生效）。

### 2.2 实施自查与打包命令
1. 运行全套单测与构建：
   - `pnpm test`
   - `pnpm build`
2. 校验打包清单与构建独立发布包（输出到 `workspace-data/outputs/lifebook/v0.2.1-R<轮次>/lifebook-v0.2.1-R<轮次>.zip`）：
   - `python scripts/release_app.py check --root .`
   - `python scripts/release_app.py build --root . --output workspace-data/outputs/lifebook/v0.2.1-R1/lifebook-v0.2.1-R1.zip`
3. 自测通过且发布包构建成功后，在共享面板向 `@qa [review_requested]` 移交评审。

---

## 三、独立测试计划与验收标准（供 `qa` 执行）

### 3.1 测试原则与预算
- **严格隔离**：仅从 `dev` 交付的独立发布包 `lifebook-v0.2.1-R<轮次>.zip` 解压到独立临时目录进行检验与实测，不测开发源码目录，不修改源码与发布包。
- **零外部费用副作用**：所有模型交互均对接本地启用的模拟模型服务（记录每一次请求的精确次数、路径与入参），严禁调用用户真实模型密钥或线上接口。
- **返修上限**：最多 `3` 轮修复预算；实现缺陷直接 `@dev [changes_requested]` 打回，可收口则向 `@coordinator [done]` 汇报并附七维复盘报告（[`docs/deliveries/lifebook-v0.2.1-R<轮次>-test-report.md`](../deliveries/)）。

### 3.2 验收场景清单（`V12` ～ `V14`）

| 场景编号 | 场景名称 | 测试动作（隔离解压包执行） | 必须满足的业务合格判据 |
| --- | --- | --- | --- |
| `V12` | 自动保存与非保存动作零调用 | 启动解压后的独立服务（托管构建产物）与本地模拟模型计数器；开启模型开关并配置指向本地模拟服务。① 通过真实页面操作或端到端链路在编辑器分段输入标题/正文、修改标签与心情，等待多次 `650ms` 自动保存完成；② 点击「← 返回」离开编辑器；③ 模拟离线队列保存恢复同步。 | 1. 日记正文、标签、心情与当日快照均正确落库；<br>2. 本地模拟模型服务收到的摘要请求次数严格为 **`0`**；<br>3. 未点「立即保存」的日记在首页/日历平滑降级展示原标题与原文。 |
| `V13` | 点击「立即保存」精确触发 1 次与防重 | 在 `V12` 基础上重新打开该篇日记：① 点击右上角「立即保存」按钮；② 正文与标题不改，再次点击「立即保存」；③ 修改正文后短时间并发触发两次「立即保存」（含模拟模型延迟 `300ms`）。 | 1. 点击「立即保存」后接口立刻返回成功、界面不卡顿并给出明确保存提示；<br>2. 步骤 ① 后模拟模型服务精确收到 **`1`** 次摘要调用，数据库成功落盘该篇智能概要；<br>3. 步骤 ② 新增调用次数为 **`0`**；<br>4. 步骤 ③ 并发两次请求仅产生 **`1`** 次模型调用，且落库为最新正文摘要。 |
| `V14` | 既有手动入口与全量套件回归 | 在隔离解压包内运行全套单测与构建（`pnpm test`、`pnpm build`），并核验日历页单篇「补算概要」（`POST /api/entries/:id/digest/refresh`）、设置页「检测连通性」（`POST /api/settings/ai/test`）与「批量补齐」（`POST /api/ai/batch/start`）、首页回忆问答（`POST /api/ai/qa`）。 | 1. 全部自动化测试通过，构建零报错；<br>2. 四项既有手动模型入口按需调用正常，无误伤回归；<br>3. 核查发布包不含敏感凭据、运行库文件或绝对路径残留。 |
