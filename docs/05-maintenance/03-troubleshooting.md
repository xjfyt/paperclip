# 故障排查与可复查问题报告

> **对应代码** — `scripts/dev-runner.ts`、`scripts/dev-service.ts`、`scripts/check-token-gates.mjs`、`scripts/run-vitest-stable.mjs`、`server/src/index.ts`、`tests/mimouse/playwright.config.ts`
> **维护提示** — 启动、构建、认证、测试夹具或常见固定错误及恢复入口变化时更新
> **最后验证** — 2026-10-30（对照源码和本机审计中的已复现问题；不是所有症状的复现报告）

## 一、先固定问题范围

先确认正在操作的实例、公司、提交、模式和实际端口。保存失败命令的退出码、时间、首个错误及完整脱敏日志，不只保留最后一行或助手概括。

```sh
node --version
pnpm --version
git rev-parse HEAD
git status --short
pnpm dev:list --data-dir ./tmp/paperclip-dev
```

数据目录参数必须匹配你实际启动的实例；不要把本页示例路径直接用于管理另一个实例。收集环境时只确认配置是否设置，不回显连接串、token、Cookie、主密钥或整份 `.env`。

## 二、启动、页面与登录

按现象区分服务可达、UI 资源和身份授权，避免把所有 401/403/空页都归因为数据库。

