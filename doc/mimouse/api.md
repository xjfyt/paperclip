# 二开接口导航

> 维护提示：新增或变更二开接口时同步运行时 Zod 校验、`server/src/routes/mimouse-openapi.ts` 与 OpenAPI 精确路由覆盖测试。本文为当前接口导航，历史测试收据不代表当前外部供应商已验收。
> 最后验证：2026-10-30；本地接口契约与认证边界复核，外部集成的真实验收状态仍以各专题证据为准。

以下均以已有 `/api` 为前缀，继续适用上游认证、CSRF、公司权限与错误中间件。UUID/固定 SHA/枚举由入口校验。不要把服务器秘密、令牌、Webhook 或原始供应商错误下发前端。

## 生成接口目录

运行中的 `GET /api/openapi.json` 包含本仓 19 个二开路由文件的实际操作，覆盖能力凭据、成本预览与运行路由、设置权限、认证撤销、通知、编码交付与构建观察、反馈来源、数据预览、研究、固定评估与受控恢复、私有提示词及应用、WorkBuddy。请求体优先复用处理器/服务使用的共享 Zod 实例；编码、通知与 WorkBuddy 的局部请求校验共用 `mimouse-api-schemas.ts`。

OpenAPI 的 `security` 区分 Board session、Board key 和有效 run-bound Agent JWT。`x-paperclip-authorization` 补充浏览器会话、实例管理员与执行归属限制；公司成员状态、任务隐私、审批、部署开关和固定版本等动态条件仍由服务端复核。JSON Schema 只表达结构，不能代替 Zod 跨字段校验或实际授权。尚无稳定响应校验器的结果保持未限定结构，不能据接口存在推断供应商已连接、实际执行成功或完整 Windows 支持。

回归入口：`pnpm exec vitest run --project @paperclipai/server server/src/__tests__/openapi-routes.test.ts`。覆盖检查展开已有 `root`/`path` 常量和固定历史循环，拒绝不能解析的新动态路径；新增路由不能通过加入排除名单完成登记。

## 认证

- GET `/instance/auth-capabilities`：匿名可读；仅返回 password 和 provider 展示能力。
- POST `/auth/sign-in/social`：Better Auth provider=casdoor，站内 callbackURL。
- GET `/auth/callback/casdoor`：库负责状态与 ID token 验证，外部身份不按同邮箱隐式合并。
- 显式关联与 sign-out 继续复用现有 Better Auth API，见 [Casdoor](casdoor.md)。

## 通知

根 `/companies/:companyId/notifications`，公司管理员/实例管理员；Agent 不可配置。

- GET 根：已接线/未接线事件、渠道、订阅、最近 100 条脱敏投递。
- POST `/endpoints`：kind、config、secretRef、secretVersion；只验证，创建为停用，不发送。
- PATCH `/endpoints/:id`：enabled、expectedVersion（旧客户端默认1）；版本冲突409。
- GET `/endpoints/:id/revisions`：最近100条非秘密配置历史、操作者及版本。
- POST `/endpoints/:id/revisions`：expectedVersion与完整name/kind/config/secretRef/secretVersion；kind不可改变，成功新增版本且暂停，不修改旧投递快照。
- GET `/endpoints/:id/verification`：no-store、精确配置版本/安全代次与最新测试/审批观察，不读取秘密值或发送探针。
- GET `/endpoints/:id/verification/evidence`：afterRevision分页、同endpoint人工凭据及全公司headRevision；未读全不可判当前通过。
- POST `/endpoints/:id/verification/evidence`：expectedRevision/configVersion/epoch、idempotencyKey、confirm=true与record/revoke/supersede；所有声明manual=true/machineVerified=false，引用/版本变化拒绝，审计同事务。详见通知验证手册。
- POST `/subscriptions`：endpointId、eventType、locale；同渠道同事件幂等更新。
- PATCH `/subscriptions/:id`：enabled，停用尚未进入 sending 的投递。
- POST `/endpoints/:id/test`：requestId、expectedVersion、confirm=true、title、text；同请求键入队一次，不同步声称已送达。

