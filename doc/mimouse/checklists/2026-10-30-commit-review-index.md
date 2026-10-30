# 本轮提交主题审阅索引

> **对应代码** — 基点 `5ccd4ef014d1dc4101327985fde8cd6203b44dec` 至 `e3bf0a327ea7ec9025b9964e470e755392b794c0` 的已提交差异
> **维护提示** — 本页按主题导航本轮改动；后续提交和验证结果另记，不把局部通过写成全仓完成
> **最后验证** — 2026-10-30（本地 Git 提交、最终差异和已有收据只读核对；本页未启动测试）

## 一、范围与阅读方式

该区间包含 **95 个提交、492 个变更文件**。以下合并为十类，列代表性本地提交与核心文件，帮助审阅行为和风险；不是逐提交发布说明，也不表示这些提交已推送或部署。区间之后的修改、尚未提交的状态更新及用户原有锁文件差异不由此索引覆盖。

先读[当前复核报告](2026-10-30-project-closure.md)判断实际验证状态，再按下列主题查看代码和对应收据。[收据索引](README.md)保留完整导航；同一文件的旧失败、故障注入、专项与完整回归不能相加。**截至本索引末端提交 `e3bf0a327` 的记录，chat 完整集成仍失败，166 文件 serialized 最终复验尚未完成**，不能据本页宣布全仓闭合。本页的通过、失败、未完成和平台边界均描述该区间末尾记录；后来是否闭合或变化以复核报告及新收据为准。

## 二、十个审阅主题

### 1. 中文文档入口与 MiWork 标准适配

将根入口收敛为当前二开导航，新增概览、架构、首次使用、开发、部署、配置、私密权限、集成与维护指引。采用 MiWork 的编号、维护元数据、当前事实和日期证据分离方式；保留 Paperclip 上游归属、V1 合同和既有文档路径，不移植 MiWork 的产品规则。历史“当前”“blocked”已注明旧 SHA/日期；外部四项合同仍需交接，模板不等于实现完成。

审阅：[根 README](../../../README.md)、[文档规范](../../../docs/00-doc-rules.md)、[中文导航](../../../docs/README.md)、[外部合同交接](../contracts/integration-handoff.md)。代表提交：`70260c0d7`、`295316c14`、`e79f986a4`。文档门禁仅覆盖声明的 **15 篇正式入口**，不是全量上游文档语义审计。

### 2. 可移植构建、静态门禁与 CI

构建资源复制改用 Node 文件 API；修复 Windows ESM、换行解析和 Rust 条件编译诊断。普通 UI chunk 维持 500,000 字节上限，唯一源摘要绑定的 Mermaid parser 独立模块采用 750,000 字节上限，不能把该例外解释为总体首屏体积已优化。新增零告警构建与有界文档检查，补模块/生命周期路径反例和 fork workflow；远端 workflow 未执行不算 CI 已绿。

审阅：[构建门禁](../../../scripts/check-clean-build.mjs)、[文档检查器](../../../scripts/check-project-docs.mjs)、[chunk 预算](../../../ui/src/lib/vite-chunk-budget.ts)、[fork workflow](../../../.github/workflows/mimouse-quality.yml)。代表提交：`5b77f3e10`、`f0677c821`、`0d71ecdb6`、`db4fef330`。证据：[最终静态与构建](2026-10-30-static-build-final-evidence.json)。

### 3. Windows 凭据与密钥的私密存储

以真实 NTFS DACL 代替 POSIX mode 推断；新空目录/文件先保护，随后才写首个秘密字节。master key 使用原子发布与并发胜者语义；已观察存在的 key 在读取中消失时拒绝，不自动换 AES 身份。已有宽 ACL、链接或不可验证路径保持原字节和权限并拒绝；CLI doctor/onboard、worktree seed 与服务端复用共享实现。签名密钥和适配器凭据各保留其身份与回写合同。

