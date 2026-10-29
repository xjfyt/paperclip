# 外部集成、授权与未知结果边界

> **对应代码** — `server/src/services/mimouse-*`、`server/src/routes/`、`external-adapters/`、`packages/shared/src/`
> **维护提示** — 供应商、身份 owner、执行开关、未知回执、支持平台或外部合同变化时更新
> **最后验证** — 2026-10-30（对照功能合同、原生 Windows 拒绝边界和联调交接清单，不代表真实账号已通过）

## 一、接入顺序

先阅读功能合同，确认当前机制、owner、输入和执行权限，再接测试环境。公司隔离、秘密引用、审计、幂等及未知结果处理是实际执行的一部分，不能由一个启用开关替代。

1. 确认该功能已有实现，或先按[交接清单](../../doc/mimouse/contracts/integration-handoff.md)提供外部合同。
2. 固定测试租户、账号、公司、版本、允许目录/项目/收件目标和预算，秘密通过受控配置注入。
3. 安装或保存配置后先核对只读状态，再按明确确认执行连通、发送或真实任务。
4. 保存与公司/资源/配置版本绑定的回执；失败和未知分别处理，禁止无依据自动重放。
5. C2 受控协议、C3 实际连通和 C4 业务产物分开记录，方法见[验证规范](../05-maintenance/01-verification.md)。

## 二、已有集成的合同入口

下表定位边界与恢复要求，不复制完整接口或功能支持矩阵。

| 集成 | 身份与动作边界 | 遇到失败或未知 |
|---|---|---|
| [Casdoor](../../doc/mimouse/casdoor.md) | 人类登录；回调、账户关联和公司权限分别验证 | IdP 停用不自动等于既有实例 session/个人 key 撤销；按合同处理，保留管理员恢复通路 |
| [WorkBuddy](../../doc/mimouse/workbuddy.md) | 个人 OAuth、当前公司和责任用户、允许的 Agent；新 job/继续轮次需明确执行确认 | 刷新同一持久 job，不在创建未知时重新创建；本地断开不能假称远端停止 |
| [Qoder](../../external-adapters/qoder-cn/README.md) | 外部适配器 loader、实际 CLI、账号、工作区及平台停止证据 | 加载成功与运行完成分开；某平台未经 qualified 时不放宽停止条件伪成功 |
| [通知](../../doc/mimouse/notifications.md) | 管理配置、订阅、测试发送、投递和人工核对各自授权 | 固定目标/凭据/版本，未知结果先核对；供应商受理不等于收件人已读 |
| [GitLab 编码](../../doc/mimouse/coding.md) | 允许 origin、公司任务、项目、固定 SHA、审阅与工作分支 | CI/MR head 变化使旧审阅失效；未知写请求不盲重放；不默认 merge/tag/生产发布 |
| [Langfuse](../../doc/mimouse/langfuse.md) / 企微来源 | 只读来源或明确入站、脱敏、公司范围和来源幂等 | 来源声明不等于可信复现；原文是数据，不授予平台权限，不发送到上游反馈站 |
| [运营](../../doc/mimouse/operations.md) / [调研](../../doc/mimouse/research.md) | 人工快照、候选、预演与人审转任务；routine 运行身份另验 | 审批预演不授权业务写入；历史 received 不等于来源已验证或执行成功 |
| [评估](../../doc/mimouse/evaluation.md) / [恢复](../../doc/mimouse/evaluation-restore.md) | 固定数据集、版本、费用证据、受控本地提升及平台边界 | 文本代理不证明普通工具质量；目录提升/回滚以 readiness 和平台合同为准 |

外部包的源码位于本仓 `external-adapters/`，从实例“外部适配器”管理入口安装审核后的本地包；单独运行某包的 loader 测试不代表它已装入正在访问的实例。当前 UI 路由与二开页面见[首次使用](../02-getting-started/02-first-company.md)及[接口导航](../../doc/mimouse/api.md)。

## 三、仍需合同并继续实现的路径

已有 manifest、签名声明解析或 dry-run helper 不能代替执行器。四项缺口继续由[剩余项](../../doc/mimouse/REMAINING.md)维护：

