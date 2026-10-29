# 部署、升级及回退

> **对应代码** — `server/src/config.ts`、`server/src/index.ts`、`packages/db/src/migrations/`、`docker/`
> **维护提示** — 二开执行开关、迁移、安全升级、凭据或回退合同变化时更新
> **最后验证** — 2026-10-29（当前源码与合同核对；执行证据见独立记录）

## 一、准备与事实源

使用 Node >=24.11.0、pnpm 9.15.4 与当前仓库清单/锁文件。当前二开从本仓源码或已验收的本仓发行物部署，上游公开 npm 包/镜像不自动包含这些改动。先看[部署选择](../../docs/02-getting-started/03-deployment.md)、[配置指引](../../docs/03-config/01-configuration.md)及[数据库合同](../DATABASE.md)，固定 PostgreSQL、持久状态、文件存储、加密主密钥和实例管理员。

Rust runner 使用其实际包内工具链与构建入口。认证模式、暴露策略和监听分别配置；`local_trusted` 保持回环，正式多人/公网使用 authenticated。生产迁移与恢复需要自己的数据副本演练，不能以空库初始化、源码构建或历史云环境日志代替。

实际检查与告警以[本机审计](checklists/2026-10-29-project-audit.md)和[本机验证证据](checklists/2026-10-29-project-audit-verification.md)为准。第六节保存的云环境观察是历史记录，不是当前 Windows 的限制或通过证明。

## 二、升级顺序

先保全完整数据集合，再对副本应用当前迁移链；详细方法见[备份、升级与回退](../../docs/05-maintenance/04-backup-upgrade.md)。

1. 固定应用完整提交/部署物和适配器版本，备份数据库、上传/对象存储、重要工作区、加密主密钥及部署配置引用。
2. 对照 `packages/db/src/migrations/meta/_journal.json` 和实际 schema 检查目标完整迁移链。早期通知/WorkBuddy/编码迁移之后还有反馈、运营、调研、评估、构建观测及公司删除等迁移，不能只应用旧说明列到 0343 的子集。已应用迁移不重写，新表/触发器不作为补发历史任务的授权。
3. OIDC、WorkBuddy、通知发送和 GitLab 推送/轮询/修复等新执行入口先保持关闭或暂停。启动服务后核对健康、原登录方式、公司/任务、秘密解密、附件与现有运行。
4. Casdoor 先 dual，完成真实应用回调、管理员恢复、两个身份的公司隔离与退出/停用，再评估 sso-only。WorkBuddy OAuth 与 Casdoor 登录独立。
5. 通过外部适配器管理入口安装本仓审核的 Qoder/WorkBuddy 包，先核对环境/loader，再做受控夹具；真实账号、费用和允许工作区单独确认。
6. 通知先配置停用 endpoint、固定秘密版本和允许的测试接收目标，再显式启用/预览/测试发送；保存配置不等于外发授权。
7. GitLab 先核对 origin 允许列表、测试项目、工作分支和固定 SHA，再由操作者按合同开启推送。部署不默认授予 merge/tag/生产发布权限。

## 三、二开环境开关示例

以下是保守初始状态示例，不是完整生产配置。规范 URL、会话/动作签名秘密、数据库、存储及管理员仍按上游和本仓当前合同配置；秘密值由受控环境注入。

```dotenv
PAPERCLIP_PUBLIC_URL=https://paperclip.example.invalid
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
# Worker false pauses outbound delivery; it does not delete existing queue rows.
PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED=false
PAPERCLIP_GITLAB_PUBLISH_ENABLED=false
PAPERCLIP_GITLAB_POLL_ENABLED=false
PAPERCLIP_CODING_REPAIR_ENABLED=false
PAPERCLIP_GITLAB_ALLOWED_ORIGINS=https://gitlab.example.invalid
PAPERCLIP_GITLAB_WORK_BRANCH_PREFIXES=paperclip/
```

如果已经设置更高优先级的认证 URL，仅修改 `PAPERCLIP_PUBLIC_URL` 不一定改变回调。变量来源见[配置指引](../../docs/03-config/01-configuration.md)。占位符不作为真正秘密使用；启用任何外部模块前核对[集成边界](../../docs/04-modules/01-integration-boundaries.md)及其单一功能合同。

## 四、测试与运行隔离

HTTP/API/浏览器验证使用新建、绝对路径的专用 `PAPERCLIP_MIMOUSE_TEST_HOME`，marker 内容固定为 `paperclip-mimouse-disposable-fixture-v1`。测试拒绝真实 config/dotenv 与既有数据库覆盖，不复用未知服务；准备、直接 DB 写入和退出清理继续核对实际数据目录与 owner。

