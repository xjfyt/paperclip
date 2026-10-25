# WorkBuddy 云任务集成

本实现使用官方 OAuth 和云任务/ACP 协议，不把 WorkBuddy 当作本地 CLI，不将远端任务结束等同于业务验收。入口为公司侧栏的 WorkBuddy；外部适配器在 `external-adapters/workbuddy`。

## 部署与授权

默认关闭。配置 `PAPERCLIP_WORKBUDDY_ENABLED=true`、`PAPERCLIP_WORKBUDDY_CLIENT_ID`、`PAPERCLIP_WORKBUDDY_CLIENT_SECRET` 和 `PAPERCLIP_AUTH_PUBLIC_BASE_URL`。生产必须 HTTPS。应用在供应商控制台登记 `/api/companies/<companyId>/integrations/workbuddy/callback`，取得官方应用审核和 scopes：`user.task.readable user.task.invokable`。不要把应用秘密放进 Agent 配置或仓库。

用户登录后自行连接。state 单次原子消费，绑定公司、用户、发起浏览器会话，10 分钟过期；刷新令牌使用数据库 CAS 锁，结果未知停止自动刷新并要求重新授权。令牌只进入既有加密秘密存储，业务表只存引用和版本。重授权与刷新必须保持供应商 open_id 一致，防止旧任务误切换到另一个账号。

连接默认仅所有者可用。所有者可通过 `POST .../connections/:id/agents` 明确授权本公司 Agent（`confirm:true, agentIds:[...]`）；调用仍须真实 Agent JWT、run ID、代表的责任用户与连接所有者相同。不能仅凭 Agent ID 读取他人连接。当前设置页尚未提供授权 Agent 的表单。

## 执行、重试与权限

`POST .../jobs` 需 connectionId、requestKey、prompt、confirmRemoteExecution=true。台账先持久化再发起远端创建；同一请求键和相同内容返回原台账。超时或不完整回执标记 indeterminate，不再自动创建。`POST .../jobs/:id/refresh` 查询原任务。OAuth 回调、输入 prompt、秘密引用及供应商错误不写入普通 HTTP 日志。

`POST .../jobs/:id/prompt` 是明确的新一轮交互，不自动重放创建时的 prompt。ACP 使用 SSE + JSON-RPC，先建立连接，再初始化和加载任务；发送 prompt 前写入 durable turn 状态。所有权限请求默认拒绝。未知发送结果保留活动轮次，不因重启自动重复。完成任务可通过官方 overview 产物 REST 接口只读恢复报告，不重新发送 prompt；只接受操作者允许的精确主机以及文档定义的 `/acp` 沙箱路径。网关 `/sessions/...` URL 不猜测产物端点，而记录 artifact_endpoint_unverified。分页、响应大小和会话 ID 均受限，保存的只是报告和 agent URI，不返回带凭据的下载 URL。

端流结束、round end、provider completed、业务完成分别处理；不声称可强制取消云端执行，也不声称本地工作区自动回传。

适配器重试身份包含公司、Agent、稳定任务、工作区、连接、显式 epoch 和 prompt。即使创建响应丢失或 run ID 变化也查找同一台账。供应商成本未知时使用 unpriced，不伪造美元金额。当前没有后台无限轮询或自动修复循环。

## 验证与缺口

已执行协议夹具、独立适配器单测和真实本地 PostgreSQL/HTTP 集成测试，包含未知创建不重复、OAuth state 会话绑定、加密秘密存储不泄漏及报告跨服务实例恢复。这些不是官方租户联调。真实应用授权、实际额度、账号限流、SSE 长连接断线、真实任务完成与业务验收尚未验证。刷新并发、Agent 授权 API 的更完整集成矩阵仍需补充。

关闭开关停止新执行；先核对远端仍在运行的任务，再回退应用。保留迁移 0335 和台账，不能通过删除台账清除未知结果。

参考：[官方 OpenAPI](https://open.workbuddy.cn/docs/openapi)、[第三方应用](https://open.workbuddy.cn/docs/third-party-app)。
