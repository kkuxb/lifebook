# 人生簿（lifebook）v0.1.0-R1 验证与验收报告

结论：**定向修复**；用户业务确认：**待确认（本轮因独立发布包构建失败打回 `dev` 修复，尚未进入 `V1`～`V7` 隔离盲测）**。

> **给 PM 的业务语言摘要**：第 1 轮独立发布包（`v0.1.0-R1`）通过了清单与静态安全检查，`corepack pnpm install` 与 `corepack pnpm test`（12/12 项）通过，但在干净解压目录中执行 `corepack pnpm typecheck` 与 `corepack pnpm build` 均直接失败。根本原因是打包脚本 `scripts/release_app.py`（及 `.dockerignore`）未排除开发机残留的 `*.tsbuildinfo` 缓存，导致随包打入的 `packages/core/tsconfig.tsbuildinfo` 让 `tsc` 在无 `dist/` 时跳过编译输出，下游 `@lifebook/web` 与 `@lifebook/api` 找不到 `@lifebook/core` 声明文件而构建中断；同时 `typecheck` 阶段未保障前置依赖 `@lifebook/core` 类型产物可用。因生产构建产物无法在干净发布包中生成，本轮按测试规程暂停 `V1`～`V7` 子智能体盲测（时长与 Token 计量均为 0 次运行），直接退回 `dev` 定向修复后提交第 2 轮评审。

源码、安装副本、包版本与一致性：被测包 `workspace-data/outputs/lifebook/v0.1.0-R1/lifebook.zip`（ZIP SHA-256：`1bcbf19c28acfca63e0a60af25ce08ca3bb47cc0b26e085aab49ae31cb368704`，清单校验通过，65 个交付文件 + `_release-manifest.json` 共 66 个文件）；已解压至隔离目录 `workspace-data/tmp/qa/v0.1.0-R1/pkg/lifebook`；未修改被测包与项目源码。
环境与测试范围：Windows 11 / Node v24.15.0 / pnpm 11.7.0 / Python 3.13.2；已完成包校验、静态安全扫描、`pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm build`；`V1`～`V7` 盲测与容器实机运行未测。

---

## 实际结果

任务及授权：仅在隔离目录 `workspace-data/tmp/qa/v0.1.0-R1/` 对 `v0.1.0-R1` 发布包执行解压校验、静态安全扫描与一次性构建回归；严禁修改被测包或项目源码。
目标/确认完成/未处理：已完成解压校验（通过）、包内静态安全检查（通过）、`corepack pnpm install`（通过）、`corepack pnpm test`（12/12 通过）；`corepack pnpm typecheck`（失败）、`corepack pnpm build`（失败）；`V1`～`V7` 隔离盲测未执行（阻塞于构建失败）。
证据位置：
- 解压校验与安装环境：`workspace-data/tmp/qa/v0.1.0-R1/pkg/lifebook`
- 问题根因文件：`scripts/release_app.py`、`.dockerignore`、`package.json`、`packages/core/tsconfig.json`、`packages/core/tsconfig.tsbuildinfo`（包内残留文件，38,937 字节）

| 维度 | 观察及依据 | 判断/影响范围 |
|---|---|---|
| 业务完成度 | `corepack pnpm test` 中 `packages/core/test/core.test.ts`（6 项）与 `apps/api/test/api.test.ts`（6 项）共 12 项通过；但干净解压包中 `corepack pnpm build` 失败，`apps/web/dist` 与 `apps/api/dist` 无法生成，`V1`～`V7` 未能验证 | **不通过（阻断）**：无法形成可运行生产构建产物 |
| 质量 | `corepack pnpm typecheck` 报错 `TS2307: Cannot find module '@lifebook/core'`；`corepack pnpm build` 在执行 `@lifebook/core build` 后未生成 `packages/core/dist`，导致 `@lifebook/web build` 同样报 `TS2307` 与连带 `TS7006` 退出码 `2` | **不通过（阻断）**：发布包在干净环境与 `Dockerfile` 构建场景下不可构建 |
| 权限与副作用 | 静态安全扫描确认包内无 `.env`、无 `*.sqlite*`/`*.db`、无本机绝对路径、无真实密钥/口令、无真实局域网 IP（仅 `apps/api/test/api.test.ts` 中 `10.0.0.88`/`10.0.0.99` 模拟限流头），源码及前端文案零「年度人物侧写」残留 | **通过** |
| 异常处理 | 未进入 `V1`～`V7` 运行态实测，尚无运行态异常实证 | **未测（阻塞）** |
| 效率与成本 | 本轮未启动 `V1`～`V7` 测试子智能体；准备阶段 `pnpm install` 用时 `34.7s`、`vitest run` 用时 `2.24s` | **部分观测**（子智能体业务消耗为 0） |
| 复杂度 | `packages/core/tsconfig.json` 启用 `"composite": true` 生成 `tsconfig.tsbuildinfo`，但打包脚本未剔除该增量缓存，且根 `typecheck` 未处理包间构建依赖顺序 | **需简化修复**：剔除 `*.tsbuildinfo` 并理顺包间 `typecheck`/`build` 依赖 |
| 迁移与使用体验 | 若用户或部署者在干净机器按解压包或 `Dockerfile` 执行 `pnpm install && pnpm build`（或按测试计划先执行 `pnpm typecheck`），均会立即报错中断，无法开箱构建部署 | **不通过（阻断）**：影响干净容器与全新主机部署体验 |

