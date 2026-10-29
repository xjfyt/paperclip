# 当前源码的开发入门

> **对应代码** — `package.json`、`.nvmrc`、`scripts/dev-runner.ts`、`scripts/dev-service.ts`、`server/src/config.ts`、`server/src/index.ts`
> **维护提示** — Node/pnpm 版本、启动参数、实例目录或数据库选择变化时更新
> **最后验证** — 2026-10-29（命令与当前源码/合同核对；环境执行结果另记）

## 一、准备工具链

使用 Node.js **24.11.0+**；`.nvmrc` 当前选择 24 大版本。pnpm 固定 **9.15.4**，以根 `package.json` 的 `packageManager` 为准。涉及 Rust runner、原生扩展或平台包时按对应包的工具链和构建脚本准备依赖，不能从前端构建成功推断 runner 可用。

```sh
node --version
pnpm --version
git status --short
pnpm install --frozen-lockfile
```

安装前保留工作树已有修改。锁文件维护遵循 [DEVELOPING 的依赖策略](../../doc/DEVELOPING.md#dependency-lockfile-policy)，不要为绕过安装错误随意改依赖版本或覆盖用户已有 `pnpm-lock.yaml` 差异。

若实际遇到 `ERR_PNPM_OUTDATED_LOCKFILE`，先核对报错 importer 与当前清单，保留已有差异；确认确实是清单/锁不同步后，本地开发可运行一次 `pnpm install --no-frozen-lockfile` 并检查生成差异。这个处理不适用于网络、权限或其它安装失败。冻结锁文件校验不等于在空 `node_modules` 中完成全新安装，当前候选的实际检查与同步记录见[审计报告](../../doc/mimouse/checklists/2026-10-29-project-audit.md)。

首次开发按 [AGENTS](../../AGENTS.md) 依次阅读产品目标、产品定义、V1 实现合同、开发和数据库说明；本页只提供最短入口。

## 二、选择独立开发状态

普通开发使用可辨认的独立状态根目录。无 `DATABASE_URL` 时，当前默认引擎是 **embedded PostgreSQL**，默认实例数据位于 `PAPERCLIP_HOME/instances/default/db`；未覆盖 home 时使用用户目录的 `.paperclip`。`PAPERCLIP_INSTANCE_ID` 可以选择其它实例。

启动前核对 `DATABASE_URL`、`DATABASE_MIGRATION_URL`、`PAPERCLIP_HOME`、`PAPERCLIP_CONFIG` 及实例配置的数据库选择。`--data-dir` 隔离默认本地状态，不能当作清除所有继承配置或外部数据库 URL 的保证。普通开发默认可能启动已配置的业务 worker；一次性验证应使用专用夹具和其隔离开关。

```sh
pnpm dev --data-dir ./tmp/paperclip-dev
```

API 和 UI 默认同源 `http://localhost:3100`，使用 Vite middleware 热更新。端口被占用时实际地址以启动输出为准。需要不监听源码变化时使用：

```sh
pnpm dev:once --data-dir ./tmp/paperclip-dev
```

开发启动会执行本地迁移检查；先固定状态目录并备份重要数据。不要让两个进程共用同一 embedded PostgreSQL 目录，不要删除未知 PID 或锁文件来强行启动。

## 三、检查与停止

先确认当前实例和端口，再执行健康探测与服务管理。PowerShell 如需避免旧版本 `curl` 别名，可使用 `curl.exe`。

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
pnpm dev:list --data-dir ./tmp/paperclip-dev
pnpm dev:stop --data-dir ./tmp/paperclip-dev
```

认证模式下 `/api/companies` 需要合法会话，401 不代表数据库初始化失败。健康接口成功只证明相应服务状态，不代表登录、Agent 执行或外部集成已通过。

## 四、开发与检查命令

按变更范围选择入口，具体判断和记录方法见[验证规范](../05-maintenance/01-verification.md)。

| 目的 | 命令或入口 |
|---|---|
| 默认 Vitest 检查 | `pnpm test` |
| 完整类型检查 | `pnpm -r typecheck`；根 `pnpm typecheck` 另含 workspace links 预检 |
| 完整测试与构建 | `pnpm test:run`、`pnpm build` |
| 零告警构建验收 | `pnpm check:build-clean`，完整执行既有 build 并保留输出，出现构建诊断即失败 |
| UI token 规则 | `pnpm check:token-gates` |
| UI 全量分批回归 | `pnpm test:mimouse:ui`；日志、输入摘要和聚合由该脚本管理 |
| 二开 API | `pnpm test:mimouse:api`；先完成专用夹具准备 |
| 组件浏览器预览 | `pnpm storybook` |
| 中文入口文档检查 | `pnpm docs:check`，只检查本批正式文档及其链接目标，不代表全仓文档审计 |
| 保留的英文文档站 | `pnpm docs:dev`，读取 `docs/docs.json`；不代表新增中文页面已进入站点导航 |

更完整的开发、原生运行时、热重启、工作区和备份说明见 [DEVELOPING](../../doc/DEVELOPING.md)。

成功启动后按[首次使用](02-first-company.md)创建公司与任务；私网/公网、容器和管理员引导见[部署选择](03-deployment.md)，失败定位见[故障排查](../05-maintenance/03-troubleshooting.md)。

## 五、数据库、部署与回退

默认本地数据库是 PostgreSQL，不要按历史 PGlite 路径执行重置。数据库迁移从 `packages/db` schema 生成，遵循 [AGENTS](../../AGENTS.md) 的同步流程；已应用的迁移不重写。

数据库备份不能替代文件上传、工作区及加密主密钥备份。详见[数据库合同](../../doc/DATABASE.md)及[二开部署与回退](../../doc/mimouse/deployment.md)。`local_trusted` 面向受信本地使用；正式对外部署按[部署模式](../../doc/DEPLOYMENT-MODES.md)配置认证、数据库和持久化，不从本页开发命令直接推导生产配置。
