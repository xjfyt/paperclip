# 2026-10-29 项目复查：Windows 验证证据

本记录针对当前 Windows 工作树，历史云环境的 `/tmp` 日志和浏览器 IPC 阻塞不作为本机结果。基点为 `5ccd4ef014d1dc4101327985fde8cd6203b44dec`，本轮构建兼容与审计修复尚在工作树；构建印章只记录该 Git HEAD，不代表工作树没有未提交改动。正式交付前须以最终差异与对应复验结果为准。

## 环境与隔离

- Windows、Node.js `v24.16.0`、pnpm `9.15.4`；系统 Microsoft Edge `156.0.4314.50`。
- 测试使用新建、带 `.mimouse-test-fixture` 标记的系统临时目录。数据库、master key、公司和任务均为一次性夹具；未连接真实用户实例。
- Playwright 配置禁用心跳调度、通知发送 worker、GitLab 发布/轮询/修复、WorkBuddy、OIDC 和 Telemetry；浏览器仅访问回环测试实例。
- 没有调用真实 Agent/模型、发送外部消息、上传业务产物或执行生产部署。

## 已复现并修复的验证工具问题

| 问题 | 实际失败 | 修复与复验 |
|---|---|---|
| UI 严格聚合器的模拟 Vitest 没有规范化 Windows 路径 | `node --test scripts/test-mimouse-ui.test.mjs` 首轮 12/18 通过，6 项阳性 fixture 失败 | 仅修模拟发现路径的分隔符，使其匹配真实 Vitest 的 portable 过滤规则；18/18 通过。严格文件清单、漂移、哈希、skip/todo 与篡改拒绝断言保留，未放宽实际聚合器。 |
| 隔离 PG 初始化脚本将 Windows 绝对路径直接动态 import | `prepare-disposable-db.mjs` 报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，尚未启动数据库 | 使用 `pathToFileURL` 转换模块地址；新的标记目录实际初始化成功。既有 marker、配置文件和数据库覆盖拒绝检查保留。 |
| POSIX 文件恢复成功用例没有说明平台条件 | Windows 首轮运行恢复 fixture，11 项在长路径 staging 处失败，尚未进入平台保护；生产实现与文档本来就明确不支持 Windows | 仅把 10 个 POSIX 成功/并发/恢复用例在 Windows 标为有理由的 skip；保留跨平台 readiness/ACL 用例，新增实际 Windows API/FS 拒绝测试，确认 422 `restore_platform_unsupported`、原文件/版本不变且没有恢复 receipt、pending 标记或审计写入。短 HOME 下拒绝和 ACL 两项通过；skip 不算通过，也未增加 Windows 恢复能力。 |

`tests/mimouse/*.spec.ts` 中形式相近的 TS 动态 import 已通过真实 Playwright 收集验证；其 loader 能处理该路径，不因字面相似进行批量替换。

## 本轮检查

| 检查 | 结果 | 证据与范围 |
|---|---|---|
| UI 标准生产构建 | PASS | `pnpm --filter @paperclipai/ui build`，6.04 秒。日志 `test-results/project-audit/ui-build.log`。保留动态导入不能拆包和大 chunk 提示。 |
| Server 标准完整构建 | PASS（首轮失败后修复） | `pnpm --filter @paperclipai/server build` 最终退出 0；包含 Runner 合同检查、TS、Rust release、server TS、资源和印章。日志 `test-results/project-audit/server-build-esm-fixed.log`。Runner Rust release 冷编译 55.08 秒，保留 18 条库及 1 条二进制警告。首轮 manifest 行尾及后续 Windows ESM 路径失败保留在 `server-build.log`、`server-build-lf.log`，不能隐藏为首次即过。 |
| UI 聚合器工具回归 | PASS | `node --test scripts/test-mimouse-ui.test.mjs`，18/18，零 skip/todo；日志 `test-results/project-audit/ui-harness-tests.log`。这是工具回归，不是重跑 12940 项全 UI。 |
| 源码 Server + 静态 UI + 真实 Edge | PASS | `api.spec.ts` 3 项和 `i18n.spec.ts` 4 项，7/7，47.4 秒。日志 `test-results/project-audit/browser-source.log`。覆盖实际 HTTP/PG 生命周期、静态 HTML/JS/CSS、无 Agent 的四语任务导航、切语、刷新持久化和原始用户正文保留。 |
| 编译 Server + 完整 MiMouse API + 四语 | FAIL | 首轮 168 项：156 通过、12 失败，4.6 分钟，日志 `test-results/project-audit/compiled-api-browser.log`。11 项 restore fixture 长路径失败；另 1 项 Qoder 假 CLI 的真实派发停在 queued。未删除失败记录或把 156 通过写成完整组通过。workspace 包及若干测试夹具仍直接加载 TS，不是 all-dist 独立安装包。 |
| 短 HOME 的平台边界及四语截图复验 | 有限范围 PASS，含明确跳过 | `evaluation-restore.spec.ts` 与 `i18n.spec.ts`：6 通过、10 个 POSIX 用例跳过、0 失败，1.1 分钟；日志/JSON 为 `test-results/project-audit/windows-targeted.log` / `windows-targeted.json`。其中实际 Windows 拒绝、跨平台 ACL 两项与真实 Edge 四语四项通过。不能迁移为首轮完整 API 通过。 |
| 审计修复后的相关 API 与最终四语截图 | PASS | 最终根类型/构建完成后，编译 server 下 `feedback-inbox.spec.ts` 3 项、`operations-preview.spec.ts` 4 项、真实 Edge 四语 4 项：11/11，零 skip/flaky/失败，1.2 分钟。日志/JSON `test-results/project-audit/final-api-browser.log` / `final-api-browser.json`；截图等待字体并停用截图动画，实际保全为下方 4 张仓库 PNG。此轮不覆盖 Windows Qoder 或 POSIX 恢复。 |