| 路径 | 必须先明确的合同 |
|---|---|
| 六目标 Runner/controller、签名与准入 | 每目标的机器归属/版本/隔离、可信 controller、工作流闭包、SHA/job、签名公钥与验证/轮换 |
| 内部产物上传 | 测试 API、secret 引用、版本/提交/摘要/目标幂等、超时未知、冲突、查询与服务器确认 |
| 业务源读取 | 只读测试源、字段/主键/期间/时区、分页/增量/删除/迟到与脱敏样本 |
| 业务 apply、持久执行与对账 | 逐操作授权、审批绑定、持久幂等、重启恢复、查询、对账与补偿责任 |

交接清单只是待填模板，不是供应商已同意的合同。缺少可信 controller、签名规则、上传 API 或业务接口时保持明确 blocked/dry-run；不能发明端点、拿 Linux hash 代表六目标、把人工快照写成真实读取，或把批准预演当成真实记账授权。

## 四、排障与证据

先记录当前提交、公司/资源引用、配置修订、运行/job/投递 ID、时间、固定错误码与已知的请求阶段，再按对应合同查询。报告不含秘密值、原始客户正文或完整供应商错误响应。

固定 request ID 可帮助幂等，但同键重试仍须遵循原输入及动作语义；换 request ID 不是解决未知副作用的方法。外部调用被取消或本地进程退出后，应核对供应商是否仍在执行。

具体测试环境与未完成项以[用户验收](../../doc/mimouse/USER-ACCEPTANCE.md)、[审计报告](../../doc/mimouse/checklists/2026-10-29-project-audit.md)和[剩余项](../../doc/mimouse/REMAINING.md)为准。

## 五、原生 Windows 的明确执行边界

源码开发、CLI 命令、工作区任务和长期服务具有不同的生命周期与文件证明要求，不能据局部测试推断全部原生 Windows 能力可用。

| 路径 | 当前受限合同与后续入口 |
|---|---|
| 工作区长期 runtime service | 缺少可靠的进程代际与完整子树停止证明时，在启动、端口租约及 active provision 记录前返回 `422` / `workspace_runtime_service_platform_unsupported`。使用受支持的 POSIX 服务宿主验证生命周期；更换 shell 不提供停止证明。普通 CLI 与可等待退出的 workspace provision 按各自合同执行。 |
| Runner 本地文件交付、工作区文件工具与入站附件暂存 | 本地 reader 必须从已打开的 descriptor 证明文件仍受控；当前 Windows 分支无法提供该证明，保持 `descriptor_unverifiable` 拒绝，不降级为只检查 `realpath(candidate)`。此限制也适用于 bridge 的本地 workspace 读取、上传、写入与 skill 文件入口，以及入站附件 staging 与旧暂存字节 scrub；无法证明归属的残留保持原字节，不用粗暴删除代替清理证明。附件、产物、评论、收据和存储写入需在可信读取后才能发生。使用支持该证明的 POSIX 控制器，或单独授权并验证的既有 remote reader。 |
| Runner 的 Grok 本地订阅凭据读取 | 同样受本地 credential reader 的 descriptor 证明限制；Windows 控制器不能靠把执行目标标成 remote 绕过本地读取。使用受支持的控制器，或按公司授权显式选择 xAI API key 路径；不回落到宿主环境中的无关凭据。 |
| 本地 SSH env-lab 与受管 CLI 安装 | 分别见[测试排障](../05-maintenance/03-troubleshooting.md#四一次性测试与数据库)与[部署平台选择](../02-getting-started/03-deployment.md#一先选择部署形态)。平台跳过和早期拒绝不算相应用户旅程通过。 |
| 远程 Pi companion 的本地安装器 | 现有控制器合同只接受 macOS/Linux；原生 Windows 在创建缓存、读取发布内容或安装前拒绝。26 项 POSIX 生命周期用例在 Windows 明确跳过，另有 2 项真实 Windows 无落地拒绝回归；不代表 Windows 安装远程 Pi 已可用。 |

对应实现入口为 `server/src/services/workspace-runtime.ts`、`server/src/services/native-runtime/native-runner-file-handoff.ts`、`server/src/services/native-runtime/grok-runner-credentials.ts`。真实供应商、远端 controller 和最终发行包仍须按明确版本及授权目标验收；不因本机拒绝回归通过就宣布远端运行已成功。
