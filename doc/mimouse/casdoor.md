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
