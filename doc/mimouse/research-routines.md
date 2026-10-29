# 定期调研：既有 Routine → 隔离报告 → 人工确认

本模块不新增 cron、抓取器、模型、凭据或派发器。复用现有 Routine 的时间计划、时区、触发器、分配、任务、heartbeat 生命周期和权限。系统验证的是**报告来自哪个已授权执行**，不是外部网页内容的真实性。

## 配置与运行

1. 公司 active owner/admin 使用真实 session，在调研页绑定已有 Routine 与适用产品；另要求现有 `tasks:assign` 权限。Agent、local_implicit、普通成员和失效成员不能修改绑定。
2. 也可点击“新建暂停的调研例行任务”：调用原有 Routine 创建接口，显式 `status: paused`，不创建触发器、不分配 Agent、不调用 run。描述中预置提交协议。绑定默认不接受报告；创建与绑定分别保存，如第二步失败，保留暂停的 Routine 并提示先检查列表，不能当作两步均成功。
3. 对已有 Routine，界面显示只读提交协议，管理员须明确加入原描述。绑定本身不覆盖用户描述、不改变计划、不唤醒执行。去原 Routine 页面配置执行人、schedule/timezone，确认描述和研究范围后再启用绑定与 Routine。
4. 原调度器到期创建任务及 run。已有 Agent 在被授权任务内检索，声明真实检索时间、引用与差距。它从当前任务读取 `originId` / `originRunId` / `id`，分别作为 routineId / routineRunId / issueId，在任务完成前提交结构化报告。
5. 报告只进入已有 research-candidates，固定 `agent_report` / `quarantined`；人工按已有 promote 流程确认范围、收益假设、验收条件和依赖后，才创建 private/backlog 开发待办，无自动执行分配。

## API

- `GET /api/companies/:companyId/research-routines`：管理员查看绑定与提交协议。
- `PUT /api/companies/:companyId/research-routines/:routineId`：`{ product, enabled }`；不执行 Routine。
- `POST /api/companies/:companyId/research-routines/:routineId/reports`：仅现有任务的 signed agent JWT；请求为 `routineRunId, issueId, title, product, currentState, proposedState, recommendation, sources`。
- 每条 source 必须包含 `url, retrievedAt, product, evidence, gap, suggestion`；URL 必须 HTTP(S)，检索时间必须带时区。所有 source 的 product 必须与绑定匹配。

不接受调用方提供的 companyId、agentId、heartbeat runId、requestId、provenance 或“独立验证”标志。服务器从鉴权 actor 与数据库生成 provenance；API-key 的 run header 不是已签名执行身份，不被接受。

## Fail-closed 身份与重试

报告事务锁定当前绑定、公司、Routine、routineRun、任务和 heartbeatRun。要求同公司；routineRun 的 linkedIssueId、任务 originKind/originId/originRunId、当前 assignee、当前 checkout/execution owner、JWT 的 agent/run 与 heartbeat 的 issue scope 全部吻合；还执行现有 `issue:mutate` ACL。仅接受 running heartbeat；终止后不能重放写入。不能解析明确 task/run 来源的旧 company-scope 执行不降级到猜测归属。

heartbeat UUID 用作服务端 requestId，一个执行只产生一个报告候选。并发同报告恢复同回执；更改正文、Routine 或 actor 返回 409，不替换旧证据。原始正文只留 SHA-256 摘要，来源文本和 URL 沿用脱敏；来源 gap/suggestion 也脱敏。`receivedAt` 来自候选创建时间，`reportBodyHash` 记录规范化报告请求摘要；完整 provenance 和脱敏正文纳入 evidenceHash。绑定更新时间属于原快照，后续相同配置保存不改写报告。

候选详情提供只读 provenance、Routine/任务链接、接收时间与摘要。链接仍经原对象读取权限控制。`manual_import` 与 `agent_report` 明确区分，两者都不是独立来源验证。本实现没有可声称 `independently_verified` 的抓取通道。

## 验证边界

纯函数测试覆盖跨公司、伪造 run header、错误 task/origin/assignee、终止 run、缺失来源字段、来源脱敏、哈希和手动导入不可伪造 provenance。`tests/mimouse/research-routines.spec.ts` 是待集成环境执行的数据库 fixture，不会运行调度器、适配器或模型。它直接插入 inert execution 行以验证事务、幂等与权限，不应宣称为真实外网研究成功。浏览器、数据库迁移与完整构建由集成验证统一执行。

