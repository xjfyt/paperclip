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
