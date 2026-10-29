# 项目文档导航

> **维护提示** — 新增文档、模块归属、启动入口或验证入口变化时更新
> **最后验证** — 2026-10-29（目录、链接及职责核对；不代表功能全量验收）

本页是当前二开项目的中文入口，采用 MiWork 的分层、编号、维护信息与证据分离方式。Paperclip 现有 `doc/` 合同和 `docs/` 英文文档继续作为对应主题的事实源；本页提供导航，不再复制一套实现合同。

## 一、最短阅读路径

| 角色与任务 | 阅读顺序 |
|---|---|
| 初次了解项目 | [仓库入口](../README.md) → [项目概览](01-overview/01-introduction.md) → [首次使用](02-getting-started/02-first-company.md) |
| 开发者 | [开发入门](02-getting-started/01-development.md) → [AGENTS](../AGENTS.md) → 触达模块合同 |
| 测试与交付 | [验证规范](05-maintenance/01-verification.md) → [剩余项](../doc/mimouse/REMAINING.md) → [用户验收](../doc/mimouse/USER-ACCEPTANCE.md) |
| 部署维护 | [部署选择](02-getting-started/03-deployment.md) → [配置](03-config/01-configuration.md) → [备份升级](05-maintenance/04-backup-upgrade.md) |
| 排障与集成 | [故障排查](05-maintenance/03-troubleshooting.md) → [集成边界](04-modules/01-integration-boundaries.md) → 对应功能合同 |
| 文档维护 | [编写规范](00-doc-rules.md) → [文档维护与验证](05-maintenance/02-documentation-validation.md) |

## 二、文档区域与职责

现有路径具有不同职责；历史记录不覆盖当前合同，英文站点导航也不代表二开功能已经发布。

| 区域 | 内容与维护边界 |
|---|---|
| [01-overview](01-overview/01-introduction.md) | 当前产品范围、模块归属、[架构与数据流](01-overview/02-architecture.md)、功能合同入口 |
| [02-getting-started](02-getting-started/01-development.md) | 当前源码的工具链、启动隔离、[首次使用](02-getting-started/02-first-company.md)与[部署](02-getting-started/03-deployment.md) |
| [03-config](03-config/01-configuration.md) | 配置来源、网络/身份、数据库、秘密、[私密文件权限](03-config/02-private-filesystem.md)和持久目录 |
| [04-modules](04-modules/01-integration-boundaries.md) | 外部集成 owner、授权、未知结果与合同缺口；详细实现回链单一功能合同 |
| [05-maintenance](05-maintenance/01-verification.md) | 验证分层、[文档维护](05-maintenance/02-documentation-validation.md)、[排障](05-maintenance/03-troubleshooting.md)、[备份升级](05-maintenance/04-backup-upgrade.md) |
| [doc/mimouse](../doc/mimouse/README.md) | 二开功能合同、原计划追踪、剩余项、用户验收和历次证据；稳定功能页与日期记录分别阅读 |
| [doc](../doc/DEVELOPING.md) | Paperclip 产品、开发、数据库、连接器和运行合同；V1 以 [SPEC-implementation](../doc/SPEC-implementation.md) 为准 |
| [feature-map](../feature-map/README.md) | 用户入口与可执行验证配方；覆盖记录不是 live 通过证明 |
| [doc/plans](../doc/plans/) | 按仓库约定保存的日期计划；新计划为 `YYYY-MM-DD-topic.md` |
| [releases](../releases/) | 版本化发行记录；旧版本事实不顺延到当前源码 |
| [docs/start](start/what-is-paperclip.md)、[docs/deploy](deploy/overview.md) | 保留的英文入门与部署文档；站点导航由 [docs.json](docs.json) 管理 |

## 三、常用合同

| 主题 | 当前入口 |
|---|---|
| 公司、任务、Agent 与执行语义 | [产品定义](../doc/PRODUCT.md)、[V1 合同](../doc/SPEC-implementation.md)、[执行语义](../doc/execution-semantics.md) |
| 认证、数据与秘密 | [部署模式](../doc/DEPLOYMENT-MODES.md)、[数据库](../doc/DATABASE.md)、[Casdoor](../doc/mimouse/casdoor.md) |
| 连接器与外部适配器 | [连接器 Playbook](../doc/connections/CONNECTOR-PLAYBOOK.md)、[适配器开发](../packages/adapters/AUTHORING.md)、[二开能力证据](../doc/mimouse/adapter-capabilities.md) |
| UI 与国际化 | [DESIGN](../DESIGN.md)、[四语覆盖](../doc/mimouse/i18n_remaining.md) |
| 通知与编码交付 | [通知](../doc/mimouse/notifications.md)、[编码](../doc/mimouse/coding.md) |
| 调研、运营与评估 | [调研](../doc/mimouse/research.md)、[运营](../doc/mimouse/operations.md)、[评估](../doc/mimouse/evaluation.md) |
| 工作成果 | [Agent 产物](../doc/AGENT-ARTIFACTS.md)、[反馈来源链](../doc/mimouse/FEEDBACK-EVALUATION-LINEAGE.md) |

## 四、如何判断“已完成”

先查看[剩余项](../doc/mimouse/REMAINING.md)定位代码缺口和环境前提，再按[验收步骤](../doc/mimouse/USER-ACCEPTANCE.md)执行，最后在[本轮审计](../doc/mimouse/checklists/2026-10-29-project-audit.md)及[历次验证记录](../doc/mimouse/VERIFICATION.md)核对明确的输入、时间和范围。历史测试总数、静态翻译键数、配置已保存或服务返回成功均不能单独证明业务闭环。

编号页覆盖本仓的产品/架构、首次使用、开发、部署、配置、集成、验证与维护路径。现有英文站点页面与 `doc/mimouse` 未整体迁移或逐页转换格式；后续按主题维护，保持单一合同并同步回链。详细方法见[文档维护与验证](05-maintenance/02-documentation-validation.md)。