- GET `/deliveries/:id/reviews`：最近100条人工核对记录，不含秘密值。
- POST `/deliveries/:id/reviews`：requestId、confirm=true、outcome（accepted/not_accepted/unknown）、evidence、expectedState、expectedAttempt；只保存人工依据，传输结果不变，同键幂等。
- GET `/deliveries/:id/preview`：原目标、标题、正文、模板和凭据版本的脱敏快照；不返回 secret 引用或值。
- POST `/deliveries/:id/retry`：requestId、confirmReviewedOutcome=true、acceptDuplicateRisk=true；仅对未知/拒绝投递，原记录保持不变，原目标与凭据版本不变。同 requestId 幂等。

没有自动重放未知结果的 API。供应商受理不等于收件人已读。详见 [通知中心](notifications.md)。

## WorkBuddy

根 `/companies/:companyId/integrations/workbuddy`。

- GET 根：当前登录所有者的连接和最近任务，不含供应商凭据。
- POST `/authorize`、GET `/callback`：必须真实浏览器 session，发起和回调绑定同公司/用户/session。
- POST `/connections/:id/disconnect`：所有者断开本地连接；不假称远端任务已停止。
- POST `/connections/:id/agents`：所有者明确 confirm=true、agentIds，限制本公司；责任用户仍必须等于所有者。
- POST `/jobs`：connectionId、requestKey、prompt、confirmRemoteExecution=true。
- POST `/jobs/:id/refresh`：查询同一持久任务；不重新创建。
- POST `/jobs/:id/prompt`：requestKey、prompt、confirmRemoteExecution=true，明确的新一轮。

执行接口接受所有者或有效 Agent JWT/runId/责任用户授权，不接受裸 Agent ID。创建结果未知与远端待完成保持可区分。详见 [WorkBuddy](workbuddy.md)。

## 编码交付

根 `/companies/:companyId/coding`，公司管理员/实例管理员并检查任务隐私。

- GET 根：可读任务的交付记录和当次/缓存证据门禁，不能作为最新远端发布授权。
- POST 根：issueId、workspaceId、gitlabOrigin、projectId、secretRef、baseSha、headSha、targetBranch，核对实际干净工作区。
- POST `/:id/evidence`：headSha 与 checks；写入新证据清除旧审阅。
- POST `/:id/review`：headSha、confirm=true；不授予生产发布。
- POST `/:id/publish`：固定 SHA 确认且操作者允许推送，仅工作分支。
- POST `/:id/merge-request`：固定 SHA 确认；未知创建不盲目重复。
- POST `/:id/sync`：读取对应提交的 MR/CI，新 MR SHA 使审阅失效。
- POST `/:id/artifacts`：headSha、version、artifacts（相对 path/platform/arch/buildJob）；服务端实际哈希，只记 unknown 签名/not_run 测试，不上传。

具体 request schema 以运行时共用的 Zod 校验为权威；生成 OpenAPI 同步描述请求结构与会话边界，不代表 GitLab 实际发布或跨平台构建已验收。详见 [编码交付](coding.md)。

## 设置引导权限

GET `/companies/:companyId/setup-capabilities`：当前登录board的只读能力提示，现返回canCreateAgents。经现有公司边界和实际authorization service判定，响应private/no-store；不通过role名称猜测，不能作为后续修改请求的授权凭证。Dashboard在未知、刷新中、错误或明确拒绝时不自动打开Agent创建引导。

- `GET/POST /api/admin/users/:userId/auth-revocations`：实例管理员浏览器session专用，尊重instance.access托管限制。POST要求requestId、confirmUserId、reason，原子失效目标既有会话并撤销个人Board keys；同requestId只返回原回执，输入变化409。返回截止时间及数量，不返回秘密。此接口不是账号封禁，不修改成员关系、IdP、MCP/连接器凭据或运行任务；详见casdoor.md停用顺序。

## 公司反馈候选入站（人工导入底座）

