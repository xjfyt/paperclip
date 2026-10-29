# Paperclip · MiMouse 二次开发

> **对应代码** — `server/`、`ui/`、`packages/`、`external-adapters/`
> **维护提示** — 产品范围、启动命令、工具链、文档入口或验收边界变化时更新
> **最后验证** — 2026-10-30（对照当前仓库；测试结果见独立验证记录）

本项目基于 [Paperclip](https://github.com/paperclipai/paperclip) 二次开发，保留多公司、Agent 组织、任务与审批、运行历史、预算及工作成果控制面，扩展咪鼠账号与工作流集成。

本仓库的二开能力和验证状态以本地文档为准。安装上游 npm 包、Docker 镜像或访问上游文档站，不代表运行了本仓库的二开代码。

## 一、从这里开始

| 目的 | 入口 |
|---|---|
| 了解本项目及模块归属 | [项目概览](docs/01-overview/01-introduction.md) |
| 安装、启动与开发 | [开发入门](docs/02-getting-started/01-development.md) |
| 初次创建公司、Agent 与任务 | [首次使用](docs/02-getting-started/02-first-company.md) |
| 部署、配置与数据保护 | [部署选择](docs/02-getting-started/03-deployment.md)、[配置](docs/03-config/01-configuration.md)、[备份升级](docs/05-maintenance/04-backup-upgrade.md) |
| 出现启动、登录、运行或集成故障 | [故障排查](docs/05-maintenance/03-troubleshooting.md)、[集成边界](docs/04-modules/01-integration-boundaries.md) |
| 找文档和维护规范 | [文档导航](docs/README.md)、[文档编写规范](docs/00-doc-rules.md) |
| 查二开功能配置和合同 | [MiMouse 功能导航](doc/mimouse/README.md) |
| 查尚未实现与尚未验收的事项 | [剩余项](doc/mimouse/REMAINING.md)、[用户验收步骤](doc/mimouse/USER-ACCEPTANCE.md) |
| 查一次检查的实际结果 | [最新完善与复核](doc/mimouse/checklists/2026-10-30-project-closure.md)、[历次验证记录](doc/mimouse/VERIFICATION.md) |
| 参与开发 | [AGENTS.md](AGENTS.md)、[贡献指南](CONTRIBUTING.md)、[UI 设计规范](DESIGN.md) |

## 二、启动当前源码

需要 Node.js **24.11.0 及以上**，开发大版本见 [.nvmrc](.nvmrc)；包管理器固定为 **pnpm 9.15.4**，见 [package.json](package.json)。

```sh
pnpm install --frozen-lockfile
pnpm dev --data-dir ./tmp/paperclip-dev
```

若首次冻结安装报告锁文件与清单不一致，先按[开发入门的锁文件说明](docs/02-getting-started/01-development.md#一准备工具链)处理。锁文件校验、全新依赖安装、源码运行与最终发行包是不同验证范围，实际证据见[最新复核](doc/mimouse/checklists/2026-10-30-project-closure.md)。

默认 API 与 UI 使用同一地址：`http://localhost:3100`；实际端口以启动输出为准。没有设置 `DATABASE_URL` 时使用 **embedded PostgreSQL**。`--data-dir` 为本次开发指定独立状态根目录；不要让两个服务共用同一数据库目录。已有配置或环境变量仍可能指定外部数据库，启动前按[开发入门](docs/02-getting-started/01-development.md)核对。

```sh
curl http://localhost:3100/api/health
pnpm dev:list --data-dir ./tmp/paperclip-dev
pnpm dev:stop --data-dir ./tmp/paperclip-dev
```

普通开发启动与一次性测试夹具是两种入口。执行 `tests/mimouse` 的检查需准备独立、带标记的可销毁目录，不能指向现有用户实例，详见[验证规范](docs/05-maintenance/01-verification.md)。

## 三、二开范围与状态

以下是功能入口导航，不是全部通过的验收声明。每个功能的实际支持范围、默认开关和限制以对应合同为准。

| 领域 | 当前机制与文档 |
|---|---|
| 四语界面 | 英文、简体中文、西班牙文、日文；[覆盖与剩余项](doc/mimouse/i18n_remaining.md)，真实布局与输入法另验 |
| Casdoor | [OIDC 登录与会话边界](doc/mimouse/casdoor.md) |
| Qoder / WorkBuddy | [Qoder 外部适配器](external-adapters/qoder-cn/README.md)、[WorkBuddy 合同](doc/mimouse/workbuddy.md) |
| 通知 | [通知策略、投递、核对与权限](doc/mimouse/notifications.md) |
| GitLab 编码交付 | [交付与构建证据](doc/mimouse/coding.md)；六目标构建、签名准入和上传仍有合同与实现缺口 |
| 反馈与评估 | [Langfuse 只读来源](doc/mimouse/langfuse.md)、[固定集评估](doc/mimouse/evaluation.md)、[反馈来源链](doc/mimouse/FEEDBACK-EVALUATION-LINEAGE.md) |
| 运营与调研 | [运营预演](doc/mimouse/operations.md)、[调研候选](doc/mimouse/research.md)、[例行接线](doc/mimouse/research-routines.md)；业务读写执行仍有缺口 |

当前仍有需要外部合同才能继续实现的路径，也有已有代码但缺少真实租户、浏览器、平台或最终发行包验证的路径。两者分别列在[剩余项](doc/mimouse/REMAINING.md)，不可仅凭单测数量或构建成功推断生产可用。

## 四、开发检查

先运行与改动对应的最小检查；普通默认测试为 Vitest：

```sh
pnpm test
```

PR-ready 交付或广泛改动需执行仓库要求的完整检查：

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

要求构建零告警时运行 `pnpm check:build-clean`；它完整调用既有 `pnpm build`，保留原始输出，并将构建诊断作为失败，不以退出 0 单独认定“零告警”。

UI 改动还需运行 `pnpm check:token-gates`，中文正式文档运行 `pnpm docs:check`。浏览器、真实供应商和最终安装包测试独立记录；未运行、受阻和跳过均不能计为通过。具体选择见[验证规范](docs/05-maintenance/01-verification.md)。安全问题按 [SECURITY.md](SECURITY.md) 的披露方式处理。

## 五、上游与许可证

本仓库保留 Paperclip 的 [MIT 许可证及版权声明](LICENSE)。上游项目、文档与社区：

- [Paperclip 源码](https://github.com/paperclipai/paperclip)
- [Paperclip 文档站](https://docs.paperclip.ing)
- [本仓保留的英文入门](docs/start/what-is-paperclip.md)
- [产品目标](doc/GOAL.md)、[产品定义](doc/PRODUCT.md)、[V1 实现合同](doc/SPEC-implementation.md)

二开采用的上游基线与原计划追踪见 [MiMouse 导航](doc/mimouse/README.md)及[逐项追踪表](doc/mimouse/PLAN-TRACEABILITY.md)。历史提交和历史通过记录只对各自注明的输入有效。
