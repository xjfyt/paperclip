# 二开源码的部署与运行选择

> **对应代码** — `Dockerfile`、`docker/docker-compose.quickstart.yml`、`docker/docker-compose.yml`、`server/src/config.ts`、`server/src/index.ts`、`cli/src/index.ts`
> **维护提示** — 镜像构建、部署模式、管理员引导、数据库要求或服务入口变化时更新
> **最后验证** — 2026-10-29（配置与命令合同核对，未证明本轮容器/最终发行包已通过）

## 一、先选择部署形态

部署本仓二开需使用本仓源码构建或经过独立验收的本仓发行物。上游公开 npm 包/镜像不保证包含二开；标签相似也不能替代提交和字节来源核对。

| 目的 | 推荐入口 | 需要的边界 |
|---|---|---|
| 本机开发 | `pnpm dev --data-dir <独立目录>` | 回环、本地状态、当前源码；不作为最终发行包证明 |
| 受信私网多人使用 | 本仓 Docker/Compose 或受管 Node 部署，`authenticated/private` | 真实登录、首位管理员、持久目录、可信网络和主机允许列表 |
| 互联网访问 | `authenticated/public`，规范 HTTPS URL 和反向代理 | 外部 PostgreSQL、独立秘密、管理员邀请、公开模式检查和运行时限制 |
| 最终生产发布 | 固定提交/镜像 digest/配置和已验收数据恢复方案 | 对最终包、平台和实际部署分别验证，不从源码构建外推 |

认证模式与监听范围分别设置：`authenticated` 不自动开放网络，`HOST=0.0.0.0` 也不自动提供认证。精确约束见[部署模式](../../doc/DEPLOYMENT-MODES.md)。

受管 CLI 安装、激活与回退的现有平台合同是 macOS、Linux 和 WSL2，见[安装合同](../../doc/INSTALLING.md)。原生 Windows 会在下载和写入前拒绝受管安装/更新/回退；这条限制不等同于所有源码开发命令均不支持 Windows。检查与 dry run 保持只读；本仓二开仍需核对受管载荷来源，不能直接把上游公开包当作本仓发行物。

## 二、从本仓构建容器

在仓库根目录执行已有 Compose，`build.context` 指向当前仓库。先在受控环境设置持久的会话签名秘密 `BETTER_AUTH_SECRET`，不要复制 `.env.example` 的开发常量作为生产秘密。所选部署/运行功能需要的其它签名秘密按模块合同配置。

```sh
docker compose -f docker/docker-compose.quickstart.yml up --build
```

Quickstart 使用单容器 embedded PostgreSQL、`authenticated/private` 和 3100 默认端口；持久目录映射以该 Compose 文件中的 `PAPERCLIP_DATA_DIR` 为准，路径相对 `docker/` 解析。端口/域名变化时同步 `PAPERCLIP_PUBLIC_URL`，并核对目标目录和容量。

本地带独立 PostgreSQL 的示例入口是：

```sh
docker compose -f docker/docker-compose.yml up --build
```

该示例暴露数据库端口并使用开发级数据库账号，适合受控试运行；生产应由部署负责人按网络隔离、秘密和备份要求调整。完整构建参数及 runner provider pack 的提交印章要求见 [Docker 合同](../../doc/DOCKER.md)。本页没有将这些命令记为已执行通过。

## 三、配置认证与管理员

用[配置指引](../03-config/01-configuration.md)核对实际配置来源、public URL、绑定地址和数据库。全新私网 authenticated 实例在可信网络内由真实登录用户完成首位管理员认领；public 模式使用高熵邀请，CLI 入口为：

```sh
pnpm paperclipai auth bootstrap-ceo
```

在迁移已有 `local-board` 实例时，按服务输出与[认领合同](../../doc/DEPLOYMENT-MODES.md)处理原管理员身份。不要把登录成功等同于已成为公司管理员，也不要为排障把生产切回无认证。

Casdoor 先保持可恢复的 `dual` 策略，在实际应用、回调、两个身份、公司隔离和退出/停用验证后再评估 `sso-only`。WorkBuddy OAuth、模型连接和 Casdoor 登录独立配置。

## 四、运行前后的核对

部署不是只看服务能监听端口。先确认数据库、文件和主密钥持久化，再验证当前身份、公司访问和最小用户旅程。

1. 固定完整提交/镜像 digest 与未提交差异，读取实际启动版本；构建印章不自动包含工作树差异。
2. 备份数据库、上传对象、工作区、主密钥及配置引用，按[升级与回退](../05-maintenance/04-backup-upgrade.md)演练。
3. 核对迁移完成、健康状态、登录/管理员、公司和任务读取、附件访问及适配器就绪。
4. 二开外部 worker 先保持关闭或暂停，按[集成边界](../04-modules/01-integration-boundaries.md)逐项配置与验证。
5. 外发通知、收费任务、GitLab 推送、签名、上传和业务写入分别绑定批准范围；不因部署服务启动而默认授权。

运行中按明确 owner 管理进程、端口和数据库生命周期，保留关闭与恢复日志。停止受管开发实例使用匹配的 `dev:stop --data-dir`；容器按所选 Compose 正常停止，不删除持久卷作为排障手段。

## 五、当前验证与发布边界

本仓已有源码、类型、构建、隔离 API 与局部浏览器证据，实际状态见[审计记录](../../doc/mimouse/checklists/2026-10-29-project-audit.md)。干净冻结安装、最终独立包、原数据升级/恢复、各平台及真实外部闭环分别留证；本页提供方法，不宣称它们已完成。
