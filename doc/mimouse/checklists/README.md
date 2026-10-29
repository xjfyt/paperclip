# 验证收据与审计入口

> **维护提示** — 新增收据时保留执行输入、首轮失败、跳过和外部边界；后续输入变化另留新结果，不重写旧摘要。
> **最后验证** — 2026-10-30；核对本页入口及日期收据的明确本地文件/摘要对，不代表最终源码已完成全仓测试。

## 一、当前结论入口

- [2026-10-30 收口报告](2026-10-30-project-closure.md)：本轮本地修复、当前验证范围和仍未通过项，以报告记录的实际输入为准。
- [2026-10-29 首轮项目审计](2026-10-29-project-audit.md)及[首轮验证说明](2026-10-29-project-audit-verification.md)：保留起始发现与首次失败，不用后续通过覆盖历史观察。
- [验证规范](../../../docs/05-maintenance/01-verification.md)：C1–C4、结果状态与必填证据字段。

本目录的 CSV、JSON、截图及日期报告都是有范围的收据；不是当前 HEAD 的实时仪表盘。`test-results/` 下原始输出属于本地忽略产物，仓库只留脱敏摘要、文件名和摘要；迁移到其它环境时，应按项目产物合同保全必要原始证据。

## 二、2026-10-30 专项收据

| 收据 | 实际范围与边界 |
|---|---|
| [浏览器与生命周期](2026-10-30-browser-closure-evidence.json) | 原生 Windows、Edge、隔离 PostgreSQL；包含 MiMouse API/四语、authenticated recovery、静态 UI 及生命周期夹具。各项 passed/skip/flaky 分列，Qoder POSIX 支持边界仍保留；不是全部操作系统或最终安装包验收。 |
| [私有 worker 锁顺序](2026-10-30-private-worker-lock-evidence.json) | 真实可销毁 PostgreSQL 重现 `40P01`，修复后的锁顺序与实际停止门禁同步回归；保留首次全量失败和诊断重跑。不访问真实供应商或执行收费任务。 |
| [Windows GitHub launcher](2026-10-30-windows-github-launcher-evidence.json) | 真实本机 Git/PATHEXT、受控无网络 Node/EXE 夹具及 argv、token 剥离、篡改拒绝。Linux inotify 原有跳过单列；不是 GitHub 账号或网络验收。 |
| [Windows Codex 凭据](2026-10-30-windows-codex-credentials-evidence.json) | 真实 NTFS DACL 与新空暂存目录，合成凭据、复制/刷新/回写拒绝和保全回归；保留早期失败。不证明真实登录、刷新 grant 或远端执行可用。 |
| [Windows 服务恢复夹具](2026-10-30-windows-server-recovery-evidence.json) | Git/私密 HOME/实际 Node 退出及精确缓存容量回归。两个原有 POSIX 孤儿进程组用例仍跳过，不放宽 Windows 生产停止证明。 |
| [决策签名密钥与启动接线](2026-10-30-decision-signing-evidence.json) | 真实 NTFS 的首字节前保护、既有宽 ACL/链接拒绝及原字节/DACL 保全；原子发布赢家与临时路径碰撞；启动测试逐项正常关闭，真实 PG 决策流程另列。不证明其它秘密路径或非 Windows 实机验收。 |
| [adapter-utils 完整回归](2026-10-30-adapter-utils-complete-evidence.json) | final6 当轮冻结输入下 78 文件、1711 通过、51 条平台/供应商条件跳过；与早期 launcher 收据分开，不累加重叠数量。 |
| [adapter-utils final7](2026-10-30-adapter-utils-final7-evidence.json) | 后续包含 manifest 五项真实文件身份回归的 79 文件、1716 通过、51 条原平台/供应商条件跳过；保留 final6 收据，两个重叠全量结果不相加。 |
| [托管仓库与工作树](2026-10-30-managed-repositories-evidence.json) | 真实本机 Git、任务 anchor 内短路径 clone 与同卷提升；新仓库配置和清理边界，不修改全局 Git。 |
| [Native session 执行与恢复](2026-10-30-native-session-evidence.json) | 执行/恢复与空 runtime context 清理的专项输入；不把 descriptor 文件交付限制扩大成全部 Windows Runner 不可用。 |
| [Windows Agent 下载快照](2026-10-30-windows-agent-download-evidence.json) | 已验证文件的私密临时磁盘副本、源句柄释放与流清理边界；不是持久备份。 |
| [Windows 分支路径边界](2026-10-30-windows-branch-containment-evidence.json) | 分支与宿主路径的受控回归，拒绝不安全路径；不扩展跨平台任意路径支持承诺。 |
| [Windows callback 交付](2026-10-30-windows-callback-delivery-evidence.json) | callback 并发与完成交付的专项回归；按收据输入和原始首次失败核对。 |
| [Windows cloud enrollment](2026-10-30-windows-cloud-enrollment-evidence.json) | 本地受控 enrollment/协议夹具；不代表真实云账号、最终发布包或远端服务验收。 |
| [Windows Runner API](2026-10-30-windows-runner-api-evidence.json) | 本机 Runner/API 的限定回归；只证明收据实际执行的路径，不推断全部文件交付能力。 |
| [Windows Railway SSH](2026-10-30-windows-railway-ssh-evidence.json) | 原三份协议套件及真实 OpenSSH/NTFS 安全套件共 44 项；首字节前 DACL、固定工具、最小 OS 环境、旧 ACL/字节保全。没有真实 Railway 网络连接或密钥 enrollment。 |
| [Manifest 与 Native 文件边界](2026-10-30-manifest-native-evidence.json) | 已打开文件身份与读后命名项校验、真实链接/race 拒绝及对应本机边界；后续按路径再次打开数据库的风险不由该收据消除。 |
| [Idle 目录证明](2026-10-30-idle-directory-evidence.json) | Windows 的 `file/child` 返回 ENOENT 时仍检查最近实际父路径；真实缺失与非目录分别验证，保留旧失败记录。 |
| [默认加密主密钥](2026-10-30-local-master-key-evidence.json) | shared 私密主密钥 helper、server create/read/health、已有宽 ACL/链接拒绝、observed-key 消失不重建与 6 进程新目录/新 key 发布；4 完整文件 120/120。负向应用日志与框架诊断分列，早期失败保持可追溯。 |
| [Codex 包与 probe](2026-10-30-codex-final-evidence.json) | 本地适配器完整包、API key probe 的新空暂存保护，以及复制 auth/config 前的 source 权限验证；离线夹具不代表真实供应商登录或模型执行。 |
| [Clone、probe 与 board](2026-10-30-windows-clone-probe-board-evidence.json) | 实际本地 Git、受控独立程序和隔离 PG；凭据边界、权限与原 Darwin 条件单列，不代表远端仓库或账号验收。 |
| [文件交付与 issue helper](2026-10-30-windows-file-delivery-chat-helper-evidence.json) | Git Bash、真实 jq/Unicode curl、本机 HTTP 与精确文件字节；Windows descriptor 拒绝和零落地单列，不误称本机 FD 交付成功。 |
| [Windows Unicode tar](2026-10-30-windows-unicode-tar-evidence.json) | 原始 Unicode/NUL 成员、真实 GNU tar 及长路径/链接回归；后续排除规则与整包回归以收口报告为准，不能用此早期专项代替后来的失败结果。 |
| [CLI 既有 key 读取竞态](2026-10-30-windows-worktree-observed-key-evidence.json) | 已观察目标在打开前消失时拒绝重建，原字节/SDDL 保全；完整 NTFS 专项 16/16，名字过滤的 pending 不当作平台跳过。 |

