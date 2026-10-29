# 验证分层与证据记录

> **对应代码** — `package.json`、`scripts/test-mimouse-ui.mjs`、`tests/mimouse/playwright.config.ts`、`tests/mimouse/prepare-disposable-db.mjs`
> **维护提示** — 测试入口、夹具隔离、证据结构或交付门禁变化时更新
> **最后验证** — 2026-10-30（对照现有测试脚本、分组执行与专项收据；不声明全仓最终源码已通过）

## 一、验证目标与层级

先确定要证明的行为，再选择能覆盖它的最低成本检查。延续二开现有 C1–C4 命名；层级和一次检查的结果分别记录。

| 层级 | 可证明的范围 | 不能据此推断 |
|---|---|---|
| C1 | 实现、静态检查、类型、构建和本地基础回归 | 真实账号、外部协议及生产业务可用 |
| C2 | 受控协议、故障夹具、合成数据和隔离本地集成 | 真实供应商行为、实际送达、真实模型效果 |
| C3 | 明确测试租户/账号和版本下的真实连通回执 | 全平台、全部业务和最终发行包验收 |
| C4 | 明确范围的真实业务验收与可检查产物 | 未覆盖路径、其它输入和未来版本自动通过 |

真实 PostgreSQL/HTTP 可以是 C2。Playwright APIRequestContext 不打开浏览器；jsdom 的组合输入事件不等于实际 OS 输入法。`run.status=succeeded`、HTTP 200 或模型自述成功都需结合对应业务 oracle 和产物判断。

## 二、检查选择

普通改动从最小相关用例开始；已有检查通过后，只有新增修改、失败或未解决风险需要时才扩大或重复。

| 范围 | 入口与要求 |
|---|---|
| 默认本地测试 | `pnpm test`，仅 Vitest；定向回归按相关包和配置选择 |
| PR-ready 或广泛改动 | `pnpm -r typecheck`、`pnpm test:run`、`pnpm build`，未执行需说明原因 |
| 零告警构建 | `pnpm check:build-clean`，完整调用根 build；保留原输出及失败退出码，检测到编译器/Vite/CSS/pnpm 构建诊断时，即使子进程退出 0 也判失败 |
| UI | 对应宿主组件回归及 `pnpm check:token-gates`；浏览器检查另列 |
| 完整 UI 证据 | `pnpm test:mimouse:ui`，以当前源码/输入摘要及严格聚合结果为准 |
| 二开 API | `pnpm test:mimouse:api`，只在专用可销毁夹具执行 |
| 恢复与认证 API smoke | `pnpm test:mimouse:recovery-api`；需当前编译产物及有效 build stamp，不能当全 dist 安装证明 |
| 浏览器 | 对应 Playwright 配置和真实浏览器；按受影响路径或明确 CI/release 验证范围执行，不默认跑所有浏览器套件 |
| 上游发布 smoke | `pnpm test:release-smoke`，仅在触达或明确验证发布流程时执行 |
| 真实供应商或最终包 | 按模块合同准备账号、授权范围、预算、目标和回执，独立记录 |

按批次运行 UI 时可使用 `pnpm test:mimouse:ui --batches FIRST:LAST`，范围必须来自该脚本当前清单；使用 `--aggregate` 聚合其实际 manifest。脚本会校验文件、断言和输入摘要，不把 skip/todo 或不同输入拼成一次全通过。详细选项见脚本及[历次验证记录](../../doc/mimouse/VERIFICATION.md)。

构建成功与零告警是不同结论；使用零告警门禁时仍需保留实际命令、输出和诊断数，不通过隐藏 stderr、过滤日志或全局关闭编译警告获得通过。单元/浏览器检查中的 warning 同样保留，并区分预期故障夹具输出和测试框架/未处理错误；不把大量通过数覆盖未处理异常。

