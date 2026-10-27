# P5：普通运行时提示词受控应用与回退边界

日期：2026-10-26

状态：**2026-10-27 已接通首期受控应用代码与无网络进程边界；专属真实数据库/完整运行验收仍在进行。2026-10-26 23:22 UTC 用户委托决定开发设计，不构成实际运行授权。** 本文说明持续改进闭环中尚未完成的发布环节，不启用模型、任务或自动发布。现有 UI 冻结边界不变。

## 2026-10-26 实现前基线与设计分析（历史）

以下至“方案依据与非通用部分”为实现前基线与原验收要求，不代表当前完成状态；当前路径及限制见末节。

### 已有能力与未完成项

现有能力包括不可变提示词 revision、人工 selection 及其回退、受限私有试验，以及固定数据集上的历史双 revision 比较。Selection 的 `runtimeApplied:false` 表示仅改变登记选择，不表示普通 Agent 已采用该正文。私有试验使用受限的 Claude bare/API-key、本地、fresh、无工具执行方式；它不是普通工具运行时的替代验证。

比较报告包含 revision、数据集、上下文和结果的摘要绑定，并阻断未知费用等不完整证据。它仍是只读历史比较，`completeContextCaptured:false`；`eligibleForHumanReview` 不是审批或发布授权。当前没有把该报告绑定到具体普通运行目标的持久化人工发布决定，也没有普通运行时应用、实际派发回执或对应回退闭环。成本路由仍不属于已完成能力。

## 为什么不能直接复制到现有配置

### 原文、模板和会话的语义不同

私有试验把 revision 当作 literal 文本。普通 Claude 的 `config.promptTemplate` 则是模板覆盖位：`{{path}}` 会从上下文取值，缺失值变为空串。普通 prompt 还会拼接 wake、task context、handoff 等内容；resume delta 或 recovery wake 分支可能完全跳过这个模板。因此，把原文复制到该配置既可能改变正文，又不能保证每次运行都会使用它。

指令文件是另一个注入位置，不等同于 run prompt。普通 Claude fresh 会话会追加指令文件，resume 则可能使用已有会话缓存；文件读取失败也存在警告后继续的路径。已有 managed instruction 编辑、授权及 consent 机制不能被新的 registry 应用入口绕过。

代码入口：

- `packages/adapter-utils/src/server-utils.ts`：`renderTemplate`、`resolvePathValue`。
- `packages/adapters/claude-local/src/server/execute.ts`：模板选择、`runAttempt`、resume prompt 和指令文件处理。
- `server/src/services/agent-instruction-revisions.ts`、`agent-instruction-authorization.ts`：指令文件及其独立授权边界。

### 普通日志和工具扩大了正文受众

Registry 正文读取限制为当前公司 owner/admin。普通 Claude 会把最终 prompt 放入 `onMeta`，普通 heartbeat 将其写入 `adapter.invoke`；运行日志按公司和具体 run 的读取权限开放，并不沿用 registry 正文的专属读取限制。

仅删除 `meta.prompt` 也不能保证正文私密：模型可能在输出、工具参数、任务评论或产物中复述内容。普通应用必须先明确接受该运行及其获准工具、日志和产物受众看到正文；不得沿用“私有试验”的名称暗示这些路径仍然私密。现有凭据脱敏不等于提示词保密。

代码入口：`execute.ts` 的 `onMeta`，`server/src/services/heartbeat.ts` 的 `onAdapterMeta`，以及 `server/src/routes/agents.ts` 的 heartbeat events/log 读取授权。

### 原始配置快照不足以约束实际执行

Heartbeat 在执行前还会合并 workspace、issue override、router 配置，并解析环境、项目和凭据。已有 session fingerprint 覆盖 effective config、指令元数据、环境、secret manifest、skills 等，能够辅助判断旧会话是否可复用，但不是发布审批合同；其输入也没有明确的 adapter 二进制/包版本绑定。

普通应用需要区分准备时配置、审批时配置和实际派发配置。配置、凭据版本、指令、adapter 或部署版本发生变化后，不能悄悄沿用旧批准。也不能仅清除一个 task session 就声称所有旧会话都已隔离。

