# GitLab 固定提交交付流程

入口：公司侧栏「编码交付」，或已绑定执行工作区的任务详情。此切片提供交付台账、GitLab API、明确确认的分支推送和草稿 MR、手动同步与默认关闭的自动 CI 轮询、固定 SHA 审阅门禁及本地产物清单。不是完整自动编码流水线，不自动合并或发布。

## 部署及边界

应用标准迁移 0336、0339、0340。公司秘密值为 JSON `{ "token": "..." }`，界面仅填写秘密 ID。`PAPERCLIP_GITLAB_ALLOWED_ORIGINS` 为逗号分隔的管理员允许源，必须精确匹配，不跟随携带令牌的重定向。支持 GitLab CE 基础 API；高级审批与合成合并流水线不假定存在，版本查询受限则显示 unknown。

默认不允许推送。确需由服务执行时，由操作者设置 `PAPERCLIP_GITLAB_PUBLISH_ENABLED=true`，并确认运行身份可访问指定仓库。工作分支默认仅 `paperclip/` 前缀，可用 `PAPERCLIP_GITLAB_WORK_BRANCH_PREFIXES` 明确调整；不得将默认分支或受保护分支作为源分支。每次 UI 操作再次确认固定 SHA，禁止 force、merge、tag。

推送前核对公司所属 active local_fs 工作区、任务关联、仓库 URL、干净工作树、当前分支/HEAD、base 到 head 祖先关系；推送后读取远端分支确认。未知结果进入 publish_indeterminate，不盲目重推。MR 创建先按源/目标查询，零或一个匹配才可继续，多匹配需人工处理；未知创建持久化为 mr_indeterminate，后续仅在查到已创建 MR 时对账，不自动重复创建。

## 验收与产物

门禁同时要求：审阅 SHA、MR SHA、成功 pipeline SHA、全部成功测试证据 SHA 等于 headSha。旧提交成功不能用于新提交。上游 MR 发生新提交会使已有审阅失效。同步只保存必要的 MR/pipeline 字段，不存完整供应商响应、用户资料或变量。readyForReleaseCandidate 只是当次观测，生产发布始终未授权；发布前需重新同步，不能把缓存当作最新远端状态。

测试证据当前由可信 board 提交，并非平台已自动执行，logRef 不能替代真实日志审阅。本地 fixture 确实执行失败测试、修复、再次测试与新 Git 提交，生成 SHA256 产物清单并校验符号链接不逃逸工作区；GitLab CI 回执为模拟。产物元数据包含平台、架构、签名状态，不把 unsigned 标为 signed。新增 `POST .../coding/:id/artifacts` 在服务端核对工作区 HEAD 并读取实际文件生成清单；接口收到的构建标签不等于构建证明，因此 testStatus=not_run、signatureStatus=unknown，不允许客户端直接宣称签名已验证。清单写入和 artifact_ready 通知同事务；不上传文件。

有限修复已复用现有例行任务服务接入默认关闭的调度器，见下节。跨平台 Runner 和产物服务上传仍未实现；本地夹具不代表生产全自动交付。

## 运维与验证

真实本地 HTTP/PostgreSQL 测试覆盖未知 MR 创建不重复、查到既有 MR 对账、固定 SHA 的 CI/审阅门禁及新 SHA 失效。远端 GitLab、生产凭据、真实 Runner、Windows/macOS/ARM 构建及签名未验收。公司权限与任务私有性在 API 入口检查；Agent 不能直接调用 board 管理写接口。

回退先关闭推送开关并暂停人工触发，保留迁移 0336、operationState 和远端对象用于对账，不能删除记录后重建同一个未知操作。