Vitest 超时不会取消原来的测试 body。异步夹具应先释放门控、等待所有已启动任务结束，再恢复 mock 和清理数据库/目录；收尾失败应阻断后续用例，避免旧任务继续使用下一用例的夹具。Heartbeat 终态断言等待真实 execution drain，具体规则和 helper 见[异步测试收尾](../../doc/DEVELOPING.md#asynchronous-test-cleanup)。Windows 的真实 PostgreSQL、私密文件 DACL 和进程生命周期回归安排在低并发窗口；平台预算需针对实测用例说明，不能靠全局扩大超时掩盖任务泄漏。

## 三、二开测试夹具隔离

`tests/mimouse/playwright.config.ts` 要求绝对 `PAPERCLIP_MIMOUSE_TEST_HOME` 和明确 marker，拒绝已有应用 config/dotenv。它隔离数据库 URL、配置和多数外部执行开关，且不复用 3100 上的未知服务。

PowerShell 下可准备全新目录：

```powershell
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("paperclip-mimouse-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
[System.IO.File]::WriteAllText((Join-Path $fixtureRoot ".mimouse-test-fixture"), "paperclip-mimouse-disposable-fixture-v1")
$env:PAPERCLIP_MIMOUSE_TEST_HOME = $fixtureRoot
node tests/mimouse/prepare-disposable-db.mjs
if ($LASTEXITCODE -ne 0) { throw "Disposable database preparation failed; stop here." }
pnpm test:mimouse:api
```

准备脚本只初始化全新数据库、不启动应用，拒绝既有数据和锁。启动前确认 3100 可用；端口或平台不支持时记录失败/受阻原因，不复用真实实例，不删除未知锁，不关闭认证来使测试变绿。浏览器可执行文件覆盖使用 `PAPERCLIP_TEST_CHROMIUM`。不要为修复测试环境把生产默认开关打开。

## 四、单次记录必填信息

一条结论必须能回到实际输入和证据，建议按以下字段记录：

| 字段 | 内容 |
|---|---|
| 身份 | 日期时间与时区、完整提交 SHA、未提交差异及输入摘要 |
| 环境 | OS/架构、Node/pnpm、浏览器或 runner 版本、合成环境标识 |
| 方法 | 完整命令、配置、用例范围、oracle 与明确排除范围 |
| 结果 | 退出码、通过/失败/跳过数、首轮失败和修复重跑分别列出 |
| 证据 | 日志/报告/manifest/截图/回执的可检查位置、摘要及保留边界 |
| 局限 | 缺少的合同、机器、授权、账号、预算或平台，以及下一项具体操作 |

状态用 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`；证据不足可用 `INCONCLUSIVE`，跳过用 `SKIPPED` 单列。不要把“用例存在”“曾在旧 SHA 通过”“当前文件没改”写成新输入已执行通过。

工作区临时日志随环境可能丢失。正式交付按 [AGENTS 的工作成果要求](../../AGENTS.md)与[产物合同](../../doc/AGENT-ARTIFACTS.md)提供可检查的 artifact/work product；报告避免仅保留另一个环境里的 `/tmp` 路径。仓库内只保存必要的脱敏结论和稳定引用，不提交凭据、原始客户日志或大量构建产物。

## 五、当前待测项与历史证据

统一从[剩余项](../../doc/mimouse/REMAINING.md)区分代码缺口、外部合同及真实环境前提；从[用户验收](../../doc/mimouse/USER-ACCEPTANCE.md)领取明确用例；从[审计与收据索引](../../doc/mimouse/checklists/README.md)、[本轮审计](../../doc/mimouse/checklists/2026-10-29-project-audit.md)及[历次验证记录](../../doc/mimouse/VERIFICATION.md)核对本次证据。[验收 CSV](../../doc/mimouse/checklists/ACCEPTANCE.csv)保留历史条目，不能直接作为当前 HEAD 的实时通过仪表盘。

稳定测试入口可能按清单逐文件启动并在首个失败时退出。`--dry-run` 只展示计划；把相同清单放进单次 Vitest、复用 transform 缓存的隔离 worker 诊断，是另一条命令。应分别记录实际执行文件、未执行文件、并发与 isolate 配置、通过/失败/跳过，以及运行中输入是否改变；不能把诊断的通过子集或后续单文件修复拼成原入口整轮通过。

重试与公司/会话隔离、私有数据授权、文档错误态/草稿、输入法/四语布局、真实供应商、六目标构建与签名上传、升级恢复等均按实际范围分别验证。不提供缺失合同的伪成功实现，不用大量单测覆盖尚未执行的一项真实用户旅程。
