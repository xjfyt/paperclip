# 部署、升级及回退

## 准备

使用 Node >=24.11.0、pnpm 9.15.4 与固定锁文件。按上游根 README、AGENTS 和部署文档配置 PostgreSQL、持久 PAPERCLIP_HOME、秘密加密密钥和实例管理员。Rust runner 的版本以仓库 rust-toolchain 为准。生产不要使用 local_trusted 对外监听。

本轮云验证版本：Node 24.22.1、pnpm 9.15.4、Rust 1.97.1。依赖未为解决环境问题任意升级。上游 runner 构建有 7 条警告，不记为零警告验收。

## 升级顺序

1. 固定应用版本，备份数据库、PAPERCLIP_HOME、加密密钥和部署环境配置。保存 adapter 包版本，不把密钥写入 Git。
2. 阅读迁移差异；沿上游标准迁移命令应用 0334（通知）、0335（WorkBuddy）、0336（编码交付）、0337（运行失败事务出箱触发器）及 0338（WorkBuddy 私有凭据与旧连接重新授权）、0339（编码同步租约与游标）及 0340（有限修复授权与派发台账）及 0341（通知应用加密令牌缓存和刷新租约）。新增表与触发器不会补发历史运行；已经应用的迁移不得重写。正式升级前仍需在自己的数据库备份上演练。
3. 通知、WorkBuddy、OIDC 和 GitLab 推送先保持关闭。启动服务并检查 `/api/health`、原密码登录、公司/任务和现有运行。
4. Casdoor 先 dual，完成管理员恢复与两个测试用户的隔离后再改 sso-only。WorkBuddy OAuth 与 Casdoor 登录是独立连接。
5. 通过上游外部适配器管理入口安装本仓库审核后的本地包。先环境诊断，后受控 fixture，不默认触发收费任务。
6. 通知先配置停用的 endpoint 和秘密固定版本，明确测试接收目标后启用、预览并单独确认测试发送。不得把保存配置作为发送授权。
7. GitLab 先只读同步；核对来源允许列表、项目、工作分支及权限，再由操作者开启推送。全流程不自动合并或生产发布。

## 环境变量示例

下列是部署环境变量，不是可以直接投入生产的有效配置；通过受控环境注入。具体校验见各模块文档。

```dotenv
PAPERCLIP_AUTH_PUBLIC_BASE_URL=https://paperclip.example.invalid
PAPERCLIP_OIDC_ENABLED=false
PAPERCLIP_OIDC_LOGIN_POLICY=dual
# PAPERCLIP_OIDC_DISCOVERY_URL=https://id.example.invalid/.well-known/openid-configuration
# PAPERCLIP_OIDC_EXPECTED_ISSUER=https://id.example.invalid
# PAPERCLIP_OIDC_CLIENT_ID=replace-with-app-id
# PAPERCLIP_OIDC_CLIENT_SECRET=<secret-manager>
PAPERCLIP_WORKBUDDY_ENABLED=false
# PAPERCLIP_WORKBUDDY_CLIENT_ID=replace-with-app-id
# PAPERCLIP_WORKBUDDY_CLIENT_SECRET=<secret-manager>
PAPERCLIP_NOTIFICATIONS_ENABLED=false
# false pauses outbound delivery while keeping enabled transactional event collection
PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED=false
PAPERCLIP_GITLAB_PUBLISH_ENABLED=false
PAPERCLIP_GITLAB_POLL_ENABLED=false
PAPERCLIP_CODING_REPAIR_ENABLED=false
PAPERCLIP_GITLAB_ALLOWED_ORIGINS=https://gitlab.example.invalid
PAPERCLIP_GITLAB_WORK_BRANCH_PREFIXES=paperclip/
```

不要复制尖括号占位符作为真正秘密。上游其他必填认证和数据库配置继续适用，以上不是完整替代配置。

## 云测试环境已知限制

此云执行环境禁用 Unix socket，tsx CLI 进程间通信与 Chromium 启动受阻。开发服务器通过 `node --import tsx src/index.ts` 启动；隔离测试 embedded PostgreSQL 关闭 Unix socket、仅使用回环 TCP。端口探测显式使用 IPv4 回环，网络接口枚举受限时仅忽略可选候选，不放开对外监听。

HTTP 测试只接受绝对的专用 PAPERCLIP_MIMOUSE_TEST_HOME，且目录必须预先包含 `.mimouse-test-fixture` 文件，内容为 `paperclip-mimouse-disposable-fixture-v1`。禁止指向真实实例；测试拒绝有 config.json/.env 的实例目录，并隔离继承的数据库 URL、配置路径与外部执行开关。所有直接 DB 写入前核验 PostgreSQL 实际 data_directory。

不同命令会话的网络隔离，因此 HTTP 测试由 Playwright webServer 在同一执行环境启动服务。云浏览器无法直接访问该命令会话；已在助手云桌面原生终端另起专用测试实例，让现有 Chrome 实际访问。必须使用独立 PAPERCLIP_HOME/数据库，不让两个进程共享一份数据库文件。提权启动器也在受限制的挂载处失败，不通过修改受限目录或关闭安全机制绕过。

早期 server TypeScript 检查曾被 SIGKILL。已定位到依赖缓存占用 /tmp 内存盘，将构建缓存移到磁盘后完成全量检查，修正一处事务类型错误并复验通过。建议将 pnpm/Cargo/Rustup 缓存放磁盘、避免编译与启动多个 API 服务并发争用内存。完整 server tsc 通过不代表 pnpm typecheck / pnpm build 全仓脚本全部通过；模块构建证据分别记录。真实 Chrome 已验证四语任务详情、首次引导、审批与暂停通知界面；剩余视觉和真实供应商路径见验收记录，不得用 API 测试替代。

## 回退

先关闭新执行入口和 GitLab 推送，暂停通知 worker，核对已派发云任务与未知外部操作；随后回退应用版本。保留新增表、状态和原加密密钥，不清空未知任务/投递来消除告警。SSO 恢复仅由运维通过原受控部署配置执行，不向普通用户暴露绕过入口；IdP 禁用用户不自动撤销已有 Paperclip 会话，需按原管理员工具处理成员、session 与个人 token。

迁移 0338 是安全隔离迁移：旧 WorkBuddy 公司级 secret 被停用，旧连接需重新授权并重新选择允许使用的 Agent。保留历史密文与台账，不自动把旧 token 复制到新作用域，也不猜测旧任务的账号身份。回退时保持 WorkBuddy 关闭；本地停用不能代替供应商撤销。


## 构建工具与头文件分离的宿主

根目录工作区链接预检、数据库迁移检查、技能和团队目录生成/校验已改用现有tsx依赖的Node导入入口，不需要tsx CLI的额外Unix通信管道。依赖版本和锁文件不变。

Linux Tailscale NAPI扩展构建支持npm_config_nodedir（Node开发安装根目录）或npm_config_devdir（node-gyp缓存根目录，自动追加当前Node版本/include/node）。只使用与实际运行时匹配的头文件；若仍缺失，构建应明确失败，不跳过本地扩展。开发环境已用24.22.1缓存实际编译并加载getPeerCredentials导出；未改变OS权限或网络配置。

大仓库TypeScript原生编译在内存紧张时应与UI整套测试串行，并按包分批。已验证server使用GOMEMLIMIT=2500MiB、GOGC=20、GOMAXPROCS=2及--singleThreaded；其他包和根命令的完整结果以验证记录最终状态为准。