代码入口：`server/src/services/heartbeat.ts` 的配置合并、`resolveExecutionRunAdapterConfig` 和 session freshness 路径；`server/src/services/heartbeat/workspaces.ts` 的 `buildEffectiveRunSessionConfigMetadata`。

### 现有回退并非普通提示词发布回退

Registry selection 已有幂等请求、head 行锁、expected-head CAS 和当前 head 回退约束，但未绑定具体 Agent、注入位置或审核报告。普通 Agent config rollback 则恢复历史整份配置；它不具备本方案需要的 expected-current 发布 CAS，直接复用可能覆盖用户后续修改。

未来回退应只撤回具体应用绑定，保留其他配置和 secrets，并拒绝过期回退。它只能影响后续符合条件的派发，不能撤销模型已经产生的外部副作用。

代码入口：`server/src/services/mimouse-prompt-registry/service.ts`、`server/src/services/agents.ts` 的 `rollbackConfigRevision`、`server/src/modules/agent-lifecycle/adapters/configuration.ts`。

## 本轮采用的最小开发合同

用户已委托选择技术方案，本轮按以下保守合同实现，**具体目标与真实应用仍由产品内人审确认，默认关闭**：

1. **单公司、单个明确指定 Agent。** 首期限定受支持的普通 Claude 本地运行组合，不做全局激活，不自动扩大到其他 adapter、远端或 native runtime。
2. **新建独立的原文追加位置。** 不覆盖现有 `promptTemplate`、bootstrap 或指令文件；revision 作为 literal supplemental section 拼接在普通 run prompt 的明确位置，保留正文内部字节，不解析其中的 `{{...}}`。这是新增 adapter 合同，不是现有模板位的别名，也不改变工具、访问控制、预算或审批权限。
3. **仅限批准后新建的任务及其首次 fresh 派发。** 不改变已有活动或排队任务，不向旧 session 注入；继续执行、恢复、重试和后续 wake 的行为必须在实现前明确，首期不将未定义的分支默认为已应用。
4. **明确普通运行可见性。** 审核界面/协议必须说明正文可进入普通运行及其获准工具、日志和产物受众；无法接受该披露时保持阻断，不以脱敏承诺替代。
5. **人审绑定具体提案。** 记录 source revision/hash、目标 Agent/slot、报告及证据摘要、前态、effective context、adapter/部署版本、可见性和会话策略。服务端验证报告，不信任客户端传入的“已通过”；bare 结果只能作参考，不得标为普通工具运行等价证明。
6. **不自动触发运行。** 准备、审批、应用绑定和实际派发分别留痕；应用配置不启动 wake、批量试验或成本路由。任何实际执行仍须满足原有授权和任务门禁。

本轮开发不再等待用户逐项选择技术细节。应用界面必须由操作者指定实际目标，核对固定版本、范围和普通运行披露边界；保存方案或本次开发委托不替代实际应用审批，也不授予模型调用、外发或费用授权。

## 实现前需落实的状态与并发约束

- 新增独立的 per-Agent 应用提案、不可变人审记录和应用/回退回执；不改变 registry selection 的现有含义。
- 提案绑定版本化摘要、过期时间、审核身份和幂等请求。应用时重新验证当前权限、报告证据、目标前态与环境/版本漂移。
- 应用与回退在事务中锁定目标并执行 expected-generation CAS；失败不得部分写入。回退只操作当前绑定，不恢复整份旧 Agent 配置。
- Dispatch 与应用采用一致的同步协议：仅在事务外检查“当前无 active run”不足以排除随后并发 claim。实际 run 固定记录应用 receipt/generation，不能晚绑定到更新后的 head。
- Binding generation 纳入会话隔离；显式 resume、旧排队 run、重试和恢复分支不得意外继承新绑定。
- 区分 `selected`、`configured`、`dispatched`；未派发不能宣称实际运行已应用。回退后历史回执仍保留。
- 迁移采用兼容式新增，默认关闭；现有 Agent 和任务保持原行为。审核摘要、错误和活动记录不保存正文或 secrets；需要保存的前态正文使用明确受控存储，而非普通审计字段。

