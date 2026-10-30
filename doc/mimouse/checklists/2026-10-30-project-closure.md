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
| 原生启动停止 | 启动期间 Stop 超时后晚到的执行句柄仍被取消，并沿用 `native_session_cancelled` 进入严格的持久停止记录校验，避免把有效 pending/ACK 停止覆盖成普通失败；公司、run、issue、scope、audit 与状态不匹配仍拒绝 |
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

本节记录各次检查的输入边界和实际结果。各行有重叠，不能相加作为不重复用例总数。

| 检查 | 当前结果 | 证据 |
|---|---|---|
| General server 首轮发现 | 已结束：962 文件，864 通过、88 失败、9 跳过，另有 1 个 worker 异常；19,410 项通过、540 失败、165 跳过，13 个未处理错误 | `general-server-final.log`，10,683.51 秒。该进程跨越本轮修复且缓存旧变换，作为完整失败清单保留；后续单文件复验与最终冻结分片分别记录，不能把首轮称作通过 |
| MiMouse 当前完整选集 | PASS：当前完整 78 文件，1,234 通过、0 失败、12 项既有跳过 | [私有测试生命周期证据](2026-10-30-mimouse-private-lifecycle-evidence.json)、[技能历史与应用证据](2026-10-30-mimouse-history-final-evidence.json)：237.37 秒，3,211 项声明输入无漂移，12 项跳过名单不变，0 框架告警及未处理错误；48 个已归属进程代际均退出。原 1,214/20/12 的超时串扰保留；本次 34 项私有测试全部通过，456 个断言及原用例期限保持，四组真实故障对照另列。 |
| 编译入口 API 与四语 Edge | PASS：159 通过，10 项 POSIX-only 跳过，0 失败 | [浏览器机器证据](2026-10-30-browser-closure-evidence.json)；不把 Windows 明确拒绝恢复算作支持整树恢复 |
| authenticated recovery | PASS：独立新库 4/4 | 同上；旧 CRLF 夹具复用失败保留，不能作为升级成功证据 |
| Dashboard / MDX / Mermaid | PASS：真实 Edge 3/3 | 同上，实际图表、编辑器草稿和 Mermaid SVG；不是只检查 bundle 文件存在 |
| UI 全量 | PASS：916 文件、12,946 项通过 | `test-results/project-closure-20261029/ui-final.log`；未把 jsdom 导航提示当作浏览器行为证据 |
| DB 全量 | PASS：52 文件、201 通过，5 项原平台条件跳过 | `test-results/project-closure-20261029/db-project-final.log`；DB typecheck 同时通过 |
| shared 全量 | PASS：当前 94 文件、997/997，0 跳过、0 框架告警及未处理错误 | `shared-complete-final.json`，48.95 秒；11,468 项声明输入仅本收口文档变化，源码、测试与用户锁无漂移。原空跳过集合不变，包含 Windows registry 新增 10 项；预期负向应用输出保留，不代表真实外部网络验收。 |
| CLI 全量 | PASS：当前第 6 轮 69 文件、550 通过、0 失败、12 项既有跳过 | `cli-complete-final6.json`，753.61 秒；2,582 项相关输入摘要前后相同，框架告警与未处理错误 0。12 项跳过与先前名单一致；旧 ACL 检查拒绝未复现，不声称确认其根因。 |
| Daytona | PASS：冻结依赖下 Vitest 4 与仓库 Vitest 5 均为 9 文件、399 通过，17 项 live / 平台条件跳过；独立 typecheck 通过 | `daytona-root-restored-final.log`；真实归档路径拒绝、私有 staging 和既有普通 workspace ACL 保持回归。只隔离本轮新增依赖入口，保留原有依赖与锁文件 |
| Hermes / OpenCode / Pi | PASS：21 文件、297 项通过 | 真实离线受控 CLI fixture；三个包 typecheck 通过 |
| Cursor / Gemini | PASS：12 文件、87 项通过 | `test-results/project-closure-20261029/cursor-gemini-final.log`；本机可执行入口与 POSIX provider fixture 分开 |
| Grok | PASS：12 文件、152 项通过 | `test-results/project-closure-20261029/grok-private-final2.log`；真实 NTFS ACL 与精确 rename 故障注入 |
| adapter-utils | PASS：当前完整 80 文件，1,725 通过、0 失败、51 项既有跳过，0 框架告警及未处理错误 | `adapter-complete-final10.json`：51 项跳过与 final6–9 精确名单一致；11,469 项输入仅文档变化，源码、测试和用户锁无漂移。原 final9 的 1,722/3、final8 的 GNU tar 字面排除失败与后续专项证据均保留。当前整包包含修复后的 materialization、settlement 与 tar 回归。 |
| Claude | PASS：23 文件、371 通过、1 项平台跳过；typecheck / build 通过 | `claude-complete-final.log`；宿主凭据隔离、真实离线 CLI 与 NTFS 故障注入 |
| Codex 整包 | PASS：34 文件、563 通过、0 失败、1 项原 Linux 进程组条件跳过；typecheck / build 通过 | [完整来源权限机器证据](2026-10-30-codex-final-evidence.json)；真实 Windows 宽 ACL 和符号链接拒绝均保留源字节与 ACL，且不执行探测。较早 555 / 559 项结果保留原输入，不重复相加 |
| GitHub launcher | PASS：47 通过、1 项原 Linux 条件跳过 | [独立机器证据](2026-10-30-windows-github-launcher-evidence.json) |
| 构建配置竞态 | PASS：53/53 | `test-results/project-audit-20261029/config-races-head-baseline.log`保留旧码 4 失败；当前新 5 项及原 48 项通过 |
| 私有测试锁顺序（历史输入） | 当轮 32/32；停止门禁同步后独立 routing case 两次通过，当前 34 项文件状态见 MiMouse 完整选集行 | [并发机器证据](2026-10-30-private-worker-lock-evidence.json)；旧码 transform 红基线真实 PG `40P01`，不回退工作树。保留首次 31/32 的停止拒绝，也保留后来 14/20 的超时串扰，不把早期通过冒充当前完整闭合 |
| 构建与类型 | PASS：全工作区类型检查与 `pnpm check:build-clean` 均退出 0，编译诊断 0；后续夹具扩展另验 | [静态与构建证据](2026-10-30-static-build-final-evidence.json)：35 个唯一包的 typecheck，完整构建严格扫描 warning/error；当轮 11,466 项输入仅文档索引变化，生产、测试及用户锁无漂移。之后服务端夹具 owner 扩展由 `private-owner-expanded-types.log` 的 server typecheck 及 `module-boundaries-after-private-owner.log` 补验，均退出 0；不把早期全工作区运行覆盖到后改测试字节。 |
| 文档 | PASS：15 个正式文档、235 个本地链接、0 问题；checker 7/7 | 新增中文异步夹具规则后重新通过；门禁有声明范围，不代表所有保留的上游文档都经过语义审查 |
| 工具门禁 | PASS：最终工具、文档、构建诊断和浏览器 fixture 生命周期共 46/46 | `test-results/project-closure-20261029/tooling-complete-final.log` |
| MiMouse OpenAPI | PASS：OpenAPI 24 项及原授权、编码列表回归共 69/69；server typecheck 通过 | `openapi-mimouse-final.log`；没有把未登记路由加入排除清单 |
| Workspace / AI connection / 外部聊天 | 当前 AI 完整 112/112；旧三个完整套件 330/330 的范围单独保留 | [连接夹具生命周期证据](2026-10-30-test-lifecycle-evidence.json)：AI 112 与 ToolAccess 422 合计 534/534，0 跳过，666.71 秒。修复先释放/等待原任务再恢复临时配置；旧 `ai-connections-complete-final2.json` 的 102/10 保留，其中 9 项期限失败及 1 项后继鉴权失败不被历史通过覆盖。 |
| 技能 / MCP / 内置 Agent | PASS：三个完整套件 191/191，技能路由独立 61/61 | `company-skills-mcp-builtins-final.log`；外部 DNS 分类使用确定性解析 fixture，不代表公共 DNS 在线验证 |
| 数据库备份 / 清理 spool | PASS：19/19，包含真实 PostgreSQL 备份恢复；环境运行时完整 162/162 | Windows 只兼容已知不支持的目录 flush，文件写入、文件 fsync、真实 I/O 错误仍严格失败 |
| Heartbeat 恢复 | PASS：398 通过、2 项原 POSIX 进程组条件跳过 | [恢复机器证据](2026-10-30-windows-server-recovery-evidence.json)；Windows 实际数字退出码不冒充 POSIX 信号 |
| 原生会话 / 恢复 | PASS：当前完整 689/689，0 失败、0 跳过、0 框架告警及未处理拒绝 | [原生停止与清理证据](2026-10-30-native-cancellation-closure-evidence.json)：2,919 项输入无漂移，211.24 秒，server typecheck 通过。真实启动停止旧码 6/6 红例、新码 6 项及 8 项无效 intent 拒绝均通过；原 readiness 和真实超时故障注入证明清理后后继通过。保留 general 的 54 项失败及中间完整 675/6，不声称已确认首次 readiness 失败的触发原因。 |
| Heartbeat 完成等待 | PASS：五个完整文件 74/74，0 跳过、0 框架告警及未处理错误 | [完成等待证据](2026-10-30-heartbeat-completion-evidence.json)：使用实际原任务 drain 后断言终态，原外层测试预算不变；429.25 秒，五个测试输入摘要不变。保留故意失败场景的 77 条应用 WARN；期间无关原生停止代码变化，不宣称全仓冻结。 |
| Agent 目录 / 下载 | PASS：完整目录套件 87/87；快照及 66 MiB 下载 10/10；空文件锁内关闭独立 1/1 | [下载证据](2026-10-30-windows-agent-download-evidence.json)、`agent-directory-complete-final3.json`；空文件旧码红基线保留 |
| Runner API / 大响应 | PASS：完整集成 29/29，响应捕获 13/13 | [Runner API 证据](2026-10-30-windows-runner-api-evidence.json)；实际 3 GiB 文件的分段读取，首字节前 DACL，私有响应旧码红基线 |
| 决策签名 / 启动 | PASS：安全 10、启动 36、真实 PG 决策 34，共 80/80 | [决策签名证据](2026-10-30-decision-signing-evidence.json)；框架告警 0，3 条故意拒绝授权的应用 WARN 保留 |
| 服务端 Claude / Codex | PASS：两个完整套件 55/55；隔离清理独立 2/2 | `server-adapter-execute-final3.json`、`isolated-fixture-lifecycle-final.log`；真实离线 PE fixture，不使用宿主凭据 |
| Workspace 分支 / 并发 | PASS：分支隔离 11/11、共享工作区并发 27/27 | [分支证据](2026-10-30-windows-branch-containment-evidence.json)、`heartbeat-workspace-busy-final.json` |
| 服务暴露平台合同 | PASS：18 项适用检查；30 项 POSIX / Linux 生命周期明确跳过 | 两套 exposure / reservation：新增 Windows 零副作用拒绝矩阵；27 项新标注不支持、3 项原 Linux 条件，不把跳过称作支持 |
| 聊天附件 / 插件目录 | PASS：两个完整套件 60/60 | `chat-plugins-final.json`；Windows 附件实际验证本地描述符拒绝、元数据与再利用授权，POSIX 字节 staging 成功路径未在本机执行 |
| issue 列表缓存 | PASS：完整 15/15 | `issue-list-complete-final.json`；固定 TTL 时钟仅用于验证容量的单项用例，生产 TTL / 容量不变 |
| Runner 真实重启 | PASS：两个连续完整回归均 15/15，0 跳过 | `native-restart-real-final2.json`；实际 runnerd 与受控原生 provider，核验进程代际后以持有句柄停止，未模拟 POSIX 进程组 |
| 技能可执行标志 / shell helper | PASS：技能库存与来源完整 87/87、helper 22/22 | `skills-portable-executable-final.json`、`paperclip-skill-utils-final.json`；真实 Git Bash/jq，Windows 可执行意图绑定版本字节，外部漂移不继承旧标志 |
| 云连接器身份 | PASS：完整 23/23，实际旧码 DACL 红基线保留 | [机器证据](2026-10-30-windows-cloud-enrollment-evidence.json)；新空路径先保护、旧宽 ACL 不修改、无真实 Cloud 请求 |
| 连接指令 / Claude 环境 / Gemini | PASS：完整三个文件 26/26 | `environment-instructions-frozen.json`；进程指令首字节前实际 DACL，保护失败不启动；离线假 CLI 不回退下载 |
| 插件自动构建 / OTel 夹具 | PASS：完整两个文件 30 通过、2 项既有条件跳过；pnpm 入口独立 5/5 | `instrumentation-plugin-final.json`、`pnpm-invocation-final.json`；真实本地插件路由构建，JS/原生 pnpm 入口保持 argv，无 batch shell 插值；OTel 只改夹具路径 |
| 托管仓库 / clone 凭据 | PASS：两个完整文件 33/33 | [机器证据](2026-10-30-managed-repositories-evidence.json)；真实 Git、PostgreSQL、并发发布与失败清理，保留实际长路径失败基线 |
| Worktree 初始化与运行时 | PASS：两个完整文件 149 通过、37 项 POSIX 长期服务明确跳过 | `workspace-runtime-complete-final.json`：runtime 147 通过、37 跳过，真实 seed 启动 2 通过；Windows 长期服务及 fallback 密钥迁移有实际首写拒绝证明。错误指导文案修改后另有 2 项补验，未重复计数 |
| Railway SSH | PASS：四个完整文件 44/44；server typecheck 通过 | `railway-windows-final2.json`；固定系统 OpenSSH、真实离线 keygen/ssh 参数与 NTFS DACL，不代表真实 Railway 远端命令已联调 |
| Cursor / Remote Pi controller | PASS：Cursor 完整 5/5；Pi Windows 拒绝 2/2，26 项 POSIX 生命周期明确跳过 | `cursor-execute-final3.json`、`remote-pi-controller-final.json`；沿用生产 macOS/Linux controller 合同，不新增平台支持声明 |
| Git 技能快照 / 缓存 | PASS：两个完整文件 31/31 | `skill-cache-git-final2.json`；Git Windows 使用自身支持的 `NUL` 配置空设备，真实 file URL、可执行 Git metadata 与缓存字节验证 |
| 文件扫描负载 / 工作区 / checkpoint | PASS：五个完整文件 36 通过、1 项原 Darwin 条件跳过 | `load-workspaces-catalog-final2.json`；500 个实际并发 HTTP 请求保留 498 次合并、2 次扫描与健康检查延迟断言，未降低负载 |
| IPC / Pi / 本地服务合同 | PASS：三个完整文件 16 通过、1 项明确 POSIX 进程组跳过 | `root-platform-ipc-pi-final.json`；真实 Windows named pipe、原生 Pi 子进程与隔离 home，长期服务实际验证首副作用前拒绝 |
| Gemini 环境 / 本地凭据合同 | PASS：两个完整文件 15/15 | `gemini-credential-final.json`；原生离线 CLI 诊断及 mock 凭据路径合同，不代表真实账号鉴权 |
| 构建资产 / 容器脚本合同 | PASS：两个完整文件 23/23 | `build-container-contracts-final2.json`；实际只读构建输出覆盖、无关文件保全；容器项是静态脚本合同，不冒充实际容器回收验证 |
| 无仓库隔离任务 | PASS：完整文件 14/14 | `isolated-task-directory-final.json`；两个模拟 provider 目录间真实归档、恢复及下一轮同步，任务和公司边界保持 |
| 原生工作区 Git 历史 | PASS：完整文件 5/5 | `native-sync-history-final.json`；真实 Git 历史与恢复，不把受控 provider 当作真实远端服务 |
| 空闲恢复目录判断 | PASS：完整文件 20/20 | [机器证据](2026-10-30-idle-directory-evidence.json)；真实 Windows 旧码失败：`file/child` 的 `ENOENT` 不再误判为无工作，两个检查入口保留不确定状态 |
| CLI 工作树密钥迁移 | PASS：完整两个文件 79/79，CLI typecheck 通过 | `worktree-key-complete-final2.json`；64 原工作树场景加 15 项真实 NTFS，完整新临时 key 才发布，同 key 保持旧 inode/ACL，异 key 与被替换的临时目录项拒绝 |
| 原生交付与聊天脚本 | PASS：交付 3、聊天工作区 6、issue helper 9，共 18/18，server typecheck 通过 | [机器证据](2026-10-30-windows-file-delivery-chat-helper-evidence.json)；真实 Unicode curl、jq、HTTP/2 与原始字节，Win 本地不可证明的文件路径保留拒绝 |
| Session 工作目录 | PASS：两个完整文件 10/10 | `session-cwd-workspaces-final.json`；POSIX 根路径按目标命名空间规范化，Windows 控制器不能因反斜线转换漏掉危险远端根目录 |
| 仅最小修复的锁图 | PASS：冻结、离线、lockfile-only 校验 | `test-results/project-closure-20261029/committed-lock-validation-fixed.log`；原锁加 3 行 importer，未使用用户其它锁图改动；不等于全新依赖安装 |
| 本地主密钥完整回归 | PASS：120/120、0 跳过、0 框架告警、0 未处理错误 | [机器证据](2026-10-30-local-master-key-evidence.json)；含真实 NTFS、六进程并发首写、已观察密钥消失拒绝。18 条故意拒绝的应用 WARN 保留 |
| 4 万路径同步压力 | PASS：完整 1/1，1,665.97 秒，0 框架告警 | [机器证据](2026-10-30-workspace-streaming-evidence.json)；各 lane 40,000 条、34,988,890 字节 NUL 清单、实际传输字节/排除/删除、命令大小与调度器收尾均通过。测试目录已正常清理，前五轮失败保留。 |
| General 当前分片 0 | 已结束：238 文件，233 通过、3 失败、2 跳过；3,548 项通过、1,184 失败、31 跳过 | `general-frozen-shard-0.log`，5,298.47 秒；聊天旧密钥夹具、browser-use 超时及 heartbeat 旧轮询失败保留。聊天新夹具完整运行仍有 253 项失败，见下行；browser-use 与 heartbeat 已有当前完整文件证明。 |
| General 当前分片 1 | 已结束，退出 1：244 个选中文件中 240 通过、1 失败、2 跳过，1 个外部终止文件未进入完整计数 | `general-frozen-shard-1.log`，4,393.33 秒；4,256 个选中用例中 3,783 通过、40 失败、65 跳过，368 项未进入完整计数，不能补记为跳过。两个错误为被终止 ToolAccess 的连接关闭和 worker 退出；Public MCP 已有当前完整 82/82 证明。 |
| General 当前分片 2 | 已结束：245 文件，232 通过、8 失败、5 跳过；4,188 项通过、51 失败、118 跳过 | `general-frozen-shard-2.log`，4,364.06 秒；包含旧密钥夹具、短轮询期限、数据库停止和只读 Git 缓存输入差异。逐文件复验前不能称整个分片通过。 |
| General 当前分片 3 | 已结束：244 文件，238 通过、6 失败；7,079 项通过、74 失败、28 跳过 | `general-frozen-shard-3.log`，5,527.62 秒；9 个原生会话未处理拒绝及延迟处理警告保留。原生执行器、heartbeat、MCP、Railway 与 AI 均已有当前完整文件证明。四个分片合计选择 971 个互不重叠文件，但执行跨越输入修改，不能声明最终冻结全仓通过。 |
| 非聊天密钥夹具 | PASS：19 文件，257 通过、0 失败、1 项原 Cloud 条件跳过 | [夹具证据](2026-10-30-secret-fixtures-evidence.json)：原 20 文件运行整体失败；这里只记录 18 个实际执行文件及 1 个条件文件。Registry 修改后的新进程 2/2 替换旧输入覆盖，不重复计数。Cloud 夹具路径只经过静态审阅，未运行真实 Cloud。 |
| 聊天完整复验 | FAIL：1,237 项中 984 通过、253 失败，原组另有 1 个未处理拒绝 | `secret-fixtures-complete-final.json`：199 项触发原 15 秒用例期限；其余 54 项为 45 项 webhook 完成观察、4 项发布观察、3 项 Discord 所有权、1 项冷启动及 1 项 Slack hydration。原日志和失败分类保留，正在修复生命周期与检查开销；不把诊断选例通过称作完整通过。 |
| Tool access 事务清理 | PASS：当前完整 422/422；历史外部终止仍单列，不能计为通过或平台跳过 | `ai-tool-owned-complete-final.json`；真实门控对照证明旧夹具在任务未结束时进入清理，修复后先释放门控并等待原任务，再恢复模拟和删除数据，后继通过。原 PG 长时间事务/阻塞链、归属核验及外部终止证据保留。 |
| Generic MCP 当前完整回归 | PASS：完整 76/76，0 失败、0 跳过 | `generic-mcp-owned-complete-final.json`，111.19 秒；保留并 join 原 callback，Windows 实际文件密钥路径使用独立有界等待，未改生产连接池或拒绝规则。旧 `generic-mcp-vault-final.json` 的 5 秒内部诊断期限失败保留，不等于证明生产死锁。MCP 及其 owner helper 输入未变，同期另外两个测试文件变化不冒称全仓冻结。 |
| 其它服务端失败复验 | PASS：五个完整文件 147/147，0 跳过、0 框架告警及未处理错误 | [完整复验证据](2026-10-30-remaining-server-evidence.json)：Public MCP 82、Browser Use 27、Fast Responses 25、Railway 5、AI legacy 8，360.11 秒，生产与测试输入无漂移。未改这五个文件的实现、断言或期限；旧超时和 Fast Responses 的状态断言失败保留，具体历史触发原因仍未知。 |
| Token 与模块边界 | PASS：最终两项命令均退出 0 | `final-static-build-gates-evidence.json`：token 扫描 1,379 文件、四门禁 CLEAN，palette/character 同步通过；模块边界及 Agent 生命周期扫描通过。既有 token allowlist 保留，不把它们描述为零例外。 |
| 其余最终检查 | INCONCLUSIVE：执行中 | 在完整结果产生后更新，不以历史通过补齐 |