审阅：[权限 helper](../../../packages/shared/src/private-filesystem-permissions.ts)、[Windows master key](../../../packages/shared/src/private-windows-master-key.ts)、[本地加密 provider](../../../server/src/secrets/local-encrypted-provider.ts)、[签名密钥](../../../server/src/services/decision-signing.ts)、[CLI worktree](../../../cli/src/commands/worktree.ts)。代表提交：`bc960a114`、`889611aeb`、`c1667a254`、`ee152814d`。证据：[主密钥 120 项](2026-10-30-local-master-key-evidence.json)、[当前 CLI 完整包](2026-10-30-windows-cli-key-initialization-evidence.json)。升级要求见[私密文件政策](../../../docs/03-config/02-private-filesystem.md)，不能用自动修旧 ACL 或删 key 绕过。

### 4. 数据库退出、迁移历史与备份耐久性

embedded PostgreSQL 在 Windows 绑定实际子进程、数据目录和端口归属，再调用随包 `pg_ctl` 优雅退出；失败保留数据，不全局杀库或删除未知 PID 文件。迁移源固定 LF，精确识别旧 CRLF 回执时阻止自动重放，保全原 journal。备份和 spool 仅兼容平台明确不支持的目录 flush；文件 fsync、真实 I/O 错误及非法父路径仍拒绝。

审阅：[受控 PG loader](../../../packages/db/src/embedded-postgres-loader.ts)、[迁移入口](../../../packages/db/src/client.ts)、[备份](../../../server/src/services/idle-database-backup.ts)、[spool](../../../server/src/services/sandbox-orphan-cleanup-spool.ts)。代表提交：`10820cf92`、`60863c330`、`b897b1015`。证据：[空闲目录反例](2026-10-30-idle-directory-evidence.json)；升级操作边界见[备份升级](../../../docs/05-maintenance/04-backup-upgrade.md)。

### 5. Worktree、Git 与本机 provision

宿主原生路径与远端 POSIX 路径分别处理。嵌套 clone 使用任务 anchor 内短临时路径并同卷发布，`core.longpaths` 仅配置新仓库；不改全局 Git、不承诺任意长度。Git Bash provision 正确写出宿主 dotenv 路径；无安全共享 writer 的 Windows fallback 遇到秘密复制会首写前拒绝。端口注册锁保留文件身份和所有权证据，不将共享冲突当作锁已失效。

审阅：[heartbeat 工作区](../../../server/src/services/heartbeat/workspaces.ts)、[provision 脚本](../../../scripts/provision-worktree.sh)、[端口注册表](../../../packages/shared/src/worktree-port-registry.ts)、[技能 Git snapshot](../../../server/src/services/skill-source-git-snapshot.ts)。代表提交：`153d83bba`、`95b91a788`、`e5187d4d3`、`4e89dc344`。证据：[托管仓库](2026-10-30-managed-repositories-evidence.json)、[端口注册表](2026-10-30-windows-port-registry-evidence.json)。

### 6. 工作区归档、恢复与 Daytona

修复 Windows 特有成员名、链接目标和宿主路径验证；Daytona 在私密 staging 完成解包与校验后再安全安装，保留普通工作区既有 ACL。恢复保持只读文件最终 mode 与字节；manifest 在读取前后核对 bigint 文件身份。Windows 本机归档选择真实 GNU tar，保留 Unicode、长路径和字面排除规则；删除按受控批次执行，Git 物化使用明确执行预算。

审阅：[工作区传输](../../../packages/adapter-utils/src/sandbox-managed-runtime.ts)、[恢复合并](../../../packages/adapter-utils/src/workspace-restore-merge.ts)、[manifest](../../../packages/adapter-utils/src/workspace-manifest.ts)、[Daytona file sync](../../../packages/plugins/sandbox-providers/daytona/src/file-sync.ts)。代表提交：`3ee67daab`、`44b00d248`、`7feb4ff66`、`f3fb37d0d`。证据：[当前 shared/adapter 整包](2026-10-30-shared-adapter-final-evidence.json)、[四万路径压力](2026-10-30-workspace-streaming-evidence.json)。旧 tar 泄露、物化与压力超时保留；manifest 安全不代表后续按路径打开 SQLite 已获得全面 descriptor 保证。

### 7. Native runner 停止、响应与文件交付边界

启动期间 Stop 后晚到的句柄继续受取消与持久停止记录约束，不把有效 pending/ACK 覆盖为普通失败；错误 scope/audit 仍拒绝。大响应与下载使用私密暂存，callback publication 防止晚写与重复写。Windows 缺少可信 descriptor 路径证明的本地交付/入站 staging 继续拒绝，不能用 `realpath` 代替，也不能由此推断全部 Native runner 不支持 Windows；真实重启与当前完整 executor 有独立正例。

