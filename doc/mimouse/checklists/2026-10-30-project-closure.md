# 项目完善与复核记录

> **对应代码** — 本批 Git 提交中的 server、ui、packages、cli、scripts 与 tests/mimouse
> **维护提示** — 本文记录一次有界验证；新输入需要新证据，不能覆盖历史失败或推断外部系统通过
> **最后验证** — 2026-10-30（Asia/Shanghai；本轮收口执行中）

## 一、范围与证据口径

本轮继续处理 [10 月 29 日审计](2026-10-29-project-audit.md)发现的问题，并检查此前已经标为完成的代码。初始基点是 `5ccd4ef014d1dc4101327985fde8cd6203b44dec`，所有执行都带本批工作树修改。日志中的旧 build stamp 不代表只测试了基点代码。

目标是代码、文档和可执行检查相互对应。零告警构建由 `pnpm check:build-clean`验证；故障注入用例中刻意触发的权限拒绝、预算阻断、数据库约束错误仍保留日志，不通过隐藏日志制造“零错误”。未执行、明确不支持的平台和真正失败分别记录，不能折算成通过。

## 二、实际修复

| 范围 | 修复与约束 |
|---|---|
| 私有提示词确认 | 创建 harness 前先锁公司；队列、提前绑定、claim、prepare、completion 统一公司→任务→intent 顺序，避免陈旧重复确认与 worker 反向取锁；真实 PostgreSQL 调度回归保留幂等、单任务和单次派发断言 |
| 私有测试取消 | Windows 子进程可能只返回数字退出码；通过 heartbeat 已持久化的取消状态，把已经派发但没有确认结果的失败 intent 收敛为 unknown，保留原 attempt fence 和停止证据，不重试或伪造 provider 终止回执 |
| 构建配置读取 | 同一文件描述符读取前后核对身份，最后重验目录项；设备号、inode、纳秒时间使用 BigInt，拒绝替换、同 inode 改写及精度损失 |
| Windows 资源与路径 | 构建复制使用 Node 文件 API；宿主原生路径与 sandbox POSIX 路径分别验证；worktree 配置目录为普通文件或链接到文件时拒绝回退 |
| Windows 凭据 | MCP、master key、Grok 和 Daytona 使用真实 NTFS DACL；新空路径保护后才写秘密，已有宽 ACL、链接或探针失败拒绝操作，不通过修改旧 ACL 让检查变绿 |
| GitHub 启动器 | 本机 Git/gh 发现使用原生 PATH 与可执行文件；受控入口验证目录、PATH 首项和脚本内容后通过 Node shell:false 调用，特殊参数、退出码、宿主 token 隔离和篡改拒绝都有真实子进程回归 |
| embedded PostgreSQL | Windows 用实际子进程、目录和端口校验归属，再使用同包 pg_ctl 正常退出；退出失败保留目录，不删除未知 PID 文件或停止其它实例 |
| 迁移字节 | 固定 SQL 的 LF 检出；旧 CRLF 回执与 canonical LF 源不一致时阻止自动迁移，不改部署摘要、不自动修账或重放历史 SQL |
| Rust 与 Vite | 修正条件编译、无用代码、配置和动态导入；MSVC 使用受支持的链接参数；不通过关闭 lint 或丢弃 stderr 消除警告 |
| UI 体积门禁 | 所有普通 chunk 超过 500,000 字节即失败；唯一精确版本、路径、源 SHA 绑定的 Mermaid parser 独立模块上限 750,000 字节。升级、混入其它模块或超限都会失败，不是对全部 bundle 放宽阈值 |
| 测试可靠性 | 修正系统语言依赖、React Query 固定延时、Windows ESM URL、PATH、脚本启动和文件换行；adapter-utils 明确只采集源码测试，避免重复执行旧 dist 副本 |
| 文档 | 按 MiWork 的编号、当前事实、维护字段和证据分层整理 15 个正式入口；补架构、首次使用、部署、配置、凭据权限、集成边界、故障排查、备份升级。保留上游归属及原有合同路径 |
| CI 与锁文件 | fork 自有 workflow 增加可移植工具/文档检查，以及冻结安装、类型、token 和零告警构建任务；远端尚未执行不写成 CI 已绿。锁文件只纳入缺失的 server workspace importer，其余用户原有修改保留 |
| 技能同步 | 保留 PostgreSQL 微秒时间戳做精确比较并交换，避免 JavaScript Date 的毫秒截断造成误拒绝；同一毫秒内的其它写入仍阻止覆盖 |
| MiMouse API 合同 | 19 个路由文件的 134 个操作纳入 OpenAPI；复用实际 Zod 请求校验，明确 session、管理员和 Agent run 的权限区别，未知响应 DTO 不伪造完整模型 |
| Windows 本地服务 | Shell 参数按 PowerShell、cmd、POSIX 分别构造；无法持有子进程完整所有权证据的长驻 workspace 服务在 provision/分配端口/启动前拒绝，不伪造停止成功 |