- POST `/api/companies/:companyId/feedback-inbox`：公司管理员导入一条文本证据；body使用共享feedbackImportSchema。sourceKind为manual/application_log/langfuse/wecom_smart_bot，sourceInstance+externalId标识原始事件，title/text/product/softwareVersion/commitSha/traceId/occurredAt描述证据。sourceKind只是导入来源声明，所有记录固定manual_import，绝不据此声称真实连接器已连接。
- GET 同路径：limit 1–100（默认50）、可选beforeId，返回items和nextBeforeId；分页游标同样检查公司归属。
- GET `/:id`：脱敏候选详情；无效/其他公司ID404。
- GET `/:id/candidates`：同公司、规范化产品/版本/标题的最多20个候选与hasMore；autoMerged固定false，不修改原始事件、合并事实或执行模型。

幂等身份为company/sourceKind/sourceInstance/externalId；原始导入的内容摘要仅内部保存，重试相同内容返回原记录，改变内容409。并发由唯一索引仲裁，不能覆盖先前证据。只保存经过确定性脱敏的文本；已知凭据/邮箱/电话和URL用户信息、query/fragment被去除。规则不能保证检测任意形式秘密；导入方仍须预先审核，不在sourceInstance/externalId/traceId等标识字段放凭据或客户隐私。导入API及错误日志整段隐去请求体。

人工导入接口不抓取外部 URL、不下载附件、不回复客户、不自动建任务或派发 Agent。另有受控 [Langfuse 拉取](langfuse.md) 与企微长连接入站接口；配置、部署开关和实际连通验收分开管理，导入记录的 sourceKind 本身不能证明连接器已启用。外部文本是数据，绝不形成平台权限。该接口与上游 Paperclip 产品反馈导出无调用关系，不向其反馈站发送公司客户内容。下文的人审转任务需独立确认，仍不授予自动执行权限。

### 人工确认反馈转任务

POST `/api/companies/:companyId/feedback-inbox/:id/promote` 使用feedbackPromotionSchema：requestId、confirm:true、title、reproduction、expectedBehavior、fixProposal、acceptanceCriteria。只允许真实浏览器登录会话；实例管理员身份不能代替有效公司owner/admin成员资格，Agent、Board key、local_implicit不允许。服务在事务内再次核对公司和成员状态。

同一requestId相同确认返回原始回执；修改确认内容、改反馈/操作者或换requestId重复转同一反馈均409。数据库复合外键保持反馈/任务公司一致，任务创建和确认记录同事务。固定生成确认者负责的private/backlog任务，无Agent/用户指派；sourceTrust保持low_trust_review/quarantined，不因为人审建待办就授予执行权限。复现、预期、建议和验收标准再次脱敏；原导入内容放在不会被其反引号打断的文本围栏内。

回执记录initialStatus/initialVisibility及agentDispatched:false，是创建时的历史事实，不代替当前任务状态。当前不自动回复客户、派发Agent或直接修改代码。确认记录不可覆盖，引用任务的永久删除按上游引用冲突逻辑拒绝，可按现有任务流程归档；公司级永久清理需后续明确的保留/删除策略，不能删除确认记录后自动重建任务。

GET `/:id/promotion`：真实浏览器管理员读取确认状态，返回recorded及自己的receipt；已由其他人确认只返回recorded:true/receipt:null，不泄露他人的私有任务回执。界面刷新只GET，不重放POST；未知提交沿用冻结的requestId及原始确认内容重试。切换组织/用户/反馈后旧请求回执不会覆盖新页面。


## 反馈来源关联固定评估数据集

根 `/companies/:companyId/skill-evaluations`。

- POST `/datasets/feedback-preview`：真实session、active公司及当前active owner/admin；skillId、inputId、feedbackId、expected，返回精确输入/来源摘要及previewDigest，零写入、零执行。
- POST `/datasets` 的可选 case.feedback：feedbackId、previewDigest、reviewed=true。保留既有requestId幂等，事务复核实际成员和精确快照，变化409；关联只保存隔离来源引用，不复制反馈正文或解除权限。旧不带feedback的请求兼容原合同。
- GET `/datasets`/既有单条读取展示固定来源历史。旧数据集不回填来源、不重新计算哈希。详细限制见 [反馈来源链](FEEDBACK-EVALUATION-LINEAGE.md)。