上述日志位于被 Git 忽略的本机 `test-results/project-audit/`，用于本轮复查与故障定位；它们不是仓库可迁移的永久证据，也不应仅凭路径宣称其它环境可复核通过。

实际合成任务截图已保存到仓库：[英文](assets/project-audit-20261029/tasks-en.png)、[中文](assets/project-audit-20261029/tasks-zh-CN.png)、[西班牙文](assets/project-audit-20261029/tasks-es.png)、[日文](assets/project-audit-20261029/tasks-ja.png)。只包含一次性合成公司和正文，证明这些有界界面实际呈现，不代表全站验收。

机器可读的[脱敏证据摘要](2026-10-29-project-audit-evidence.json)保留实际计数、日志 SHA-256 与 4 张截图的字节数/摘要；不复制包含进程环境配置的完整 Playwright JSON。日志未入 Git 时摘要不能使日志凭空可用，复跑须重新保全实际输出。

## 仍未覆盖的事项

本轮开始时 `ACCEPTANCE.csv` 有 56 行：43 `passed`、6 `partial`、6 `blocked`、1 `not_run`。这是历史分级检查条目数量，和原 v2 的 85 个稳定需求 ID 不是同一分母，不能据此计算总完成率。

- 外部 C3/C4：Casdoor 实际登录/停用、Qoder 真实任务、WorkBuddy 实际授权/收费 job、指定通知收件端、真实 GitLab 多项目/Runner、Langfuse/企微来源与持续业务使用。
- 外部合同与代码缺口：六目标可信 controller/签名准入、内部上传执行器、业务只读来源适配、业务 apply/持久执行/幂等与对账。空库迁移或本地产物 hash 无法替代这些实现。
- 本机浏览器通过只覆盖现有四语脚本；真实 Windows 中文/日文 IME、完整焦点/键盘/长文案/窄窗、所有动态文案及交互路径仍需专项验收。
- 当前版本的既有数据升级/备份恢复、all-dist 安装包、六平台最终产物和生产版本尚未由本记录证明。
- Qoder Windows 执行没有取得成功证明；适配器文档也明确该平台尚未 qualified。`groupIsStopped` 在 Windows 返回 false，而成功要求受控进程组已停止，需独立 Windows 进程归属/终止合同。安装时 `wslpath` 缺失只是 warning 后回退，随后包已加载并返回 201，不能将它直接写成 queued 的确定根因。
- 源码测试、短 HOME 及最终相关 API 轮次退出后，Windows Playwright 均留下本夹具 PG 的一个 `io_worker` 子进程，占用 `54329`；已逐次核对该夹具的 `postmaster.pid`、数据目录及父 PID 后精准清理。最终已确认 `3100` / `54329` 均无监听，记录 `test-results/project-audit/final-cleanup.log`。首轮完整 API 退出后未发现同类残留，说明不能假定每次必现。
- 没有盲加 `globalTeardown` 直接停 PG：本机 Playwright `1.62.1` 的 global teardown 先于 webServer 插件强杀，而服务端 PG supervisor 对意外退出立即重启；仅用 `pg_ctl` 停服务端拥有的 PG 仍有重启竞态。Playwright Windows 插件自身不支持 graceful signal shutdown。后续应独立设计测试端持有 PG 生命周期或服务端协作关停合同，不能靠删 pid、放宽归属检查或广泛 kill 获得绿色结果。

相关现行边界见 [REMAINING](../REMAINING.md)、[用户验收](../USER-ACCEPTANCE.md) 与 [逐项需求追踪](../PLAN-TRACEABILITY.md)。

## 本机复验命令

以下为 PowerShell；必须先完成当前代码的标准 server/UI 构建，且 `3100`、`54329` 没有其它实例占用。使用短的全新测试 HOME，避免 Windows 长路径先于被测合同触发。

```powershell
$fixtureHome = Join-Path $env:TEMP ('pca-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $fixtureHome | Out-Null
Set-Content -LiteralPath (Join-Path $fixtureHome '.mimouse-test-fixture') `
  -Value 'paperclip-mimouse-disposable-fixture-v1' -NoNewline
$env:PAPERCLIP_MIMOUSE_TEST_HOME = $fixtureHome
node tests/mimouse/prepare-disposable-db.mjs
if ($LASTEXITCODE -ne 0) { throw 'Fixture initialization failed' }
$env:PAPERCLIP_MIMOUSE_TEST_COMPILED = 'true'
$env:PAPERCLIP_TEST_POSTGRES_TCP_ONLY = '1'
$env:PAPERCLIP_TEST_CHROMIUM = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
pnpm exec playwright test --config tests/mimouse/playwright.config.ts `
  --output=test-results/project-audit/recheck evaluation-restore.spec.ts i18n.spec.ts
```

当前 Windows 的预期是 **6 通过、10 个有理由的 POSIX-only skip**，而不是 16 项通过。若端口/数据库身份不符，停止并调查，不能复用未知服务或删除锁。执行后检查自己的 server/PG 是否退出；现有 Playwright Windows 退出链有上文已复现的 orphan 边界。