> 已测与未测说明：已完成包清单哈希校验、包内静态安全检查、`corepack pnpm install`、`corepack pnpm typecheck`（失败）、`corepack pnpm test`（12/12 通过）、`corepack pnpm build`（失败）；`V1`～`V7` 无头浏览器与隔离接口盲测、关键截图视觉核对及 Docker 实机启动均为**未测**（将在 R2 构建修复后全量补齐）。

---

## 计量与修复

起止事件：本轮仅执行 QA 准备阶段校验与构建回归（`2026-11-21T10:27:45+08:00` 至 `2026-11-21T10:29:44+08:00`）；未启动 `V1`～`V7` 隔离子智能体。
业务时长：`V1`～`V7` 子智能体运行 `0` 次（`0s`）；人工等待：`0s`；监督复核：父级 QA 静态核验与命令实测。
模型请求/工具调用：`V1`～`V7` 子智能体消耗 `0`；输入 Token（含缓存）/其中缓存/输出：`不可用（未产生子智能体运行）`；费用：`不可用`。
对照可比性与质量边界：首轮基线记录，无可比历史轮次。

### 必修问题及最小修复

1. **[必须修复 / P0] 发布包与 Docker 构建上下文残留 `*.tsbuildinfo` 导致干净环境下 `corepack pnpm build` 失败**
   - **实测证据**：在 `workspace-data/tmp/qa/v0.1.0-R1/pkg/lifebook` 执行 `corepack pnpm build`，`@lifebook/core build` 退出码为 0 但未生成 `packages/core/dist/` 目录（包内预先存在 `packages/core/tsconfig.tsbuildinfo`，38,937 字节），紧接着 `@lifebook/web build` 报错 `src/App.tsx(10,8): error TS2307: Cannot find module '@lifebook/core' or its corresponding type declarations.`，命令以退出码 `2` 中断。
   - **最小修复要求**：
     - 在 `scripts/release_app.py`（`is_excluded`）及 `.dockerignore` 中排除所有 `*.tsbuildinfo` 文件；
     - 或确保 `packages/core` 构建脚本在需要全量产物时不受旧缓存干扰（如清理缓存或调整 `tsconfig.json`），保证**全新解压的干净发布包**内不存在任何 `*.tsbuildinfo` 残留，且执行 `corepack pnpm build` 能够稳定生成 `packages/core/dist`、`apps/web/dist` 与 `apps/api/dist`。

2. **[必须修复 / P0] 干净发布包首次执行 `corepack pnpm typecheck` 失败（未先生成 `@lifebook/core` 类型声明）**
   - **实测证据**：在干净解压目录执行 `corepack pnpm install` 后直接执行 `corepack pnpm typecheck`（`corepack pnpm -r typecheck`），`apps/api` 与 `apps/web` 报 `TS2307: Cannot find module '@lifebook/core' or its corresponding type declarations.`（退出码 `2`），因 `packages/core/package.json` 的 `exports` 指向 `./dist/index.d.ts`，刚解压时 `dist/` 尚未生成。
   - **最小修复要求**：
     - 让根 `package.json` 的 `typecheck` 脚本能够在全新干净包（尚未手动跑 `build` 时）正常通过（例如先执行 `@lifebook/core` 构建/声明生成再并发或顺序执行各包 `typecheck`，或配置合理的 TypeScript 解析/项目引用机制），确保按 `pnpm install -> pnpm typecheck -> pnpm test -> pnpm build` 顺序一次全部通过。

定向回归结果：待 `dev` 修复并交付 `v0.1.0-R2` 发布包后重验。
用户接受限制：无。
非阻断建议：无。

---

## 发布

包清单、哈希与实际内容检查：`unpack_verify.py` 验证 `v0.1.0-R1/lifebook.zip` 65 个交付文件与 `_release-manifest.json` 哈希一致；但因包内多打入了 `packages/core/tsconfig.tsbuildinfo`，导致发布包无法直接完成构建。
安装/调用入口：`corepack pnpm install` 可正常编译 `better-sqlite3`；`corepack pnpm typecheck` 与 `corepack pnpm build` 当前不可用。
升级保留内容与回滚：不适用（首版发布包）。
维护人及目标环境未测项：`V1`～`V7` 全量端到端隔离盲测、浏览器双端双主题视觉截图核验、绿联 NAS Docker 容器实机构建与运行未测。