当前官方发现选集为 general server 972 文件、serialized 166 文件。与分片执行前的源码清单相比，general 唯一新增为 `owned-case-work.test.ts`，已有独立完整 4/4 证明；serialized 文件名单不变。选集核对用于发现漏测，不等于这两个选集均已完整通过。

原始日志在本机被忽略的 `test-results/`，机器证据保留可比对的摘要；另一克隆未必有这些原始日志。本会话没有 Paperclip issue 上传上下文，未声称上传附件或创建远端 work product。

## 四、仍需独立闭合的范围

六目标 Runner/controller/签名准入、内部产物上传、真实业务读取和业务写入执行/对账仍按[联调交接清单](../contracts/integration-handoff.md)阻断。没有接口、信任根或业务授权时不制造伪成功实现。

Casdoor 租户、真实 Qoder/WorkBuddy 账号、通知送达、GitLab Runner、Langfuse/企微以及真实模型费用，仍需对应账号和环境的 C3/C4 回执。Windows/macOS/Linux × 两架构、中文/日文输入法、最终 all-dist 包和生产升级恢复没有被本机测试替代。

构建体积警告消除不代表首屏性能问题全部解决：当前初始脚本与 preload 约 12.25 MB、117 项，后续应通过路由按需加载及真实网络性能测量继续优化，不能把独立 Mermaid parser 的例外说成总体体积下降。

最新状态与后续动作由[剩余项](../REMAINING.md)统一导航。本记录不会覆盖原日期审计、首次失败、跳过或输入漂移记录。
