# 本地身份流程验收夹具

`tests/mimouse/oidc-fixture.mjs` 是仅供本地测试的身份服务，不是真Casdoor，不在生产注册表中。它固定监听回环，默认应用为http://127.0.0.1:3101、IdP为3102；启动须显式设置PAPERCLIP_MIMOUSE_OIDC_FIXTURE=loopback-only。禁止指向生产实例或真实账号。

协议夹具提供discovery/JWKS、RSA签名ID token、state/nonce、单次code与S256 PKCE、固定客户端/回调/注销白名单。私钥只在内存；账号全部使用paperclip-fixture.invalid。每类待处理请求最多1000个，五分钟过期。测试秘密是公开假值，没有任何真实供应商权限。

可复验`node --test tests/mimouse/oidc-fixture.test.mjs`，包括签名校验、PKCE错误、授权码重放、外部回调拒绝及固定注销路径。`oidc-client.mjs`提供真实HTTP客户端，cookie只留在闭包里，绝不输出或保存；只能请求显式回环app API。

浏览器测试需另启全新的PAPERCLIP_HOME/INSTANCE_ID，authenticated/private模式、独立cookie前缀与数据库，事先核对data_directory和专用夹具标记。给应用配置上述回环discovery/issuer、fixture clientId和公开假secret、回跳/auth；真实所有供应商执行/通知/GitLab/遥测开关关闭。保留现有OIDC校验，不能关闭签名/nonce/PKCE来让夹具通过。

验收顺序：Owner SSO→认领初始管理员→创建测试组织→创建Viewer邀请→退出→未邀请Outsider登录并验证403→接受邀请并验证读200/写403→正常密码注册Legacy→邀请→显式绑定同一IdP身份→退出后纯SSO再次登录并核对同一userId。所有浏览器检查需实际点完并记录结果，不能只运行fixture自身协议测试就标记全部通过。

初始认领和邀请仅对这些一次性测试身份/组织执行；不得使用此流程给真实用户授权。结束时关闭fixture及测试app进程，保留必要无秘密测试回执；不要把邀请token、cookies、数据库或运行时私钥打入交付包。