## 三、验证记录

本节在最终本地提交前填写冻结输入的结果。各行有重叠，不能相加作为不重复用例总数。

| 检查 | 当前结果 | 证据 |
|---|---|---|
| 编译入口 API 与四语 Edge | PASS：159 通过，10 项 POSIX-only 跳过，0 失败 | [浏览器机器证据](2026-10-30-browser-closure-evidence.json)；不把 Windows 明确拒绝恢复算作支持整树恢复 |
| authenticated recovery | PASS：独立新库 4/4 | 同上；旧 CRLF 夹具复用失败保留，不能作为升级成功证据 |
| Dashboard / MDX / Mermaid | PASS：真实 Edge 3/3 | 同上，实际图表、编辑器草稿和 Mermaid SVG；不是只检查 bundle 文件存在 |
| UI 全量 | PASS：916 文件、12,946 项通过 | `test-results/project-closure-20261029/ui-final.log`；未把 jsdom 导航提示当作浏览器行为证据 |
| DB 全量 | PASS：52 文件、201 通过，5 项原平台条件跳过 | `test-results/project-closure-20261029/db-project-final.log`；DB typecheck 同时通过 |
| CLI 全量 | PASS：67 文件、526 通过，12 项平台条件跳过 | `test-results/project-closure-20261029/cli-project-final.log`；NTFS 独立 18 通过、1 项 POSIX 跳过 |
| Daytona | PASS：冻结依赖下 Vitest 4 与仓库 Vitest 5 均为 9 文件、399 通过，17 项 live / 平台条件跳过；独立 typecheck 通过 | `daytona-root-restored-final.log`；真实归档路径拒绝、私有 staging 和既有普通 workspace ACL 保持回归。只隔离本轮新增依赖入口，保留原有依赖与锁文件 |
| Hermes / OpenCode / Pi | PASS：21 文件、297 项通过 | 真实离线受控 CLI fixture；三个包 typecheck 通过 |
| Cursor / Gemini | PASS：12 文件、87 项通过 | `test-results/project-closure-20261029/cursor-gemini-final.log`；本机可执行入口与 POSIX provider fixture 分开 |
| Grok | PASS：12 文件、152 项通过 | `test-results/project-closure-20261029/grok-private-final2.log`；真实 NTFS ACL 与精确 rename 故障注入 |
| adapter-utils | PASS：最新 readonly 修复后完整 77 文件、1,698 通过、51 项平台跳过 | `test-results/project-closure-20261029/adapter-complete-final3.log`；未把较早源码输入的第二次通过作为最终回执 |
| Claude | PASS：23 文件、371 通过、1 项平台跳过；typecheck / build 通过 | `claude-complete-final.log`；宿主凭据隔离、真实离线 CLI 与 NTFS 故障注入 |
| Codex 凭据 | PASS：最终各文件定向回执共 131 适用项，整包复验仍在执行 | [凭据机器证据](2026-10-30-windows-codex-credentials-evidence.json)；新 stage 继承已保护空根的 DACL，写入前验证真实私有权限，未通过放宽原测试预算过关 |
| GitHub launcher | PASS：47 通过、1 项原 Linux 条件跳过 | [独立机器证据](2026-10-30-windows-github-launcher-evidence.json) |
| 构建配置竞态 | PASS：53/53 | `test-results/project-audit-20261029/config-races-head-baseline.log`保留旧码 4 失败；当前新 5 项及原 48 项通过 |
| 私有测试生命周期 | PASS：完整 32/32；停止门禁同步后独立 routing case 两次通过 | [并发机器证据](2026-10-30-private-worker-lock-evidence.json)；旧码 transform 红基线真实 PG `40P01`，不回退工作树。保留首次 31/32 的停止拒绝，不把重跑通过冒充生产根因证明 |
| 构建与类型 | 本轮完整构建 PASS、0 诊断；完整类型检查 PASS，后续权限修复后复跑中 | `build-clean-frozen.log`、`typecheck-frozen.log`；不把仍在执行的最终输入写为已通过 |
| 文档 | PASS：15 个正式文档、230 个本地链接、0 问题；checker 7/7 | 门禁有声明范围，不代表所有保留的上游文档都经过语义审查 |
| 工具门禁 | PASS：最终工具、文档、构建诊断和浏览器 fixture 生命周期共 46/46 | `test-results/project-closure-20261029/tooling-complete-final.log` |
| MiMouse OpenAPI | PASS：OpenAPI 24 项及原授权、编码列表回归共 69/69；server typecheck 通过 | `openapi-mimouse-final.log`；没有把未登记路由加入排除清单 |
| Workspace / AI connection / 外部聊天 | PASS：三个完整套件共 330/330；独立 shell 参数 12/12 | `server-portability-complete-final.json`；Windows 本地受限文件描述符路径仍明确拒绝，远端文件路径使用真实授权读者与字节 |
| 技能 / MCP / 内置 Agent | PASS：三个完整套件 191/191，技能路由独立 61/61 | `company-skills-mcp-builtins-final.log`；外部 DNS 分类使用确定性解析 fixture，不代表公共 DNS 在线验证 |
| 数据库备份 / 清理 spool | PASS：19/19，包含真实 PostgreSQL 备份恢复；环境运行时完整 162/162 | Windows 只兼容已知不支持的目录 flush，文件写入、文件 fsync、真实 I/O 错误仍严格失败 |
| Heartbeat 恢复 | PASS：398 通过、2 项原 POSIX 进程组条件跳过 | [恢复机器证据](2026-10-30-windows-server-recovery-evidence.json)；Windows 实际数字退出码不冒充 POSIX 信号 |
| 仅最小修复的锁图 | PASS：冻结、离线、lockfile-only 校验 | `test-results/project-closure-20261029/committed-lock-validation-fixed.log`；原锁加 3 行 importer，未使用用户其它锁图改动；不等于全新依赖安装 |
| 其余最终检查 | INCONCLUSIVE：执行中 | 在完整结果产生后更新，不以历史通过补齐 |

原始日志在本机被忽略的 `test-results/`，机器证据保留可比对的摘要；另一克隆未必有这些原始日志。本会话没有 Paperclip issue 上传上下文，未声称上传附件或创建远端 work product。

## 四、仍需独立闭合的范围

六目标 Runner/controller/签名准入、内部产物上传、真实业务读取和业务写入执行/对账仍按[联调交接清单](../contracts/integration-handoff.md)阻断。没有接口、信任根或业务授权时不制造伪成功实现。

Casdoor 租户、真实 Qoder/WorkBuddy 账号、通知送达、GitLab Runner、Langfuse/企微以及真实模型费用，仍需对应账号和环境的 C3/C4 回执。Windows/macOS/Linux × 两架构、中文/日文输入法、最终 all-dist 包和生产升级恢复没有被本机测试替代。

构建体积警告消除不代表首屏性能问题全部解决：当前初始脚本与 preload 约 12.25 MB、117 项，后续应通过路由按需加载及真实网络性能测量继续优化，不能把独立 Mermaid parser 的例外说成总体体积下降。

最新状态与后续动作由[剩余项](../REMAINING.md)统一导航。本记录不会覆盖原日期审计、首次失败、跳过或输入漂移记录。
