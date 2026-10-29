# 配置、身份与持久目录

> **对应代码** — `server/src/config.ts`、`server/src/config-file.ts`、`cli/src/index.ts`、`.env.example`、`tests/mimouse/playwright.config.ts`
> **维护提示** — 配置读取优先级、环境变量、默认值、身份或持久化路径变化时更新
> **最后验证** — 2026-10-30（对照 loader、CLI 与现有部署合同；可替换参数使用本仓源码直执行入口）

## 一、先确定配置来源

配置来自实例配置文件、进程环境及相应启动器。各字段按 loader 的明确顺序合并，不存在适用于所有字段的单一“全部环境变量优先”规则。

| 来源/入口 | 作用 |
|---|---|
| `PAPERCLIP_HOME` | 实例状态根；默认用户目录 `.paperclip` |
| `PAPERCLIP_INSTANCE_ID` | 选择实例，默认 `default` |
| `PAPERCLIP_CONFIG` | 显式配置路径；不要误指向另一个用户或生产实例 |
| `--data-dir` | CLI/开发启动器为本次操作选择状态根；不能保证清除继承的数据库 URL 或配置指针 |
| `node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts configure --section server` | 在仓库根目录执行本仓 CLI 源码；示例选择 server，其他章节以 CLI `--help` 为准 |
| `.env.example` | 开发示例，含外部数据库 URL 和开发秘密；不是完整生产模板 |

向测试或故障报告提供配置时只给字段名、脱敏 origin、模式和路径 owner；不打印 `.env`、连接串、Cookie 或秘密正文。

## 二、网络与登录

认证、暴露策略、监听与 public URL 是不同维度。使用同一规范用户 URL，避免回调、Cookie、允许主机和代理来源互相矛盾。

| 字段 | 当前含义 |
|---|---|
| `PAPERCLIP_DEPLOYMENT_MODE` | `local_trusted` 或 `authenticated`，具体解析与约束见部署模式 |
| `PAPERCLIP_DEPLOYMENT_EXPOSURE` | authenticated 的 `private/public`；local trusted 按 private 处理 |
| `PAPERCLIP_BIND` | `loopback/lan/tailnet/custom`；与模式及 host 一起验证 |
| `HOST`、`PORT` | host 默认 `127.0.0.1`，端口默认 3100；实际选定端口以启动输出为准 |
| `PAPERCLIP_PUBLIC_URL` | 用户访问的规范 URL；已有更高优先级认证 URL 时不能仅改此值 |
| `PAPERCLIP_ALLOWED_HOSTNAMES` | 额外允许主机名，不是公司成员授权 |
| `SERVE_UI` | 静态 UI 开关；设置为 `false` 不应期待该进程提供网页 |
| `PAPERCLIP_UI_DEV_MIDDLEWARE` | Vite 开发 middleware；不是生产静态打包开关 |

当前认证 public base URL 的显式来源顺序为 `PAPERCLIP_AUTH_PUBLIC_BASE_URL`、`BETTER_AUTH_URL`、`BETTER_AUTH_BASE_URL`、`PAPERCLIP_PUBLIC_URL`、实例 `auth.publicBaseUrl`，没有显式来源时还可能使用受管运行时 URL。修改前先确认哪一项实际生效，不能只在浏览器端改地址。

## 三、数据库、上传与秘密

未指定连接 URL 的默认本地运行使用 embedded PostgreSQL。外部数据库 URL、迁移连接和文件存储应共同指向预期实例。

| 字段/数据 | 核对内容 |
|---|---|
| `DATABASE_URL` | 进程值优先于配置中的外部连接；默认本地路径不应混入生产 URL |
| `DATABASE_MIGRATION_URL` | 可用独立直连执行迁移；采用事务池时尤其核对 |
| `DATABASE_PREPARED_STATEMENTS` | 事务池兼容设置见数据库合同，不以修改源码绕过供应商要求 |
| embedded PostgreSQL | 默认 `instances/<id>/db`；端口/目录由实例配置和启动逻辑确定 |
| `PAPERCLIP_STORAGE_PROVIDER` | 当前支持本地 `local_disk` 和 S3 等所列 provider；以实际允许枚举为准 |
| `PAPERCLIP_STORAGE_LOCAL_DIR` | 本地上传字节目录，可覆盖实例默认目录 |
| `PAPERCLIP_SECRETS_MASTER_KEY_FILE` | 本地加密主密钥文件路径，可覆盖配置和默认位置 |
| `PAPERCLIP_SECRETS_STRICT_MODE` | 明文敏感 env 的限制；当前 authenticated 默认启用，显式配置按 loader 处理 |

秘密配置通过引用与版本传递，不在 UI、日志、审计或文档中复制原文。恢复需要匹配的数据库、文件与主密钥，见[备份合同](../05-maintenance/04-backup-upgrade.md)。完整变量与 provider 说明见[数据库](../../doc/DATABASE.md)、[英文环境变量入口](../deploy/environment-variables.md)和[秘密说明](../deploy/secrets.md)。

Windows 的凭据隐私以真实 NTFS owner/DACL 判断，不以 POSIX mode 位替代；新空路径写入前保护、既有宽 ACL/链接/不可验证路径拒绝及探针限制见[本地私密文件权限](02-private-filesystem.md)。

## 四、二开执行开关

稳定变量及模块语义集中维护在[二开部署合同](../../doc/mimouse/deployment.md)，本页只说明使用原则。

通知配置、通知发送 worker、WorkBuddy、OIDC、GitLab 推送/轮询和修复各有独立开关。关闭 worker 不一定删除已持久入队事件；保存配置不等于发送授权；暂停本地连接也不证明供应商任务已取消。按[集成边界](../04-modules/01-integration-boundaries.md)逐项处理未知状态。

测试专用开关、marker 和 HOME 只用于可销毁夹具，不拷入生产配置。切换公司或登录身份不会把原请求授权带到新上下文；后端仍重新核对当前身份与资源权限。