## 三、摘要核对与后续输入

02:28 整理时核对了当时五份 JSON 内共 132 个明确的文件/摘要对：127 个与当前本地字节一致，5 个测试或测试 helper 已在收据之后修改；没有缺失文件，引用的日志和截图摘要均一致。随后新增的决策签名收据有独立冻结输入、日志和实测结果；不纳入前述历史统计。摘要核对只检查收据完整性，不重新执行用例，不把文件存在当作业务通过。

后续变化涉及 Codex 的 `codex-auth-cache.test.ts`、`codex-auth-copyback.test.ts`、`execute.test.ts`，以及 adapter-utils 的 `test-fixtures/native-cli.ts`、`test-fixtures/local-sandbox.ts`。对应旧收据仍证明其原输入下的观察，不能改写旧 hash 让它看似匹配当前输入；最终源码结论需引用冻结后相应检查及当前收口报告。新修复继续遵循相同规则。

03:29 再核对当时 16 份日期 JSON 共 258 个明确文件/摘要对：251 个与当时文件一致、1 个历史红基线按明确 `gitReference` 与对应 Git blob 一致、6 个在旧收据后变化，没有缺失文件。六项变化来自旧 Codex 凭据收据的上述三个测试及 `device-login-export.test.ts`，以及旧 launcher 收据的上述两个 fixture。历史红基线不与工作树混比；旧收据保持原样，最新完整 Codex、adapter-utils 等复验由收口报告分别引用。随后新增的收据各有独立输入；上述历史数字不代表它们的核对结果，也不把不同输入的测试拼成同一冻结全仓通过。

平台能力以[当前集成边界](../../../docs/04-modules/01-integration-boundaries.md#五原生-windows-的明确执行边界)为准：长期本地 workspace service、descriptor-confined 本地文件/入站暂存及 Grok 订阅凭据读取仍有明确的 Windows 拒绝边界。空技能目录清理、Agent 下载的私密临时磁盘快照与凭据 ACL 修复不提供全 Windows 支持证明。