审阅：[native executor](../../../server/src/services/native-runtime/native-session-executor.ts)、[响应捕获](../../../server/src/services/native-runtime/runner-api-response.ts)、[callback bridge](../../../packages/adapter-utils/src/sandbox-callback-bridge.ts)、[下载 snapshot](../../../server/src/services/agent-download-snapshot.ts)。代表提交：`44a34faaa`、`71e830aef`、`525fd81f5`、`3e8c49664`。证据：[当前 executor 689 项](2026-10-30-native-cancellation-closure-evidence.json)、[Runner API](2026-10-30-windows-runner-api-evidence.json)、[下载](2026-10-30-windows-agent-download-evidence.json)。

### 8. MiMouse 锁、技能历史、审计与 OpenAPI

私有提示词工作流统一公司→任务→intent 锁顺序；Windows 取消后的 provider 未知结果保留为 unknown，不伪造停止或重试。技能同步保留微秒比较，Windows 可执行意图仅继承字节匹配版本；清理缺失来源时保留评估/恢复/私有测试历史，并在锁内复查。构建配置、来源证据与审计保存加严；19 个二开路由文件的 134 个操作登记真实 OpenAPI 请求和授权合同，不虚构响应模型。

审阅：[私有执行](../../../server/src/services/mimouse-private-prompt-tests/execution.ts)、[技能服务](../../../server/src/services/company-skills.ts)、[构建配置](../../../server/src/services/mimouse-coding/build-observation-config.ts)、[MiMouse OpenAPI](../../../server/src/routes/mimouse-openapi.ts)。代表提交：`77b0e339b`、`2689f0e0a`、`d98721c40`、`7d2da5be6`。证据：[锁顺序旧码红例](2026-10-30-private-worker-lock-evidence.json)、[当前历史与完整选集](2026-10-30-mimouse-history-final-evidence.json)、[private 生命周期](2026-10-30-mimouse-private-lifecycle-evidence.json)。

### 9. 适配器、启动参数与连接前提

本机 CLI 使用受控原生 EXE/JS 入口，保留 argv、PATH/PATHEXT、退出码及宿主 token 隔离；不执行拼接的 `.cmd` 字符串。Codex/Grok 凭据复制和探测首写前保护，已有来源宽 ACL/链接拒绝。Railway 使用固定系统 OpenSSH、私密临时文件和严格 host key 参数；工具缺失明确拒绝，不退回任意 PATH。离线 PE/JS fixture 不调用宿主 Agent 或真实供应商。

审阅：[GitHub launcher](../../../packages/adapter-utils/src/github-launcher.ts)、[执行目标](../../../packages/adapter-utils/src/execution-target.ts)、[Railway SSH](../../../server/src/services/railway-ssh.ts)、[Codex probe](../../../packages/adapters/codex-local/src/server/test.ts)。代表提交：`687bd0027`、`800eb8dc6`、`cc9db46bd`、`3ce943575`。证据：[GitHub](2026-10-30-windows-github-launcher-evidence.json)、[Railway](2026-10-30-windows-railway-ssh-evidence.json)、[Codex 当前整包](2026-10-30-codex-final-evidence.json)。真实账号、grant、网络连通和远端执行仍按各连接合同另验。

### 10. 测试夹具、异步收尾与浏览器证据

修正本机语言、CRLF、ESM URL、旧 dist 重复采集和固定短轮询；夹具明确隔离 HOME/账号/文件密钥。异步 owner 在原 body 首次 await 前登记任务，先释放 gate、join 原工作和 heartbeat drain，再恢复 mock/清库；超时本身不取消 body，收尾失败阻断下一 case。真实 Edge 四语、图表/编辑器/Mermaid 与 APIRequestContext 分开记录，jsdom/合成事件不充当 OS 输入法验收。

