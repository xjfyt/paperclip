# 持久通知中心

路径：公司侧栏「通知中心」；API `/api/companies/:companyId/notifications`。管理写面限公司 owner/admin 或实例管理员；Agent 不能配置渠道。渠道配置与公司秘密引用由服务端校验；返回不含完整 Webhook、访问令牌或供应商原始错误。保存只校验，不发送。

## 开关与凭据

`PAPERCLIP_NOTIFICATIONS_ENABLED=true` 启用 worker 与业务事件钩子，默认关闭。`PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED=false` 可暂停外部派发并继续事务入队，便于维护与无外发测试；恢复前先检查积压。部署前先备份数据库并应用标准迁移。凭据使用已有公司秘密存储，值为 JSON；配置中填写秘密 ID 和固定版本。

- 企业微信/飞书/钉钉旧 Webhook：`url`，需要签名时增加 `signingSecret`。飞书与 Lark 使用各自域名；API 的 brand=lark 受支持，当前设置页仍只有飞书入口。
- 钉钉应用机器人：JSON 的 `accessToken`，渠道配置 robotCode/target。
- 微信公众号：JSON 的 `accessToken`，渠道配置 target（OpenID）、templateId、templateData。

后两者当前依赖外部安全刷新服务更新 token。自动 AppSecret 换 token/共享缓存尚未接入，不应作为长期免维护生产方案。固定版本在过期/撤销后明确拒绝，不偷偷换到最新版本。配置变更新建 endpoint，旧投递仍绑定原快照。停用阻止进入 sending 前的投递，不能撤回已进入外部发送阶段的消息。

## 事件与投递语义

当前接入六类：`approval.requested`、`run.failed`、`coding.mr_ready`、`coding.ci_failed`、`coding.artifact_ready`、`budget.threshold_reached`。审批、预算会计事务、编码远端回执或产物清单持久化与对应入队同事务提交。重复同步由事件唯一键去重。`run.failed` 使用迁移 0337 的 PostgreSQL AFTER 触发器，覆盖旧/原生运行持久化的 failed/timed_out，不依赖易丢失的进程内回调。触发器只向原有 outbox 入队，不建立第二套总线、不发送网络请求。只为当时已启用的订阅和渠道记录最小引用与固定凭据版本。关闭运行时开关会停止派发；如需同时停止收集运行失败事件，应先停用该订阅或渠道。四语按订阅语言生成最小文案和公司前缀详情链接，renderVersion=2；已有投递保持原快照。失败运行使用 renderVersion=3，先在业务事务中冻结目标、版本、语言和公司/运行引用，worker 首次派发前持久化渲染后的文案和当前受信公开来源链接；后续重试复用这一快照。未产生有效渲染时不发送。仅发送资源摘要/引用，不发送完整业务 payload、代码或日志；不默认 @all。

唯一键 company/event/subscription 防重复入队。数据库原子领取和 lease UUID 防迟到回写。过期 claimed 可以重领；过期 sending 变为 indeterminate，不自动重发。平台 accepted 不等于已读，也不代表业务审批完成。测试发送使用显式确认和稳定 requestId；结果未知时先核对外部平台，不重复点击创建新测试。管理员可以在核对后通过显式重试 API 同时确认已核对结果、接受重复风险，以原快照创建新投递；原未知记录不改成成功，同一个重试 requestId 只入队一次。

共享目标间隔保存在数据库，通过事务 advisory lock 序列化：飞书默认 1 秒，其他渠道 3 秒，均为保守产品默认，不是声称所有产品有相同官方配额。429 按 Retry-After 和退避，最多 5 次/30 分钟；其他错误按 rejected/indeterminate 记录。业务错误码不盲目重试。超时、异常响应与 5xx 保持未知。

## 验证与限制

五驱动有协议单测（签名输入、字节长度、业务码、模板字段、未知结果）；真实 HTTP/PostgreSQL 集成覆盖回滚、幂等、双 worker 竞争、过期领取、sending 恢复、迟到回执与跨公司外键。真实群、公众号权限和 token 刷新均未验收。设置页四语已构建与类型检查；云权限阻止 Chromium，浏览器测试未通过。

尚未完成：管理员对未知投递的对账/显式重试界面（API 已有）、订阅停用界面（API 已有）和配置修订 UX。此文不是完整通知能力验收报告。回滚先关闭开关和 worker，保留台账，再回退应用；不删新表清除未知状态。