## 未来验收点

以下是未来实现的验收要求，不代表本次已执行测试：

- Literal 中 `{{...}}` 保持原样；普通模板仍按原合同渲染；追加位置、分隔符和最终 prompt 可确定验证。
- Fresh、resume、recovery、retry、conversation 等分支逐项覆盖；未支持分支明确拒绝或明确不应用，不静默宣称成功。
- 跨公司/Agent、issue override、其他 adapter/native/remote 不能串用绑定；旧任务和旧 session 不受新绑定影响。
- 审核后的 config/env/secret version/instruction/adapter 漂移使旧批准失效；有效秘密不进入摘要响应或日志。
- 报告与 revision/dataset/证据对应；未知费用和缺失上下文不能被包装为普通发布质量证明。
- 并发 apply/rollback/dispatch、幂等重放、actor/digest 冲突、过期审批和 stale rollback 有确定结果；不覆盖后续用户配置。
- 权限撤销及时生效；审批不能由 Agent 自授；正文传播范围与批准的披露合同一致。
- 实际派发可追溯到准确 receipt/generation；回退只控制未来派发，不声称撤销历史工具副作用。

在上述合同实现和验证之前，普通运行时应用保持未实现/阻断状态，现有 `runtimeApplied:false` 与私有试验限制继续有效。

## 方案依据与非通用部分