| 现象 | 先核对 | 下一步 |
|---|---|---|
| 3100 无法访问或出现别的服务 | 启动输出实际端口、`dev:list`、当前进程 owner | 用实际地址；确认受管实例后正常停止/重启，不盲 kill 同端口进程 |
| API 正常但没有 UI | `SERVE_UI`、middleware 开关、静态 UI 构建和反向代理路径 | 开发使用 `pnpm dev`；静态部署核对实际打包字节和资源响应 |
| `/api/companies` 返回 401 | 是否 authenticated、会话是否有效 | 正常登录后重试；健康接口成功不授予业务访问 |
| 403、主机不受信或回调不匹配 | public URL、允许主机、代理 Origin/协议、身份/公司权限 | 按[配置说明](../03-config/01-configuration.md)修正实际生效来源，不关闭认证绕过 |
| 新实例无管理员 | private/public 模式与 bootstrap 状态 | 按[管理员引导](../02-getting-started/03-deployment.md#三配置认证与管理员)认领或生成邀请 |
| Agent 不运行 | 暂停、审批、依赖、预算、适配器/凭据就绪、真实等待/恢复 action | 查看任务和运行的结构化状态；不要用后台 PID 或重复“继续”代替等待/恢复机制 |

认证的网络错误、真正退出、角色不足及未知状态不同。新会话、切公司或撤权后不能继续使用旧请求回执完成敏感动作；可复现时报告原目标和切换步骤，不复制会话材料。

## 三、依赖、构建与跨平台检查

保持首轮失败与修复后结果分开。Windows 问题需确认实际命令、行尾、路径与包 owner，不把 Git Bash 可用当作所有 Node/Windows 进程都兼容。

| 现象 | 核对与处理 |
|---|---|
| `ERR_PNPM_OUTDATED_LOCKFILE` | 比较当前提交清单与锁文件；先保留已有差异，仅在确认不同步后按[开发指引](../02-getting-started/01-development.md#一准备工具链)处理。网络/权限错误不采用该处理。 |
| Windows `mkdir -p`、`cp`、`chmod` 或 pnpm ENOENT | 确认使用含可移植构建 helper/当前 Vitest launcher 的本仓修订；新路径按 Node 文件 API 或现有 helper 实现，不把 shell 字符串改成不受控执行。 |
| Node ESM 不接受 `C:` URL | 动态导入需使用正确 file URL；报告调用方和原失败，不把磁盘路径与模块 URL 混用。 |
| token gate 白名单意外为 0 或生成资源只差 CRLF | 检查当前脚本及 `.gitattributes`；以工具正反例确认真实违规/内容漂移仍会失败，不增加白名单掩盖。 |
| Runner/catalog hash 不一致 | 核对受版本控制的行尾策略、源字节和输入；不要重写 manifest 摘要来掩盖不匹配。 |
| TypeScript/构建被资源限制终止 | 保留退出原因，降低并发并分包定位；只有完整所需命令实际完成才能记录通过。 |

当前修复和本机边界见[审计报告](../../doc/mimouse/checklists/2026-10-29-project-audit.md)。源码修复并不自动代表干净安装、其它 OS 或最终包已经验证。

## 四、一次性测试与数据库

测试拒绝真实配置、缺 marker、已有数据库或未知服务是隔离保护，不应删掉检查来使测试运行。

1. 使用全新绝对短路径 HOME 和指定 marker，先执行准备脚本；失败立即停止。
2. 检查 3100/54329 的真实 owner，确认未复用用户实例；一个测试 HOME 仅对应一套被测服务。
3. 浏览器缺失时安装受支持浏览器或设置 `PAPERCLIP_TEST_CHROMIUM`；APIRequestContext 无需浏览器但也不证明浏览器旅程。
4. 路径过长、POSIX mode、FIFO、进程组停止等平台差异分别记录；有理由跳过仍不算通过。
5. 退出后核对本轮 server/PG 是否仍在，按数据目录、marker、PID 和 owner 处理自己的残留；不删除未知 pid/lock，不广泛结束所有 Node/Postgres 进程。

本地 SSH env-lab 的 sshd 夹具需要 POSIX 进程身份及信号归属，原生 Windows 会在创建状态前明确拒绝，可在 Linux/WSL2 验证；这不禁用远程 SSH 客户端。独立 Daytona 插件在根工作区之外，需单独安装/类型检查；Windows 私密暂存 ACL、保留普通目录权限及拒绝已有宿主链接的边界见[插件说明](../../packages/plugins/sandbox-providers/daytona/README.md#native-windows-host-transfers)。有 platform skip 或只通过 mock 时，不写成真实供应商或最终安装包验收通过。

凭据或主密钥报 private permission/ACL 错误时，按[私密文件政策](../03-config/02-private-filesystem.md)检查精确路径：新空路径先建立 owner DACL 再写秘密，既有宽 ACL、链接和不可验证权限保持拒绝；SYSTEM/Administrators 属操作系统特权主体。探针使用固定系统 Windows PowerShell/.NET，无 profile 或模块依赖，探针不可用仍拒绝。不要自动修改旧目录权限或关闭校验。

Windows 的长期工作区服务、Runner 本地文件交付/入站附件和 Grok 订阅凭据读取有明确的拒绝边界，见[平台能力表](../04-modules/01-integration-boundaries.md#五原生-windows-的明确执行边界)。不要把换 shell、只检查路径或放松权限作为处理方式。

Agent 文件下载在 Windows 会先把已验证文件复制到操作系统临时目录下的新私密快照，再释放源句柄并流式传输，使编辑器仍能原子替换源文件。每个并发下载需要额外的临时磁盘空间，规模受该文件已检查大小约束；复制使用固定大小缓冲，不是整文件常驻内存。副本在流关闭或准备失败时清理；磁盘复制失败或身份变化会拒绝下载，流关闭后的清理失败另行记录警告，不能写成清理已完成。临时快照不是备份，不能手动清空仍由活动下载持有的目录。对应实现为 `server/src/services/agent-download-snapshot.ts`。

Runner 在无技能的执行中生成空、未封存的 skills 目录。Windows 清理该空目录时会核对目录/句柄身份并跳过无意义的目录 `fchmod`；非空树继续沿用封存和受控清理检查。这一兼容修复不意味着可以删除任意 skill home、改现有权限或宣称非空封存技能树已在 Windows 验收。对应实现为 `packages/paperclip-runner/src/drivers/runtime-context-materializer.ts`。

实际 Windows Playwright/PG 生命周期限制及受支持复验命令见[本机验证证据](../../doc/mimouse/checklists/2026-10-29-project-audit-verification.md)。当次环境结论不写成永久产品能力；新实现应另留当前证据。

## 五、外部动作未知与问题报告

通知、WorkBuddy、GitLab 写请求或业务动作发出后断线，不能仅据本地错误判断远端未执行。先按固定资源/job/request ID 查询或人工核对；未知状态不换 ID 盲重试。详见[集成边界](../04-modules/01-integration-boundaries.md)。

提交问题时提供以下最小脱敏信息：

- 完整提交与工作树差异范围、OS/架构和相关工具版本。
- 实例模式、公司/资源标识、时间与时区、最小重现步骤。
- 预期、实际状态、退出码或固定错误码；首轮失败和重跑分别说明。
- 可检查的脱敏日志/截图/回执引用，以及缺失证据与已确认副作用。

漏洞按 [SECURITY](../../SECURITY.md) 的披露方式处理。客户正文、秘密值和带 token 的 URL 不进入普通 issue 或仓库报告。
