# P5 固定回归数据集与已有运行比较

## 已实现边界

- 公司管理员专属 `skill-evaluations` API 与四语界面；不是对上游普通技能权限的重新定义。
- 从同公司、同技能、未删除的 `companySkillTestInputs` 加载正文，和人工提交的精确预期输出一起冻结。每集最多100条；无修改、删除 API。
- 比较两个**已有且不同**的 `companySkillVersions`。请求只携带版本、数据集与测试运行 ID，不能携带输入正文、运行输出、评分或成本。
- 服务加载同公司同技能、未删除的 `companySkillTestRuns`（包含已被后续运行替代的历史记录），复用 `paperclip-eval-kernel` 做纯记录矩阵评分。缺失、失败、输入不匹配、同用例重复运行都不能变成通过。重复运行不自动挑选“最好”结果，而是要求明确选择。
- 比较相同代理配置快照与模板正文的哈希；缺失或不同执行上下文不形成可复核的孤立技能改善结论。不同模型/配置可展示结果，但不能通过此门槛。
- 评分只有 `exact_text_v1`，不声称语义质量、开放式任务评分、模型评审或自动提示词优化。
- 公司内 `requestId` + 请求哈希 + 事务级 advisory lock 提供持久幂等；同 ID 不同输入409。成功请求重试返回原记录，不受后来输入/账本变化影响。新报告引用冻结数据集，保存运行与成本证据快照、版本文件清单哈希，审计日志与记录同事务落库。
- 列表按 UUID 游标分页，每页50条；证据选择器展示100版本/100输入/200最近运行，允许显式输入更早 ID。

## 成本含义

成本来源是同公司 `costEvents.issueId`，关联已有运行的 harness issue。上游 `company_skill_test_runs_company_issue_idx` 是 `(companyId, issueId)` 唯一索引，因此两条测试运行不能共享一个 harness issue。回归测试检查此约束。

`recorded_issue_ledger_snapshot` 是**捕获时已记录的任务账本**，不是供应商最终账单，不代表费用已结算，也不提供事后预算强制停止。没有行、未定价记录、非法金额均为未知，不能当作零费用；订阅已包含的已记录行保留其金额。保留小数分；可选整数分费用上限在未知费用时阻塞。已知小计只累计成本完全已知的用例，不将部分未知用例假定为完整金额。晚到成本需要新的比较请求，原报告不会被改写。

报告保留固定分母、通过/阻塞数、费用未知数、通过数变化、逐用例运行ID及输出哈希。只有完整证据、候选全部通过且不退步、满足可选记录费用上限才标记 `eligibleForHumanReview`；这**不是执行授权或提升成功**。

## 提升/回滚边界与后续受控入口

原始评测 readiness 保留直接 promotion/rollback 不可用的兼容响应；评测 compare 本身始终不执行、不修改 `currentVersionId`。后续新增独立的人类 session 受控文件恢复入口及页内面板，详见 [整树恢复协议与限制](evaluation-restore.md)。仅支持已经暂停、未被代理使用的 managed-local 技能；不是通用活跃 rollout。通用 readiness 的 `capabilityScope=comparison_only` 明确旧两个 false 只描述 compare 接口；`controlledRestore.implemented=true` 发现独立能力并给出公司限定的 report-specific readiness 路径。通用结果 `readiness=null`、`authorityGranted=false`，blocker 为 `report_specific_human_restore_readiness_required`；必须向独立端点以真实管理员 session 查询具体报告，查询本身也不是执行授权。

上游 `company-skills.ts` 已有：
- 私有 `materializeVersionSnapshot`：在 `__versions__/skill/version` 创建不可变运行目录，校验完整文件清单、字节与可执行位；**并非**恢复可编辑 live skill 文件。
- 私有 `withSkillFileMutation`：slug advisory lock、技能行锁与重读身份。
- 公共 `updateFile`：单文件 CAS、内容与模式回滚、重新生成版本；多次调用不能构成整树原子恢复，不能处理额外文件删除与崩溃中断一致性。

受控恢复切片在上游文件变更边界增加整树恢复入口，需独立审阅/集成验证：校验来源可编辑性与路径/符号链接/执行文件安全，验证目标完整清单，锁与 expected-current-version CAS，处理新增/删除/二进制/可执行位，协调元数据/技能版本/文件交换与失败补偿，覆盖进程中断恢复；人类会话和策略权限、过期报告、重复确认、并发编辑及失败恢复均需真实文件系统/数据库测试。不能仅设置版本指针来假装完成回滚。

## 集成清单（父工作树负责共享文件）