2026-10-26核对官方资料：[Langfuse提示词版本控制](https://langfuse.com/docs/prompt-management/features/prompt-version-control)将不可变版本与部署标签分开，支持按精确版本获取、受保护标签和移动标签回退。本方案借鉴“版本与生效绑定分离”，但执行时固定已批准revision/hash，而不是每次追踪latest；单Agent范围、审批CAS和新任务隔离是本项目的保守约束，不宣称所有平台都采用相同规则。

[Claude Code CLI参考](https://code.claude.com/docs/en/cli-reference)区分恢复会话及提示词追加/替换选项。已有Paperclip适配器的模板、指令文件与resume路径不能被简单视为同一个追加位置；最终应以本仓适配器合同及实际版本测试为准，不只根据CLI帮助宣称已正确接线。选用独立literal追加位是为避免覆盖原模板、提升权限或改变正文中的占位字符，不表示它等价于系统提示词。

上线顺序：固定版本与目标提案 → 显式普通可见性和范围确认 → 原子绑定与回退 → 受支持的新任务派发回执。任何阶段证据不完整必须明确阻断，不把private bare比较视作普通带工具运行的完整验证。


## 首期已实现路径与精确回执语义（2026-10-27）

- 开关为 `PAPERCLIP_PROMPT_APPLICATIONS_ENABLED=true`；默认关闭。准备、审批、回退和查询都不发起 wake、不替换凭据、不改变已有工具或预算权限。适用范围是已配置 `claude_local` + 显式 `engine:cli` + 绝对 cwd + pinned company/local API-key 的单个 Agent；不是订阅账号自动转 API 计费入口。
- 支持新建、无 project、无覆写的普通任务首次 fresh 派发。拒绝 native、ACP、remote、conversation、managed router、非固定 secret、外部命令和认证路由冲突；旧 issue、旧排队 run、retry 和已有 session 不追加新正文。若有指令目录，只接受现有受控 managed root，并通过原指令读取授权、路径安全及总大小/深度边界读取摘要。
- 首期不支持本地 filesystem/network 安全包装器（包括有效 policy 新增的 wrapper），因为其实际可执行文件身份尚未纳入该合同；发现此配置只明确拒绝，绝不删除既有限制，也不建议关闭安全设置来获得支持。
- 工作目录策略为 `configured_cwd_with_managed_agent_home_v1`：控制平面只接受实例受控根下按 Agent 身份解析的 `agent_home` 元数据；Claude 既有规则在该场景优先使用已批准的固定配置 cwd。二者不是同一个目录；服务端绑定实例根和配置目录身份、验证真实路径无符号链接，adapter 最后报告实际 cwd 再校验并将其纳入 `effectiveContextHash`。不改既有 resolver 或隔离设置，不宣称逐任务目录隔离；不同任务可能共享固定 cwd 的文件状态，回退不清理历史文件或会话。
- 首次识别合格新任务时先持久化 server-owned candidate 事件，再进行可能拒绝的 overlay 校验；失败标记不可被回退 head 或 controller 重启抹去。受控失败不安排自动 retry，同 issue 的失败后继明确阻断，不能静默改成不带正文的普通运行；需另建符合条件的新任务。已成功旧任务后续不追加新正文。
- 提案绑定不可变 revision/hash、服务端重算的历史比较、target/部署实现摘要、expected generation；`approvalExpiresAt` 只限制待审批，不使已批准绑定定时失效。每次派发仍复核当前配置、凭据、环境、权限、任务/运行/controller 所有权。
- 普通 visibility 审批明确允许 revision 正文进入普通日志、输出、已授权工具和产物。私有 dataset/case/结果正文不会因应用被拼接；bare 比较仍 `completeContextCaptured:false` 且不是普通工具质量证明。最终原文独立追加，不经过 `renderTemplate`，不覆盖既有模板/文件。
- 配置 cutover 使用所有校验之后的数据库 `clock_timestamp()`，不用事务起始 `now()`；目标/代次和当前权限在接纳事务中锁定。锁先获得的撤权/配置变化会阻断；接纳已提交后发生的撤权不能被宣传为撤销已经在途的 provider 输入。
- `prepared` 只表示预检接纳；`start_requested` 是启动前持久栅栏；`dispatched` 只表示进程启动及严格持久回执，**不是 stdin 已写、provider 已消费或任务成功证明**。严格回执失败/同步异常/15 秒超时会关闭 stdin、终止本次本地进程并等待 close；默认普通与私有试验的历史非严格行为不改变。CLI 在等待 stdin 时仍可能有启动/hooks 副作用，不能称零副作用。
- 回退可随时 CAS 撤回当前未来绑定，只影响后续新任务，不改其它 Agent 配置，不取消旧 run/lease，不终止已接纳运行，也不撤销外部效果。若回退先于成功 spawn witness，持久记录 `prompt_application.binding_withdrawn_before_input` 事件（`stdinWritten:false`、`providerStopped:false`），查询派生 `inputDisposition:not_applied_before_input`，迟到 witness 因 head 代次不匹配被拒绝；这个证明不代表正文未进入普通日志、CLI 未启动或旧进程已停止。若 dispatched 先赢，历史状态保留、旧运行仍可继续。
- 未知启动的旧 issue 仍需要真实 provider-stop 证据才能恢复。不能因撤回绑定、缺 PID、换 controller 或迁移主机就声称停止；只在本 controller 的已记录 local 进程身份确实不存在时补充停止证据，否则保持明确阻断。
- 请求恢复使用同 requestId，元数据查询不重放。操作者可重新确认后显式重试同固定 payload；所有写入仍 CAS/摘要幂等。仅在同请求/目标锁后确认代次已永久前移或待审批已过期，返回 `not_applied_closed`；普通空查询、403/404/409/422 都不是未执行证明。

代码：`server/src/services/mimouse-prompt-applications/`、`server/src/routes/mimouse-prompt-applications.ts`、heartbeat 的预算后异步 preflight/同步最终所有权 gate，以及 Claude `controlled-prompt.ts` 和严格 spawn receipt。API 主路径为公司 `prompt-registry/:promptId/applications`，另有 per-Agent head、requestId 查询、审批、回退和派发回执查询。

验证状态：无网络 Node 边界和现有适配器/私有比较轻量回归已通过；真实 PostgreSQL fixture 将运行正式迁移、权限/CAS/回退以及 heartbeat→普通 Claude prompt→仅 Node 的受控替身。尚未对真实 Claude CLI、真实工具质量或模型计费作成功声明。
