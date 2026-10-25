# 二开接口导航

以下均以已有 `/api` 为前缀，继续适用上游认证、CSRF、公司权限与错误中间件。UUID/固定 SHA/枚举由入口校验。不要把服务器秘密、令牌、Webhook 或原始供应商错误下发前端。

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
- POST `/subscriptions`：endpointId、eventType、locale；同渠道同事件幂等更新。
- PATCH `/subscriptions/:id`：enabled，停用尚未进入 sending 的投递。
- POST `/endpoints/:id/test`：requestId、expectedVersion、confirm=true、title、text；同请求键入队一次，不同步声称已送达。

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

具体 request schema 以 routes 源码为权威；未接入上游自动 OpenAPI 生成的条目不可冒充已在原接口目录发布。详见 [编码交付](coding.md)。