审阅：[异步清理规则](../../../doc/DEVELOPING.md#asynchronous-test-cleanup)、[owner helper](../../../server/src/__tests__/helpers/owned-case-work.ts)、[浏览器生命周期](../../../tests/mimouse/fixture-lifecycle.mjs)、[源码测试采集](../../../packages/adapter-utils/vitest.config.ts)。代表提交：`5221cb38d`、`c07836357`、`caf969858`、`e3bf0a327`。证据：[连接生命周期](2026-10-30-test-lifecycle-evidence.json)、[非 chat 秘密夹具](2026-10-30-secret-fixtures-evidence.json)、[真实浏览器](2026-10-30-browser-closure-evidence.json)。

## 三、如何解读验证结果

| 当轮已有证据 | 该轮可确认的范围 | 必须保留的限制 |
|---|---|---|
| [静态/构建](2026-10-30-static-build-final-evidence.json) | 该输入下类型、完整零告警构建及边界门禁退出 0 | 后续测试修改有独立补验；编译/框架诊断与预期应用负向日志分别计数 |
| [shared / adapter](2026-10-30-shared-adapter-final-evidence.json) | 两独立整包分别为 997 通过/0 跳过与 1725 通过/51 条原条件跳过 | 不跨轮次加总；跳过不是执行成功，不覆盖独立 server 压力或真实供应商 |
| [MiMouse 当轮完整选集](2026-10-30-mimouse-private-lifecycle-evidence.json) | 78 文件、1234 通过、12 条原条件跳过；声明的 3211 项输入运行中无漂移 | 原 1214/20/12 保留，不覆盖整个 general/serialized 或最终发行包 |
| [秘密夹具](2026-10-30-secret-fixtures-evidence.json) | 当轮 19 个非 chat 文件有 257 通过、1 条原 Cloud opt-in 跳过；registry 新鲜复验补足其输入覆盖 | 当轮原 20 文件退出 1：1241 通过、253 失败、1 跳过及 1 个真实未处理拒绝；不能改写为整组 PASS |
| [当前复核报告](2026-10-30-project-closure.md) | 汇总每次真实范围、来源与后续动作 | 原 general 和四个官方分片失败保留；分片 1 外部终止后的未计数项不能补成 skip。972/166 的 dry-run 清单仅证明选集发现完整性 |

本索引只核对已存在的提交、差异和收据，未执行新的类型、构建、浏览器或重测试。收据中的原始日志路径/摘要应按[证据规范](../../../docs/05-maintenance/01-verification.md)保全；文件存在不等于行为通过。

## 四、区间末尾未完成项与操作边界

以下均截至末端提交 `e3bf0a327` 的记录，不是未来 HEAD 的实时状态；后续闭合情况请回到[复核报告](2026-10-30-project-closure.md)。

1. **Chat 完整集成**：当轮 1237 项中 984 通过、253 失败；199 项为原 15 秒 deadline，50 项断言失败，4 项其它错误，另有真实 `CHAT_CREDENTIAL_LEASE_LOST` 未处理拒绝。独立 timing/选例不能替代完整复验；区间末尾生命周期和检查开销仍由 owner 诊断，不预判全部由负载或 ACL 引起。
2. **Serialized 最终 166 文件**：当轮清单与旧清单相同，区间末尾最终完整执行尚未完成。原失败和后续文件通过不得拼成原入口全绿；状态以后续[复核报告](2026-10-30-project-closure.md)为准。
3. **当轮原生 Windows 明确边界**：长期本地 workspace service 在启动/端口租约前拒绝；本地 descriptor-confined 文件工具、入站 staging 及 Grok 订阅凭据读取仍拒绝。远程 Pi 本地安装器、受管 CLI 安装和 SSH env-lab 各有平台前提；后续支持范围见[当前能力表](../../../docs/04-modules/01-integration-boundaries.md#五原生-windows-的明确执行边界)。拒绝回归通过不等于成功旅程支持。
4. **当轮外部合同与发布验收**：六目标 controller/签名准入、内部上传、真实业务读取和 apply/对账仍需明确合同；真实供应商、六平台最终发行包、实际输入法与生产升级恢复未由本机专项替代。旧宽 ACL 与 CRLF 迁移回执需保全原材料，禁止自动修账、删 key 或放宽 guard 取绿。

审阅时可用 `git diff 5ccd4ef014d1dc4101327985fde8cd6203b44dec e3bf0a327ea7ec9025b9964e470e755392b794c0 -- <文件>` 查看上述最终差异，以 `git show <代表提交>` 查看某次修改。它们是本地只读审阅入口，不是推送、安装或发布步骤。
