# 人生簿（Lifebook）项目文档索引

- **项目标识（`slug`）**：`lifebook`
- **当前阶段**：**`v0.2.1` 已正式验收收口并推送远端发布（标签 `v0.2.1`；取消写作自动保存静默调用模型，改为仅点击「立即保存」触发 1 次异步概要生成）**
- **下一步**：NAS 端执行 `git pull origin main && docker compose up -d --build` 即可同步升级全部功能，桌面端点击「人生簿 → 刷新当前页面」立即生效（无需重装桌面端）。

## 一、版本更新与当前有效文档

- **`v0.2.1` 维护版本（`2026-11-28` 已验收发布，验收基线提交：`eb20e9f`，远端标签：`v0.2.1`）**：
  - [v0.2.1 验收记录](deliveries/lifebook-v0.2.1-acceptance.md) ｜ [v0.2.1-R1 验证报告](deliveries/lifebook-v0.2.1-R1-test-report.md)
  - [v0.2.1 维护简报（设计 · 实施 · 测试）](designs/lifebook-v0.2.1-brief.md)（依据 `C-25`，含 `V12`～`V14` 隔离验收场景）
- **二期 `v0.2.0` 正式版本（`2026-11-21` 已验收发布）**：
  - [v0.2.0 验收记录](deliveries/lifebook-v0.2.0-acceptance.md) ｜ [v0.2.0-R1 验证报告](deliveries/lifebook-v0.2.0-R1-test-report.md)
  - [v0.2.0 工程设计方案](designs/lifebook-v0.2.0-design.md)
  - [v0.2.0 可执行实施计划](designs/lifebook-v0.2.0-implementation-plan.md)
  - [v0.2.0 独立测试计划](designs/lifebook-v0.2.0-test-plan.md)（`V8`～`V11` 隔离盲测方案）
- **`v0.1.1` 维护更新（`2026-11-21`）**：重构足迹热力图 8 档心情语义色谱与图例联动（含旧库默认色平滑迁移）；升级历史检索多词联合查询与命中上下文智能摘录；增强首页回忆问答对标签、心情、字数统计与排名的查询能力；提升单篇日概要输出上限、JSON 容错清洗与自动重试机制，并明确展示批量后台运行与跳过日期清单。

- [v0.1.0 验收记录](deliveries/lifebook-v0.1.0-acceptance.md) ｜ [R3 定向验证报告](deliveries/lifebook-v0.1.0-R3-test-report.md) ｜ [R2 全量验证报告](deliveries/lifebook-v0.1.0-R2-test-report.md)
- [绿联NAS部署与使用指南](绿联NAS部署与使用指南.md)
- [需求澄清与讨论纪要](requirements/lifebook-讨论纪要.md)（含原空间及「时间簿」只读实证盘点、已确认决定表 `C-01`～`C-24`）
- [v0.1.0 一期工程设计方案](designs/lifebook-v0.1.0-design.md)（`2026-11-21` 冻结）
- [v0.1.0 可执行实施计划](designs/lifebook-v0.1.0-implementation-plan.md)
- [v0.1.0 独立测试计划](designs/lifebook-v0.1.0-test-plan.md)
- [视觉与动效设计规范](设计规范.md)
- [高保真交互原型参考（第 3 版）](../prototype/index.html) ｜ [原型试玩指南](../prototype/README.md)

## 二、基础规则与方法

- [项目背景与待确认项](requirements/project-context.md)
- [开发方法](development-method.md)
- [项目规则](../AGENTS.md)
