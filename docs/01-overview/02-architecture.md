# 架构、执行路径与数据归属

> **对应代码** — `ui/src/App.tsx`、`server/src/app.ts`、`server/src/index.ts`、`server/src/services/heartbeat.ts`、`packages/shared/src/`、`packages/db/src/schema/`
> **维护提示** — 服务入口、授权、持久化、执行适配器或成果数据流变化时更新
> **最后验证** — 2026-10-29（对照源码入口与当前合同，非全链路执行证明）

## 一、运行组成

Paperclip 的主服务是 Node.js/Express 控制面，浏览器通过 React UI 操作公司范围资源。开发模式由 API 服务挂载 Vite middleware；静态模式加载构建后的 UI。CLI、外部 Agent 和浏览器使用相应 API 身份，不因本机运行而共享全部权限。

| 层 | 主要代码 | 职责与边界 |
|---|---|---|
| 用户界面 | `ui/src/App.tsx`、`ui/src/pages/`、`ui/src/api/` | 公司上下文、页面、表单与错误呈现；前端权限提示不能替代后端授权 |
| API 与启动 | `server/src/app.ts`、`server/src/index.ts` | 认证中间件、路由、HTTP/原生运行传输、启动恢复和关停 |
| 领域服务 | `server/src/services/` | 任务、心跳、审批、预算、恢复、连接器及二开服务 |
| 共享合同 | `packages/shared/src/` | 类型、枚举、校验与客户端/服务端共享语义 |
| 数据库 | `packages/db/src/schema/`、`packages/db/src/migrations/` | PostgreSQL 状态、事务、约束、索引与迁移 |
| 执行适配 | `packages/adapters/`、`external-adapters/`、`packages/paperclip-runner/` | 本地 CLI/进程、网关、HTTP、原生 runner 等执行后端；每种有独立就绪和停止合同 |
| 文件与成果 | `server/src/storage/`、工作区服务 | 上传字节、工作区文件与成果引用；数据库元数据不能替代文件本身 |

完整模块定位见[项目概览](01-introduction.md)。源码目录内保留上游模块，二开服务主要按 `mimouse-*` 命名；不要把整个 `server/` 都视为本轮二开范围。

## 二、一次任务的路径

任务的执行、对话、等待和交付具有不同状态，不能仅从某个进程或一段助手文字判断工作完成。

1. 用户在所选公司创建目标、项目或任务。API 验证当前身份、公司成员关系及资源可见性，写入公司范围数据和活动日志。
2. 任务指定一个 assignee。Agent 领取执行需满足原子 checkout、当前任务与祖先暂停、审批、依赖及预算等控制条件。
3. 心跳或原生执行链解析受授权的工作区、凭据引用和运行配置，交给适配器调用实际运行时。适配器的会话、取消、费用及错误归一化仍受其合同约束。
4. 运行过程持久化 run/events，并把评论、计划、文档、附件和工作成果关联回任务。原始供应商内容与用户正文不因 UI 切语被改写。
5. 执行结束后，控制面根据持久任务状态判定完成、等待、恢复或人工处理。进程退出、后台 PID 或一条“稍后继续”的评论不能单独建立可靠等待路径。
6. 操作者核对结果、变化、费用和可检查成果；需要的审批、发布或真实外部操作继续按各自授权执行。

精确状态与恢复不变量以[执行语义](../../doc/execution-semantics.md)和 [V1 实现合同](../../doc/SPEC-implementation.md)为准。新代码不得旁路已有预算硬停止、审批或原任务所有权。

## 三、持久数据与备份范围

默认本地数据库是 embedded PostgreSQL；设置外部数据库后仍使用同一逻辑模型。实例 home 不是所有数据的必然唯一位置，外部数据库、S3 和显式工作区可能在 home 之外。

| 数据 | 位置/载体 | 恢复要求 |
|---|---|---|
| 公司、任务、权限、运行、审计、二开台账 | PostgreSQL，默认实例 `db/` | 兼容版本的数据库备份及迁移历史 |
| 上传附件与成果字节 | `local_disk` 或 S3 | 对象/文件及对应数据库元数据一致 |
| 工作区和代码 | 本地/受管工作区或远端运行环境 | 源目录、未提交文件及 owner/权限信息另行保全 |
| 加密秘密 | 数据库密文 + 本地加密主密钥/所选 provider | 仅有数据库或仅有 key 均不足以恢复 |
| 登录与外部连接 | 会话、加密令牌、供应商授权 | 本地恢复不保证供应商 token 仍有效；必要时重新授权 |

恢复步骤见[备份、升级与回退](../05-maintenance/04-backup-upgrade.md)。数据库备份不是整机快照，不应通过复制正在使用的 PostgreSQL 数据目录来代替一致性备份。

## 四、二开与外部系统的边界

本仓新增身份、通知、反馈、编码、运营和评估等控制面能力。存在一个 API、按钮、manifest 或 C2 回执，并不表示实际供应商已执行成功。

稳定支持与缺口仍由[二开合同导航](../../doc/mimouse/README.md)和[剩余项](../../doc/mimouse/REMAINING.md)维护。本目录不另建第二张支持矩阵；具体准入、未知结果和凭据 owner 见[集成边界](../04-modules/01-integration-boundaries.md)。