1. `packages/shared/src/index.ts`: `export * from "./mimouse-evaluation.js";`
2. `packages/db/src/schema/index.ts`: `export * from "./mimouse_evaluation.js";`
3. `server/package.json` **devDependencies**: `"@paperclipai/paperclip-eval-kernel": "workspace:*"`，不能放 runtime dependencies/bundleDependencies：release map 禁止公开包依赖未发布的私有包，bundle staging 也会去 npm 下载。新增 `prepare:eval-vendor` 为 `pnpm --filter @paperclipai/paperclip-eval-kernel build`；build/typecheck 在 tsc 前运行它，build 在 tsc 后运行 `node scripts/vendor-eval-kernel.mjs`。源代码经过 `src/vendor/paperclip-eval-kernel/index.ts` wrapper；最终复制真实 compiled JS/declarations/maps 到同名 dist vendor 路径，带 MIT LICENSE 和文件哈希 PROVENANCE，不能把转发私有包的 shim 留在发布产物中。按仓库约定不提交锁文件。
4. `server/src/app.ts`: 导入 `mimouseEvaluationRoutes`，在现有公司 API 路由附近 `api.use(mimouseEvaluationRoutes(db));`。
5. `ui/src/App.tsx`: 导入 `MimouseEvaluation`；公司路由 `skill-evaluations` 渲染该页，非前缀路径交给 `UnprefixedBoardRedirect`。
6. `ui/src/lib/company-routes.ts`: 添加 `"skill-evaluations"`；两套 Sidebar 添加路径 `/skill-evaluations`，标签 `t("evaluationUi.pageTitle")`，复用现有 `ListChecks` 图标。
7. 从 `ui/src/i18n/contributions/evaluationUi/{en,zh-CN,es,ja}.json` 通过现有合并脚本生成四语 locales。
8. 请求日志策略将 `skill-evaluations` 视为敏感区；预期输出和运行内容不得进入 HTTP 请求体日志。审计只写 ID/哈希。
9. 生成并检查迁移（两个新增表及关联/索引）；先建 datasets 表及 `(company_id,id)` 唯一索引，再添加 comparisons 的复合数据集外键。`company_skills`/`company_skill_versions`/`companies` 已存在。比较版本 FK 与数据集 FK 使用 RESTRICT；无级联删除证据。本工作树未修改 migration journal 或生成迁移。
10. 集成后运行全链路类型检查、迁移/数据库幂等与跨公司测试、浏览器交互验收。单测和 React 测试不替代这些验证。

## 本切片已运行验证

- 独立轻量 Vitest 配置通过17项服务纯函数/合同/路由测试：固定矩阵、失败与缺失、输入篡改、未知费用、重复/跨公司身份、执行上下文、唯一harness issue成本约束、伪造请求、管理员/代理/成员边界及无执行接口。
- React/jsdom四项通过：四语未知成本与禁止恢复提示、无权限隐藏表单、公司切换清除报告、七位小数分显示。
- token gates 全通过。
- 尚未在本工作树运行全量类型检查、构建、数据库迁移或真实浏览器；按并行内存预算由父工作树统一执行。

- 新增 `tests/mimouse/evaluation.spec.ts` 六项真实可丢弃数据库/API fixture（父工作树运行）：并发幂等、输入冻结、JSONB报告哈希、跨公司/技能/版本边界、复合FK、缺失/失败/上下文不一致证据、成本未知/小数/晚到记录，以及实际表上的显式session actor路由合同。此文件尚未执行；local_trusted fixture 中注入actor不代表真实登录/SSO验收。

- 发布兼容补充：vendoring helper 的三项 Vitest 测试通过，验证私有依赖不存在时的相对运行入口、类型声明/许可证/来源哈希，以及未知运行时 import/缺失构建产物的失败关闭。生产完整打包安装验收仍由父工作树统一执行。

## 上游连续运行与历史证据

上游 `createTestRun` 对同技能/同输入的所有旧运行设置 `supersededAt`，与版本无关；未完成旧运行同时被取消。因此评测必须允许选择已完成的历史 superseded 运行，否则正常的基线→候选流程无法比较。证据列表保留 `supersededAt`、`harnessIssueDeletedAt`；报告固定历史标记，界面明确显示历史身份。仍排除 deleted 记录，仍校验公司/技能/版本与冻结输入；queued/running/cancelled/failed 仅形成阻塞结果，不计通过。

新增第七项数据库夹具使用真实 `companySkillService.createTestRun` 连续创建两个已有版本的运行，显式注入数据库 `createHarnessIssue` 与 NO-OP `wakeHarnessIssue`，再明确填写fixture完成快照。覆盖上游真实superseding副作用、历史成功证据比较、未完成旧运行自动取消及报告不变；没有执行Agent或模型。由父工作树运行，未在本工作树启动数据库。

冻结输入与上游运行保持同一边界：对源测试输入执行 JavaScript `String.trim()`，仅去除首尾空白，保留内部换行/缩进；纯空白输入拒绝。数据集用例 `id` 仍是原输入ID，另存 `sourceInputSnapshot` 原始正文，并把原文与规范化正文都绑定进数据集哈希。预期输出和运行输出不做trim，继续严格逐字符比较。原有已冻结数据集不会被迁移改写；新建数据集采用此规范化。

本次历史运行/trim修复复验：12项纯函数/合同测试、5项UI测试与token gates通过；新增真实createTestRun数据库夹具未在本工作树执行，等待父工作树统一验证。