## 公司公开来源限制（安全复核）

Agent 能读写私有任务，不等于它能把任务派生内容发布给所有公司管理员。本通道仅允许公司公开来源，**不支持私有调研报告向管理员收件箱自动降密**：报告与绑定均检查当前 Routine 的项目/父任务；报告再检查实际执行任务、结构祖先、privacy-parent 祖先和各节点项目。任何 private、非空 privacy-root、未知/缺失/跨公司节点、循环或过深祖先均拒绝；不因报告 Agent、绑定管理员是原所有者而放宽。

上述分类与真实 actor 的既有 privacy helper / access decision 同时成立才允许，并在事务中锁定读取行。没有虚构用户或匿名身份作为公开性证明，未调用 break-glass。绑定/可选 Routine 列表过滤不公开/不可读的关联边界，不借旧的公司 Routine 全量列表展示私有元数据。

新建仍保持 paused、无触发器、绑定 disabled；只有在原 Routine 页面配置明确公司公开的项目或父任务后才可启用报告。系统不会自动把任何私有任务或项目改为公开。收到的报告是接收当时的公开来源快照；操作者仍不得在公开任务报告中粘贴其他私有来源内容。

代码检查确认原 Routine 调度调用 issueService.create，未显式 visibility 时起始 open，随后继承私有 parent/project。新增 DB fixture 使用这个真实 issueService 路径验证上述默认/继承（backlog、无分配、无 wakeup），但不假装调用了真实调度/模型。

## 公司暂停时只读

真实 session 的 active owner/admin 在公司 active 或 paused 时仍可读取绑定和安全过滤后的可选 Routine，以检查暂停前的配置。缺失、归档公司以及普通成员、失效成员、其他公司或非 session 来源仍拒绝。绑定更新和报告接收继续要求公司 active；只读查询不会恢复公司、启用 Routine 或派发执行。来源隐私与权限边界不因公司暂停而放宽。

## 只读运行历史（2026-10-29）

`GET /api/companies/:companyId/research-routines/:routineId/history` 增量重建现有
`routine_runs`、issue-scope `heartbeat_runs` 与报告 provenance；未新增调度器、
attempt 表或数据库列。`limit` 为 1–20，默认 10；`beforeId` 必须是本公司、
本 Routine 当前仍可见的 UUID。隐藏、跨公司、删除的 cursor 均返回相同 404。

必须为真实未过期 session 的 active owner/admin（公司 active/paused 均可读）；
不接受 local_implicit，也不因 instance admin 绕过成员要求。每页重新检查 Routine
范围、历史源任务的完整公开祖先/项目边界与真实 actor 权限，并使用 canonical
heartbeat run 读取授权。历史源变为私有后，该行及 cursor 不再可见。

`received` 仅说明报告接收；执行可能仍失败。报告保持 quarantined/agent_report，
`externalSourcesVerified=false`、`agentDispatched=false`。关联身份不一致、丢失、
重复或每行超过 100 个 attempt/report 时显示 needs_review，不伪造成功。
coalesced 不借其他 routineRun 的报告充当本次回执。响应只含状态、时间、ID 和
摘要；不复制报告正文、触发载荷、错误文本或 runtime 输出。

单页采用 repeatable-read/read-only 事务，约 5 秒总 deadline（含连接等待），
statement_timeout 1500ms、lock_timeout 500ms，最多扫描 1000 行、关联读取预算
4096 行；预算耗尽返回 503，不返回 partial 或假空。cursor 比较在 PostgreSQL
原始 `created_at,id` 元组完成，避免 JS Date 丢失微秒。前后页不是全局快照；
新插入行可在返回最新页后看到。GET 不写数据库，不启动 Agent、外部检索或通知。

前端以公司/用户/session/Routine 隔离查询和游标，私有 GET 不使用 URL-only
in-flight 去重。身份切换会卸载旧界面并取消历史读取；旧创建结果不得继续绑定。
切语言仅更新四语文案，不重读或派发。报告链接只导航已有候选，不自动抓取来源。

验证文件：`history.integration.test.ts`（隔离真实 PostgreSQL 与 HTTP router）、
`history-budget.test.ts`、`ResearchRoutineHistory.test.tsx`、
`ResearchRoutinePanel.test.tsx` 和 `research-private.test.ts`。HTTP fixture 注入 actor
并在数据库验证 session/member，不冒充生产登录或真实联网调研。