可执行准备方法、平台 skip 与截图边界见[验证规范](../../docs/05-maintenance/01-verification.md)和[本机证据](checklists/2026-10-29-project-audit-verification.md)。旧环境的 Unix socket/IPC 限制不直接套用当前机器；新的检查必须保留自己的失败、未知和实际执行范围。

## 五、回退与凭据恢复

先关闭新执行入口与 GitLab 推送，暂停通知 worker，核对已派发任务、投递及未知外部操作，再回退应用。数据库前向迁移与旧程序兼容性单独验证；保留新增表、状态和原加密主密钥，不清空未知记录来消除告警。

SSO 恢复由运维通过受控部署配置执行，不向普通用户暴露绕过入口。IdP 禁用用户不自动撤销既有 Paperclip session，按管理员成员、session/个人 token 工具和 Casdoor 合同处理。

迁移 0338 是凭据隔离迁移：旧 WorkBuddy 公司级 secret 停用，旧连接需重新授权、重新选择允许使用的 Agent。保留历史密文与台账，不复制旧 token 到新 owner 范围、不猜旧任务身份；回退时保持 WorkBuddy 关闭。本地停用不能代替供应商撤销。

## 六、历史云环境观察

以下段落从原部署说明保留，仅描述此前云环境；原日志和执行范围依[历史验证记录](VERIFICATION.md)解读。它们不证明当前源码或新部署通过，不作为当前主机的永久限制。

### 1、原环境版本记录

本轮云验证版本：Node 24.22.1、pnpm 9.15.4、Rust 1.97.1。依赖未为解决环境问题任意升级。上游 runner 构建有 7 条警告，不记为零警告验收。

### 2、原云环境限制与观察

此云执行环境禁用 Unix socket，tsx CLI 进程间通信与 Chromium 启动受阻。开发服务器通过 `node --import tsx src/index.ts` 启动；隔离测试 embedded PostgreSQL 关闭 Unix socket、仅使用回环 TCP。端口探测显式使用 IPv4 回环，网络接口枚举受限时仅忽略可选候选，不放开对外监听。

HTTP 测试只接受绝对的专用 PAPERCLIP_MIMOUSE_TEST_HOME，且目录必须预先包含 `.mimouse-test-fixture` 文件，内容为 `paperclip-mimouse-disposable-fixture-v1`。禁止指向真实实例；测试拒绝有 config.json/.env 的实例目录，并隔离继承的数据库 URL、配置路径与外部执行开关。所有直接 DB 写入前核验 PostgreSQL 实际 data_directory。

不同命令会话的网络隔离，因此 HTTP 测试由 Playwright webServer 在同一执行环境启动服务。云浏览器无法直接访问该命令会话；已在助手云桌面原生终端另起专用测试实例，让现有 Chrome 实际访问。必须使用独立 PAPERCLIP_HOME/数据库，不让两个进程共享一份数据库文件。提权启动器也在受限制的挂载处失败，不通过修改受限目录或关闭安全机制绕过。

早期 server TypeScript 检查曾被 SIGKILL。已定位到依赖缓存占用 /tmp 内存盘，将构建缓存移到磁盘后完成全量检查，修正一处事务类型错误并复验通过。建议将 pnpm/Cargo/Rustup 缓存放磁盘、避免编译与启动多个 API 服务并发争用内存。完整 server tsc 通过不代表 pnpm typecheck / pnpm build 全仓脚本全部通过；模块构建证据分别记录。真实 Chrome 已验证四语任务详情、首次引导、审批与暂停通知界面；剩余视觉和真实供应商路径见验收记录，不得用 API 测试替代。

### 3、原工具链与头文件观察

根目录工作区链接预检、数据库迁移检查、技能和团队目录生成/校验已改用现有tsx依赖的Node导入入口，不需要tsx CLI的额外Unix通信管道。依赖版本和锁文件不变。

Linux Tailscale NAPI扩展构建支持npm_config_nodedir（Node开发安装根目录）或npm_config_devdir（node-gyp缓存根目录，自动追加当前Node版本/include/node）。只使用与实际运行时匹配的头文件；若仍缺失，构建应明确失败，不跳过本地扩展。开发环境已用24.22.1缓存实际编译并加载getPeerCredentials导出；未改变OS权限或网络配置。

大仓库TypeScript原生编译在内存紧张时应与UI整套测试串行，并按包分批。已验证server使用GOMEMLIMIT=2500MiB、GOGC=20、GOMAXPROCS=2及--singleThreaded；其他包和根命令的完整结果以验证记录最终状态为准。
