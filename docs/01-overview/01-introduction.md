# 项目概览与模块定位

> **对应代码** — `server/src/`、`ui/src/`、`packages/shared/src/`、`packages/db/src/`、`external-adapters/`
> **维护提示** — 产品边界、模块职责或二开合同入口变化时更新
> **最后验证** — 2026-10-29（对照目录、清单和现有合同）

## 一、产品边界

本仓在 Paperclip 控制面之上增加 MiMouse 集成。核心工作对象仍是公司、Agent、目标、任务、审批、预算、运行和工作成果；新功能必须保留公司隔离、单一 assignee、原子 checkout、审批、预算硬停止及变更审计。

产品目标见 [GOAL](../../doc/GOAL.md)、[PRODUCT](../../doc/PRODUCT.md)；V1 具体要求见 [SPEC-implementation](../../doc/SPEC-implementation.md)。Agent 运行适配器、外部账号、模型和业务系统各有独立执行边界，不能用控制面状态代替供应商成功回执。

## 二、模块职责

先根据问题归属定位代码和合同，跨层变更同步更新共享类型、API 和 UI 消费方。

| 路径 | 职责 |
|---|---|
| `server/src/` | Express API、身份授权、任务调度、执行与领域服务 |
| `ui/src/` | React 管理界面、API 客户端、公司上下文和四语展示 |
| `packages/shared/src/` | 跨 server/UI/CLI 的常量、类型和校验 |
| `packages/db/src/` | Drizzle schema、PostgreSQL 客户端与迁移 |
| `packages/adapters/` | 上游内置执行适配器 |
| `external-adapters/` | 本仓的 Qoder 与 WorkBuddy 外部适配器包 |
| `packages/plugins/` | 插件运行与集成包 |
| `packages/skills-catalog/`、`packages/teams-catalog/` | 随应用提供的技能与团队目录 |
| `cli/`、`scripts/` | CLI、开发、构建、检查与发布辅助入口 |
| `tests/mimouse/` | 二开隔离 API、认证与浏览器检查入口 |
| `doc/mimouse/` | 二开功能合同、用户验收、缺口和日期证据 |

UI 视觉值依 [DESIGN](../../DESIGN.md) 从 `ui/src/index.css` token 层引用。新增连接器按 [Connector Playbook](../../doc/connections/CONNECTOR-PLAYBOOK.md)；修改适配器按[适配器作者指引](../../packages/adapters/AUTHORING.md)。

## 三、二开功能合同

本表仅定位 owner 与事实源，支持范围和默认开关在对应模块维护。

| 功能 | 合同入口 | 需特别区分的事实 |
|---|---|---|
| 认证 | [Casdoor](../../doc/mimouse/casdoor.md) | 本地 OIDC fixture 与真实 IdP 的账号/会话行为 |
| Agent 扩展 | [WorkBuddy](../../doc/mimouse/workbuddy.md)、[能力证据](../../doc/mimouse/adapter-capabilities.md) | loader 能加载、C2 协议成立与真实账号任务完成 |
| 通知 | [通知](../../doc/mimouse/notifications.md) | 保存配置、授权测试、实际投递与未知结果核对 |
| 编码交付 | [编码](../../doc/mimouse/coding.md) | 代码交付记录、构建观测、签名准入与实际上传 |
| 反馈 | [Langfuse](../../doc/mimouse/langfuse.md)、[来源链](../../doc/mimouse/FEEDBACK-EVALUATION-LINEAGE.md) | 来源引用、人审证明与独立机器复现 |
| 调研与运营 | [调研](../../doc/mimouse/research.md)、[运营](../../doc/mimouse/operations.md) | 候选/人工快照/预演与真实来源采集、业务 apply |
| 评估与迭代 | [评估](../../doc/mimouse/evaluation.md)、[恢复](../../doc/mimouse/evaluation-restore.md) | 固定夹具结果、受控提升与真实模型质量/费用 |
| 国际化 | [四语范围](../../doc/mimouse/i18n_remaining.md) | 资源键、静态审计、组件回归和真实布局/IME |

## 四、当前缺口与完成判定

当前二开仍包含代码缺口和真实环境验收缺口；统一以 [REMAINING](../../doc/mimouse/REMAINING.md)维护。特别是六目标 Runner/controller 与签名准入、内部产物上传、业务源读取、业务 apply/持久执行/对账，需要外部合同并继续实现。不会要求操作者测试尚不存在的成功路径。

已有代码的 Casdoor、Qoder、WorkBuddy、通知、GitLab、Langfuse 等仍按允许的真实环境范围分别验证。真实浏览器、操作系统输入法、跨平台及最终发行包检查也独立留证。执行入口见[用户验收](../../doc/mimouse/USER-ACCEPTANCE.md)，实际结果见[验证记录](../../doc/mimouse/VERIFICATION.md)，状态语义见[验证规范](../05-maintenance/01-verification.md)。

## 五、三类数据路径

排查和审查时按路径识别数据去向，不能只按“观测”一词判断。

| 数据路径 | 范围 | 维护入口 |
|---|---|---|
| Telemetry | `packages/shared/src/telemetry/`；默认发往 Paperclip 端点、可 opt-out | [Telemetry 说明](../../packages/shared/src/telemetry/README.md)；修改需同步生成合同、README 与隐私审查 |
| OpenTelemetry Observability | `server/src/instrumentation.ts` 等；配置 operator OTLP endpoint 后启用 | [Observability](../../doc/observability.md)；无 endpoint 保持 no-op |
| 本地 run log | `heartbeat_run_events`；保留在实例数据库 | [运行日志事件](../../doc/run-log-events.md) |

二开 Langfuse 反馈导入的权限和内容边界另见其[只读合同](../../doc/mimouse/langfuse.md)。不能将它与上述三条路径互相替代。
