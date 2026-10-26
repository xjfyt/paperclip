# Casdoor 单点登录

默认关闭。保留现有用户、session、account 和公司 membership，不创建并行身份表。

## 配置

使用 authenticated 部署并设定 PAPERCLIP_AUTH_PUBLIC_BASE_URL / BETTER_AUTH_SECRET。通过受控环境注入：

- PAPERCLIP_OIDC_ENABLED=true
- PAPERCLIP_OIDC_DISCOVERY_URL：Casdoor 实际 discovery URL，HTTPS；仅本地测试允许 HTTP 回环。
- PAPERCLIP_OIDC_EXPECTED_ISSUER：精确匹配发现文档和 ID token 的 issuer。
- PAPERCLIP_OIDC_CLIENT_ID / PAPERCLIP_OIDC_CLIENT_SECRET：应用配置，秘密不入 Git。
- PAPERCLIP_OIDC_LOGIN_POLICY=dual（默认）或 sso-only。
- PAPERCLIP_OIDC_POST_LOGOUT_URL：可选，必须与配置的公开应用地址同源，并在 IdP 登记。
- PAPERCLIP_OIDC_ALLOWED_SUBJECTS：可选逗号分隔 sub 白名单；未设置时由 Casdoor 应用准入控制。无论如何，公司权限仍需邀请。

POST /api/auth/sign-in/social 使用 casdoor；回调 /api/auth/callback/casdoor。站内 callbackURL 与 IdP 回调不是同一地址。GET /api/instance/auth-capabilities 只暴露密码策略和 provider 名称，不暴露 issuer、秘密、令牌。

## 安全行为

Better Auth 1.7.2 验证 JWKS 签名、issuer、audience、时效和 nonce；适配层另外拒绝缺失 ID token、发现 issuer 漂移和未获准 sub。state 显式存数据库，单次消费；不使用无状态 cookie 模式处理可重放授权状态。邮箱相同不自动绑定；旧用户登录后在 Profile 点击绑定。默认禁止解绑最后一个账户。Casdoor 的管理员字段不映射实例管理员。

sso-only 在服务端关闭密码认证，不只隐藏按钮。先在 dual 测试两个身份、邀请与恢复，再切换；普通用户不拥有修改环境变量的恢复入口。故障恢复由拥有部署权限的运维停止服务，改回 dual 并恢复原本已有的管理员密码登录；不能开放任意新用户注册代替恢复。

## 注销与停用

自托管退出清除账户查询缓存，消费 Better Auth 的 url/redirect；Cloud 继续使用原路径。浏览器跳转 IdP 不等于确认 IdP 全局退出；IdP 无响应时本地 session 已清除，全局结果仍待验证。关闭 Casdoor 用户不会自动撤销本地存量 session；管理员仍需撤销本地成员授权、session 和个人 token。当前未实现 back-channel logout。

## 验证边界

配置、真实 RSA 签名的 provider 流水线、PKCE/nonce、错误 issuer/audience/expiry/签名、缺失 token、错误/重复 state、相同邮箱不隐式合并：本地协议测试。公司访问另有既有 authz 回归。UI 类型/构建需随集成重跑；真实 Casdoor、双身份邀请、全局退出和停用均未实连。完整 server 类型检查已通过（迁移内存盘缓存并修正事务类型后复验）；这不等于真实 IdP 或全仓构建验收。

上游协议来源：https://github.com/better-auth/better-auth/tree/v1.7.2/packages/better-auth/src/plugins/generic-oauth
Casdoor 联调：https://casdoor.ai/docs/how-to-connect/oidc-client/

## 仅 SSO 模式的解绑保护

SSO-only 下，即使历史 credential 账号行仍存在，密码也不是可用回退方式。因此服务端在 Better Auth 的 unlink-account 前置钩子明确拒绝解绑 Casdoor；dual 模式继续沿用库的最后账号保护。内存 OAuth 流测试已覆盖旧密码账号显式绑定成功后拒绝解绑，而非只检查配置布尔值。

## 邀请入口

未登录的人类邀请通过实例auth-capabilities选择登录方式：dual保留密码表单并显示Casdoor，sso-only只显示SSO，未知/加载/失败状态不显示密码回退。Cloud邀请继续使用CloudSignIn；SSO返回路径限定本地邀请路径。重复点击单飞，切换邀请或卸载后忽略旧SSO响应。健康/会话/成员查询失败时不自动接受邀请。邀请不会授予实例管理员权限，原有邀请/公司服务仍做最终授权。

新入口四语显示不代表整张存量邀请页已完成翻译，旧表单与部分状态文案仍在高频页面翻译清单中。

## 管理员撤销本地凭据（实例范围）

实例 Access 页面选择用户后提供独立的“撤销本地登录访问”操作。仅已有实例管理员的真实浏览器 session 可调用；Board API key、Agent、local_trusted 隐式用户不能调用，托管方隐藏 instance.access 时也禁止。必须输入完整目标 userId 并选择离职/疑似泄露/管理操作原因。

POST /api/admin/users/:userId/auth-revocations 请求：requestId（UUID）、confirmUserId（必须等于目标）、reason（offboarding / compromised / administrative）。GET 同路径返回最多50条审计回执。按数据库时间使截止时刻前的未失效会话过期，并撤销目标的个人 Board API keys；不暴露令牌、key hash、邮箱或秘密。会话行不直接删除。0344 保存实例范围回执，因为没有组织的用户也需要可追踪的撤销。

事务同时写入撤销与审计。同一请求ID并发/网络重试返回原回执，不扩大到后来新建的会话；更改目标、原因或操作者返回冲突。浏览器在sessionStorage按操作者与目标保存待确认请求ID，刷新后不会自动发请求。操作完成后要明确开始新请求，才会撤销新的会话。禁止把一次请求的重试当作持续封禁。

### 停用操作顺序与限制

1. 在实际Casdoor端禁止该身份访问应用，完成IdP撤销；此处不替用户修改真实IdP配置。
2. 使用Paperclip现有成员暂停/归档或组织授权管理，撤销所有不再允许的公司成员授权；按现有规则先处理最后Owner/责任转移。实例管理员身份也须独立检查，不由本操作隐式降权。
3. 管理员在上述面板撤销本地会话及Board API keys，保留requestId/截止时间/数量回执；用原会话验证不可继续访问。并发中新签发或截止时刻后的会话不在旧回执范围，先封住登录再用新请求复查。
4. 单独盘点Public MCP OAuth授权、WorkBuddy/其他连接器、Agent密钥、已运行任务及外部系统授权。这些不属于个人Board key撤销范围，不得宣称本操作“一键全系统停用”。
5. 若IdP仍允许登录，该身份仍可建立新会话。本地撤销不替代Casdoor停用，也不是back-channel logout；不会回滚已完成动作或取消已放行的在途请求。

恢复需由管理员重新授予必要成员访问并在IdP恢复授权；已撤销的Board key不能恢复，应另走受控新授权流程。真实环境停用仍需有授权的测试身份与Casdoor联调。

注销后的health刷新仅是附带状态更新，不阻塞已完成的本地退出或IdP跳转。定向测试已复现health请求挂起时旧实现一直pending并未进入IdP；改为保留health缓存原位刷新、同时继续退出。原API退出失败仍不清缓存、不跳转；Cloud仍走原harness流程。