参考：[Merge requests API](https://docs.gitlab.com/api/merge_requests/)、[Pipelines API](https://docs.gitlab.com/api/pipelines/)、[Version API](https://docs.gitlab.com/api/version/)。

## 可恢复的只读轮询

PAPERCLIP_GITLAB_POLL_ENABLED 默认关闭。操作者明确启用后，worker 仅扫描 active 公司的 mr_created 交付，按持久 nextSyncAt 游标读原 MR 与固定 headSha 的 pipeline。每五秒最多处理一个到期项；正常六十秒间隔，失败五分钟退避；MR closed/merged 后停止自动轮询。没有创建 MR、推送、合并、打 tag 或修复派发副作用。

手动同步与 worker 共用九十秒 CAS 租约，所有分页共享三十秒外部读取截止时间。崩溃后过期租约可重领，因为这里只做供应商 GET；迟到结果不能覆盖新租约。写回时重新读取实际审阅/测试证据计算门禁。失败清空最新可信 MR/pipeline 证据并保留脱敏错误码，不把缓存绿色当成当前成功；权限/暂停在新一轮读取前检查。进程内计时器不是唯一游标。

真实隔离 PostgreSQL 夹具验证双 worker 互斥、重启游标、旧租约迟到、失败退避与暂停；供应商为注入夹具，真实 GitLab 仍需联调。只读轮询和修复派发是两个独立开关，开启轮询不会开启修复。

## 有限修复授权与调度

`PAPERCLIP_CODING_REPAIR_ENABLED` 默认 false。0340 保存修复策略和不可重置的尝试记录；公司与交付使用复合外键，不能跨公司挂接。

启用须由真实登录的公司负责人或管理员在编码交付界面明确确认；local_trusted 隐式身份不能授权后台修复。授权绑定当前 headSha、例行任务 ID/精确版本、负责用户及 Agent 配置摘要。修改版本、提交或 Agent 配置后旧授权不能继续派发。UI 选择模板后显示限制与确认项，不把勾选移交到新的模板版本。

必要条件：
- 公司和负责人仍有效，父任务及修复模板权限有效；模板 active、always_enqueue，并绑定相同父任务、项目和负责人。
- 原始隔离本地工作区启用，当前仓库干净且 HEAD 等于固定提交；不得退回任意共享目录。
- 本地适配器 Agent 就绪且空闲；项目启用硬预算与未知费用阻断，平台预算门禁同时生效。
- 最新失败 pipeline 和失败 job 回执必须属于同一项目、pipeline 和固定 SHA。仅 script_failure 可自动进入修复；环境故障等交给人工，不伪装代码错误。

单次授权允许 1–2 次尝试、1–60 分钟派发窗口及明确正整数费用上限（分）；同一不可延长的策略快照也用于初始修复运行及经持久链路核验的自动重试的受控到期停止。同一失败指纹、已用尝试、未知费用、预算耗尽、过期或授权撤销都会停止新派发。指纹使用提交、阶段、job 名称及失败原因，不因流水线生成新的 job ID 就重置。

worker 在数据库事务中预留尝试，调用现有 routineService.runPipelineStageEntryRoutine，并在例行任务事务锁内再次核验模板版本。子任务继承原隔离工作区和父任务私有边界。并发争抢不能产生两个相同 pipeline 的修复任务。

派发结果未知时只读对账 routineRuns，不重复发起；迟到结果必须通过状态和租约 CAS。子任务完成后进入等待固定 SHA 审阅状态，不会自动 push、merge、tag 或发布。暂停只阻止后续派发，不能声称取消已开始的模型调用。

重要限制：这不是严格墙钟、全任务树或远端供应商强制截止。费用检查是派发前及累计账目门禁，不能保证单次供应商调用不超出剩余额度。真实供应商任务、费用及时性和远端终止仍需 C3/C4 验收。

### 初始修复运行的受控到期停止（2026-10-26）

新派发在调用 heartbeat 前，把初始子任务、Agent、工作区及专用 wakeKey 写入 attempt.snapshot。初始 wake 禁止并入旧运行，后续消息也不能合流进该专用运行。期限检查只约束经公司、例行版本/回执、子任务归属及唯一 wake/run 交叉核验的**初始运行**（自动重试扩展见下节）；不会扫描取消整个 Agent、项目、后代任务或用户后来手动续跑。

到期后先持久化 elapsedObservedAt、确切 runId 与 stopRequestedAt，再调用既有 heartbeat.cancelRun。只有其执行取消 acknowledged 回执才记 local_stop_verified/stopVerifiedAt；单独的数据库 cancelled 不算停止证明。无 run 的排队项以精确 wake CAS 取消；skipped/failed 收敛为 queue_terminal，不冒充供应商停止。完成/失败本身用 execution_terminal 区分，remoteStopVerified 与 descendantsStopVerified 始终 false。GET repairs 返回这份有界 deadline 回执；不返回 dispatch 内部快照。

任务提前标 done/blocked/cancelled 不会让仍运行或取消未确认的初始运行退出监控。取消抛错保留 deadline_stopping、相同 runId 和原请求时间；重启只重试该确切运行，目标更换、任务转移或历史记录缺少绑定转 deadline_unverified/needs_human。持久租约避免竞争 worker 同时拥有停止流程；过期租约可恢复，迟到写回必须匹配原租约。

开关 false 与 task drain 只禁止新 reserve/dispatch，安全计时器仍对此前已授权的活动 attempt 对账/到期收敛；暖备及服务停止不执行扫描。默认关闭不会创建/唤醒任务。worker 五秒 tick、活动项三十秒复查，一轮只处理一个项，取消自身可能等待适配器；积压、暂停或故障都可能延迟，因此不承诺精确最大超时。重新启动后的未知进程所有权不靠旧 PID 强杀，也不把本地句柄终止当远端或脱离进程组后代已停止。下节补齐受支持的自动重试链；全任务树/其他控制器传播及可信远端停止仍属 CODE-05 缺口。


### 已核验自动重试的到期边界（2026-10-27）

到期范围扩展到 bounded retry 调度器和 missing-issue-comment 调度器持久创建的自动后继，而不是任意共享 marker 的运行。每条边必须回溯到上述初始例行派发：公司、Agent、任务、负责人及原工作区绑定一致；`retryOfRunId` 数据列、上下文和 wake payload 一致；wake/run 双向唯一、automation/system/null actor、重试原因和计划次数/时刻吻合。最多核验 64 个运行；未知边、循环或溢出不算全部已停，但不会阻止独立核验成功的目标受控停止。手动、其他 Agent、合流或伪造边不取得取消授权。

支持的重试在 issue→attempt 锁顺序下复查授权原截止时间、预计调度时间、尝试状态和原 Agent 配置哈希；等待其他锁/授权后、写 wake 前再检查期限。不会延长 expiresAt，也不允许工作区隔离重建改变已批准工作区。完成对账持同一 attempt 锁重新读整条已知执行链，因此“初始已终态但后继仍在运行”不能提前 completed；未知/转移任务保留监控并更新时间，避免饿死后续待处理项。到期认领先关闭自动重试准入，再收集目标。

新增多运行回执 `scope=verified_automatic_repair_retries`、`lineageComplete` 和 `runs[]`，每项含确切 run/wake/前驱 ID、请求时间及停止证据。单初始运行仍保留 `initial_repair_run_only`。停止前持久化整个目标集合，重启逐一核验同一集合，不换成“当前运行”；已确认项不重复停止，未知项只重试原身份。集合变化交人工。API 原样返回这份有界元数据；当前 UI 展示状态/诊断，不把该 scope 解读为全部后代或远端停止。

为避免另一自动通道丢弃授权上下文，专用修复不进入即时恢复、review participant、liveness continuation、成功交接和 review-path 自动唤醒。原授权只允许直接本地适配器；排队后改成 native profile 在 runtime selection 前以 configuration-incomplete 阻断，不创建 native 合同、coordinator 或新供应商工作。marker 在这些入口只能保守阻止新自动工作，不能授予取消权限。用户另行手动操作不被接管；已有外部/历史 native 执行、远端终止及整棵任务树不在本切片保证内。

验证：新增 lineage/篡改/合流/多级重试/未知停止重启/绝对截止与调度接线、无副作用 native/lifecycle 拒绝的定向单元测试；真实 PostgreSQL/API 夹具覆盖实际 scheduler 两级后继、early done、假边不取消、准确 stop roster、持有 issue 锁与完成/到期对账竞争。子任务仅运行无 DB 的定向套件；真实 DB/API、完整类型/构建和供应商验收由集成阶段分别记录，不把 mock 结果当成并发或供应商证明。

独立 `PAPERCLIP_CODING_REPAIR_WORKER_ENABLED=false` 可完全停用该后台计时器，默认不设置；这与“停止新派发”不同，会停止已有授权运行的自动到期收敛，不应在仍需受控截止时关闭。隔离 Playwright fixture 显式关闭该计时器及 `HEARTBEAT_SCHEDULER_ENABLED`，仅由注入替身手动调用 service/worker，避免真实后台抢租约或启动假运行。

本切片无需数据库迁移。512 MiB 单 worker 的 deadline/worker、实际临时 Git 失败修复和固定差异共四文件 62 项定向通过；其中 deadline 是 query-chain/纯函数及源码接线合同夹具，不是 PostgreSQL 并发证明。`tests/mimouse/coding-repair.spec.ts` 已补真实隔离 DB/API 的提前 done、关闭派发、未知取消重启、同 run 恢复及后续用户 run 不受影响用例；本切片未运行该 API 用例、完整类型/构建或真实供应商。

接口：
- POST `/api/companies/:companyId/coding/:deliveryId/repair-settings`：`enabled`、`confirm:true`、`headSha`；启用额外提供 `routineId`、`expectedRoutineRevisionId`、`maxAttempts`、`maxDurationMinutes`、`maxCostCents`。
- GET `/api/companies/:companyId/coding/:deliveryId/repairs`：读取脱敏策略、诊断与尝试记录。

10 项真实隔离 PostgreSQL 测试覆盖并发、实际例行子任务创建、工作区/私有继承、限制熔断、版本锁定、未知唤醒不重发、撤销/到期/环境错误/费用边界、两次 worker tick 去重及服务/数据库跨公司拒绝。唤醒为测试替身，未调用付费模型。

## 六项构建证据清单（只读、未接Runner）

GET `/api/companies/:companyId/coding/:id/build-matrix` 和交付列表的 `buildMatrix` 返回 Windows/macOS/Linux × x86_64/arm64 六个固定目标。沿用公司管理员、交付公司及任务隐私检查，未知/其他公司交付统一404；无权限请求在查询资源前403。

矩阵从当前交付和manifest实时推导，不接受调用方直接写一个成功矩阵。manifest的项目ID和commit必须匹配；格式错误/旧SHA/其他项目不展示为有效产物。多个同目标文件可以列出。只有本地SHA-256与字节数、文件名和声明的buildJob进入这一摘要，不复制本地路径或下载URL。

重要：当前本地产物平台/架构与job名称是声明，不证明Runner运行或目标架构。每个目标仍为blocked，区分manifest_missing、manifest_invalid、manifest_identity_mismatch、artifact_missing、runner_evidence_missing。客户端伪造testStatus、signatureStatus、uploaded、productionReleased或buildMatrix成功字段不能升级证据。上传固定blocked/upload_contract_missing；不发外部请求。旧的MR/CI候选门禁不是完整矩阵发布门禁。

本切片C2：服务端3文件30项通过；真实隔离数据库/API覆盖六目标、本地hash不升级、其他公司404、同公司第二项目错配拒绝、列表与详情一致。首次跨公司404断言发现既有load抛普通集成错误产生500，已在路由边界精准映射404，保留其他异常。第二次夹具误复用同issue/head触发原唯一约束，改成真实独立任务/项目/工作区，不修改约束。共享包标准构建通过；当时整套 server 类型/构建等待串行复验，此句仅为该切片历史记录。当前审计的完整类型与 UI 冻结结果见 PLAN-TRACEABILITY；新构建/API 仍须各自证据。

后续仍需实际Runner回执的可信采集/固定SHA绑定、目标工具链和签名验证、上传合同。UI 六目标缺口矩阵已经展示，不是后续未接线项。此接口是可用的证据缺口清单，不是已经完成六平台构建。

## 固定 SHA 代码差异审阅（P2）

编码交付的「审阅固定提交差异」读取实际本地 Git 对象，不再以通用确认按钮代替代码审阅。
`GET .../coding/:id/diff` 仅允许公司管理员并复核任务隐私；Agent、普通成员不可读取。
服务先核对交付公司、任务当前执行工作区及内部项目一致，再用只读 GitLab project 回执核对外部项目 ID、仓库 URL 和本地 origin。
同一 GitLab 实例的第二项目不能复用第一项目的源码审阅。

差异严格使用台账 `baseSha` → `headSha`；两个值必须是完整 commit SHA、base 是 head 祖先，当前工作区干净、分支及 HEAD 精确匹配。
不会 fetch、checkout、推送或执行 textconv/外部 diff，禁用 Git replacement/graft 对象、fsmonitor 及 clean/process filter 命令。补丁作为纯文本呈现。
最多 200 个文件及 512 KiB 命令输出；二进制或超限显示 incomplete 并拒绝确认；含子模块 gitlink 的工作区在 status 前拒绝并提示需外部审阅（避免执行嵌套仓库过滤器），不截断后宣称完整，也不提供跳过门禁按钮。

`POST .../coding/:id/review` 现在要求 `confirm:true`、完整 `baseSha`、`headSha` 和界面显示的 64 位 SHA-256 `digest`。
必须是真实登录的公司管理员；local_trusted 隐式身份不能确认审阅。
服务重新读取实际差异，并在数据库行锁内核对绑定快照后保存带审阅用户身份的 `review_receipt`。
摘要包含公司、交付、任务、工作区、GitLab 源及项目、分支、精确 base/head、实际补丁、测试证据与产物清单。
界面同时展示绑定的证据/清单；切换用户/公司、关闭重开、摘要变化或失败提交后不能沿用勾选。

升级新增 nullable `review_receipt`；历史只有 `reviewed_sha` 的记录继续可见，但门禁按未审阅处理，必须重新审阅。
新证据或产物清单写入清除审阅；即便数据库直接更改已有清单/项目/提交，门禁也因绑定不一致拒绝旧回执。
回执绑定的是已记录的产物 SHA-256 清单，不是持续监控磁盘文件；后续上传/发布必须重新核验实际字节，当前没有授权上传或发布。
MR/CI 同步不会把旧式 SHA 勾选升级为新回执，任何候选状态仍不代表六平台 Runner、签名或生产发布已验收。

定向验证：实际临时 Git 仓库 27 项单测、差异交互 8 项 jsdom 测试通过；涵盖跨项目、旧摘要/旧 SHA、脏目录、非祖先、二进制、体积/文件数限制、取消/重开及身份切换。
`tests/mimouse/coding-diff.spec.ts` 提供真实隔离数据库与 HTTP 路由测试，GitLab project 读取是注入夹具；旧快照已纳入后续 source/compiled API 回归，证据归属见 [VERIFICATION](VERIFICATION.md)，不能继续当作尚待接线，也不能转用为本切片或真实 GitLab 联调证明。

审阅回执与 activity 审计同事务写入，事务成功后才发布 activity 事件；审计失败不会留下已确认审阅。注册/产物/修复使用的 `verifyLocalCodingHead` 与差异检查复用只读 Git 防护，不改变显式授权 push 的凭据环境或 hooks。

只读检查必须设置 `GIT_NO_LAZY_FETCH=1`、`GIT_ALLOW_PROTOCOL=`（空协议白名单）和 `GIT_OPTIONAL_LOCKS=0`。
仅不显式调用 fetch 不足以保证本地读取：partial clone 的缺失对象会触发 promisor remote 下载，且 promisor 可以不是 origin。
本地 Git 2.52.0 夹具删除 base blob，配置第二 promisor remote 与仅写标记后退出的 SSH helper；对照检查确实触发 helper，受防护差异检查失败且不触发 helper、不补回对象、不访问网络。
此限制仅用于检查，不更改显式授权 push 的环境。实现依据：[Git 2.52.0 --no-lazy-fetch / GIT_NO_LAZY_FETCH](https://git-scm.com/docs/git/2.52.0#Documentation/git.txt---no-lazy-fetch)、[Git 2.52.0 GIT_ALLOW_PROTOCOL 与 GIT_OPTIONAL_LOCKS](https://git-scm.com/docs/git/2.52.0)、[Partial clone 缺失对象与多个 promisor remote](https://git-scm.com/docs/partial-clone)。

逐项原计划范围及手测见 [PLAN-TRACEABILITY](PLAN-TRACEABILITY.md) 的 V2-CODE-01–10/T07。六格 blocked 是正确失败关闭，不是可信构建/上传已经实现；缺代码和缺机器/合同分别记录。

## 编码目标模板（§8.1，计划文档）

编码页填写任务 ID 后可先「编写编码目标」，无需已有执行工作区；任务详情保留入口。
模板包含问题/价值、验收场景、允许修改仓库与相对路径、完整分支基点 SHA、原仓库测试命令、计划费用上限、最大修复轮数、产物要求、需要人审的动作。
费用以分记录，0 表示计划无付费额度；修复计划为 0–2 轮。模板不要求额外的总时限字段。

`GET/PUT /api/companies/:companyId/coding/tasks/:issueId/goal` 复用公司管理员边界并复查当前成员身份及任务隐私祖先。
PUT 使用 `goal` 和必填可空 `baseRevisionId`，保存为既有任务文档 `coding-goal` 的固定 v1 格式，复用版本历史和文档锁；无需迁移。
保存事务锁定任务/现有文档，复查权限，并将文档修订与只含 ID/版本的审计一起提交。
相同内容返回当前版本、不再追加修订；旧版本改不同内容返回冲突，不覆盖他人的编辑。
普通任务文档编辑若破坏结构，模板界面报错，不擅自重置正文。

只保存计划，不执行命令、不唤醒 Agent、不分配或提高预算、不启用修复、不创建交付/MR、不推送或发布。
允许路径不是新建的运行沙箱；金额与轮数不是已授权的修复策略。现有项目预算、工作区、修复显式授权及固定 SHA 证据门禁仍独立生效。
模板不会把 Agent 的「已完成」变成测试、Runner、签名或发布证据，也不替代后续方案拆解/独立审查。

界面按公司、用户、会话、身份重验代次及任务隔离草稿；切换路由/关闭后重新读取。
重复点击只提交一次；写回失败/冲突/不匹配回执均要求显式重读当前保存版本，不自动重发，也不把后来读到的版本冒认为原请求已成功。

新增 shared、service、jsdom 定向测试覆盖合同、权限复查、修订传递、元数据审计及中断/重复/晚到响应。
`tests/mimouse/coding-goal.spec.ts` 提供真实隔离 PostgreSQL/HTTP 的并发修订、撤销成员、私有祖先、文档锁、审计失败回滚和无唤醒验收；由集成阶段单独运行，单元 mock 不作为数据库或供应商证明。
完整「目标到交付」真实编码场景、实际允许仓库/测试命令与预算仍待 T07 验收；本节不表示原计划 V2-CODE-01 全部完成。

本子切片 C1：4 个定向文件 61 项通过（768 MiB、单 worker），shared 包及目标编辑器局部 TypeScript 检查通过，token gates/no-git-push/diff 检查通过。未执行 PostgreSQL/API、全库类型/构建或真实 GitLab/模型任务；运行时四语言总表由集成阶段统一合成。
