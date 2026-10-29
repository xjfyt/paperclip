# 验证收据与审计入口

> **维护提示** — 新增收据时保留执行输入、首轮失败、跳过和外部边界；后续输入变化另留新结果，不重写旧摘要。
> **最后验证** — 2026-10-30 02:28 +08:00；核对本页所列五份收据的本地文件及摘要，不代表最终源码已完成全仓测试。

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

## 三、摘要核对与后续输入

02:28 整理时核对了当时五份 JSON 内共 132 个明确的文件/摘要对：127 个与当前本地字节一致，5 个测试或测试 helper 已在收据之后修改；没有缺失文件，引用的日志和截图摘要均一致。随后新增的决策签名收据有独立冻结输入、日志和实测结果；不纳入前述历史统计。摘要核对只检查收据完整性，不重新执行用例，不把文件存在当作业务通过。

后续变化涉及 Codex 的 `codex-auth-cache.test.ts`、`codex-auth-copyback.test.ts`、`execute.test.ts`，以及 adapter-utils 的 `test-fixtures/native-cli.ts`、`test-fixtures/local-sandbox.ts`。对应旧收据仍证明其原输入下的观察，不能改写旧 hash 让它看似匹配当前输入；最终源码结论需引用冻结后相应检查及当前收口报告。新修复继续遵循相同规则。

平台能力以[当前集成边界](../../../docs/04-modules/01-integration-boundaries.md#五原生-windows-的明确执行边界)为准：长期本地 workspace service、descriptor-confined 本地文件/入站暂存及 Grok 订阅凭据读取仍有明确的 Windows 拒绝边界。空技能目录清理、Agent 下载的私密临时磁盘快照与凭据 ACL 修复不提供全 Windows 支持证明。
