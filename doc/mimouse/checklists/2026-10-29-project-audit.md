# 二开项目文档、代码与验证审计

> **维护提示** — 本页记录 2026-10-29 Windows 工作树的一轮检查；最终结果以本页命令和输入边界解读，历史结果不迁移。
> **对应代码** — 根构建/测试脚本、`server/src/services/mimouse-*`、`tests/mimouse/`、中文文档入口。
> **核对基点** — `5ccd4ef014d1dc4101327985fde8cd6203b44dec` 加本次未提交补丁；不是该 SHA 的干净发行包。

## 一、结论与范围

当前具备较完整的二开控制面和受控验证基础，但尚不满足全部真实业务与发布验收。此轮发现并修复了 GitLab 回执处理、Windows 构建/测试可移植性及文档入口问题。四项外部合同相关实现缺口仍存在，不能仅解释成“等用户测试”。

采用 3 个子 Agent 分别推进文档、代码和实际验证，主 Agent 整合工具链、根级检查及本报告。范围聚焦本 fork 的 MiMouse 二开、近期恢复与国际化、开发验证链；没有逐行审计全部上游源码，也没有执行真实账号/收费模型、外发通知或生产变更。

环境：Windows x64，Node `v24.16.0`，pnpm `9.15.4`。真实浏览器为本机 Edge。原有 `pnpm-lock.yaml` 的 77 行新增/1 行删除属于开始前工作树差异，未作为本轮修复提交或覆盖。没有 commit、push、MR 合并或发布。

## 二、已确认问题与修复

| 级别 | 问题及影响 | 本次处理 |
|---|---|---|
| P1 | GitLab 成功响应头之后流读取失败，原始错误逸出且写请求失去结果未知标记 | 保留 `uncertain`，返回固定安全错误码，不将网络诊断直接作为业务回执 |
| P1 | 无效 `x-next-page` 被当作分页结束，不完整 MR 列表可能参与重复创建决策 | 非法、回退、越界和不安全整数页号拒绝；保留合法分页及空/缺失/0 结束行为 |
| P1 | 普通反馈导入、运营快照创建与审批绑定缺少活动日志 | 三条变更与内容最小化审计置于同一事务；重复请求不重复审计，提交后才发布事件；真实 PG 故障回归确认审计失败会回滚 |
| P1 | Windows 默认 cmd 无法执行 shared、DB、server、Codex/Grok、CLI 构建里的 `mkdir -p`/`cp`/`chmod` | 主构建资源复制改用 Node 文件 API，保留迁移 SQL/journal、许可证、隐藏资源、Runner 和适配器辅助资产 |
| P1 | `pnpm test:run` 的子进程 `spawnSync("pnpm")` 在 Windows 报 ENOENT，实际无法开始测试 | 直接用当前 Node 启动已安装 Vitest 的 JS 入口，不经 shell 拼接；保留参数及失败退出码 |
| P2 | CRLF 导致 token 白名单读入 0 项，产生 109 条误报；生成 palette/character 比较同样误报 | 按语义处理 CRLF，正反例确认真实违规和内容漂移仍失败；现读入 33 项白名单 |
| P1 | Windows 检出换行导致 Runner 原始字节摘要和清单漂移 | `.gitattributes` 固定 Runner 文本 LF，未重生成或放宽协议摘要；原清单重新匹配。catalog 源资源同样固定 LF，避免内容身份随 OS 变化 |
| P2 | Runner 工作流检查将 `C:` 绝对路径直接动态 import，Node ESM 拒绝 | `pathToFileURL` 转换后保留原追踪验证，44 findings/12 workflows 校验通过 |
| P2 | 多个测试夹具依赖 Unix 路径：UI 假 Vitest 路径、Git shell 路径、`/tmp`、Node ESM 导入 | 按实际复现分别修复；保留严格聚合、文件身份、授权及失败断言，不批量放宽平台检查 |
| P2 | Claude 私有提示词测试把类型扩为 `unknown` 后作为动态键，阻断工作区类型检查 | 泛型保留输入形状，工作目录使用该测试自己的隔离目录 |
| P2 | Windows embedded PG 强制退出留下 pid 文件，严格夹具 teardown 失败 | 仅对本轮构建观测测试夹具使用同包的 `pg_ctl.exe` 优雅停止；保留目录/marker/PID 所有权检查 |
| P2 | README 是上游营销与安装入口，读者难以定位二开事实；AGENTS 仍称 PGlite 并给出错误重置路径 | 新建中文编号导航/规范/开发与验证文档；修正 embedded PostgreSQL 与隔离启动说明，保留上游 MIT 归属 |
| P2 | 英文站点 GitHub 组织拼写错误、两处导航重复 | 修正 URL 并去重；中文仓库文档尚未宣称完成站点预览或全量格式迁移 |

上述 P1/P2 是本轮修复优先级，不是漏洞披露等级。具体工作树差异是复核依据。

## 三、本轮验证证据

各行独立计数，存在重叠，不能相加称为全仓用例总数。未列为 PASS 的检查不得据此推断通过。本轮真实浏览器/API 的脱敏计数、日志摘要和四语截图摘要另存[机器证据](2026-10-29-project-audit-evidence.json)，详细失败与复验过程见[Windows 验证记录](2026-10-29-project-audit-verification.md)。

| 检查 | 本轮结果 | 证据与边界 |
|---|---|---|
| `pnpm -r typecheck` | PASS，含最终审计补丁 | `test-results/project-audit-20261029/typecheck-final.log`，35/36 工作区递归检查退出 0；首次 shared shell 错误和随后 Claude TS2464 失败保留在前两份日志 |
| 标准 server build | PASS | `test-results/project-audit/server-build-esm-fixed.log`，含完整 Runner Rust release、server tsc、资源与 stamp；18 条 Rust lib/1 条 bin warning 保留。stamp 为基点 SHA，但实际包括未提交补丁 |
| 标准 UI build | PASS | `test-results/project-audit/ui-build.log`；保留 Vite、大 chunk 和动态导入提示 |
| `pnpm check:token-gates` | PASS | `test-results/project-audit-20261029/token-gates-fixed.log`；1379 文件、33 项既有白名单、四项 gate clean；未添加例外隐藏违规 |
| 原生工具与文档检查器回归 | PASS，33/33 | `node --test scripts/windows-build-gates.test.mjs scripts/test-mimouse-ui.test.mjs scripts/check-project-docs.test.mjs`；`test-results/project-audit-20261029/portable-tooling-docs.log`。包括 CRLF、内容漂移、真实违规拒绝、资源字节、严格 UI 聚合、无 pnpm executable 的启动/失败传播及文档正反例；早一版未包含 7 项文档测试的 26 项结果独立留存 |
| `pnpm docs:check` | PASS，限定中文入口 | 7 文件的编号/标题/维护信息和相对链接/锚点检查；日志 `test-results/project-audit-20261029/docs-check.log`。不代表既有上游全部文档格式或内容已通过 |
| 稳定分片工具回归 | PASS，32/32 | `scripts/__tests__/run-vitest-stable-shard.test.mjs`；与早一版 7 项构建门禁一起运行的日志为 `windows-build-gates-final.log`，共 39 项。不是 39 个新增用例 |
| GitLab/文件/Git/构建矩阵/观测器定向 | PASS，133；SKIPPED，2 | 5 文件定向回归；两项是 Unix FIFO/NOFOLLOW 专用测试，在 Windows 跳过，不算通过 |
| 授权交付分页真实隔离 PG | PASS，10/10，含 teardown | 修复 fixture 后独立重跑，不与上行伪称一次执行 |
| Claude 私有提示词专项 | PASS，12/12 | 该包 typecheck/build 另通过；没有真实 Claude/付费调用 |
| 反馈/运营事务审计 | PASS，29/29 | 新增 7 项真实 PG 回归先在旧代码全部失败，修复后与既有单测共 3 文件 29 项通过，无跳过；覆盖并发幂等、公司隔离、内容最小化、审计失败回滚/无提前发布及通知 savepoint |
| DB、CLI、Codex、Grok build | PASS | Windows 实际执行；适配器 3 个源/目标辅助资产逐字节一致 |
| Edge + 源码 server + 隔离库 | PASS，7/7 | `test-results/project-audit/browser-source.log`；4 语关键路径及 3 项基础 HTTP/DB，47.4 秒；不代表编译入口或供应商验收 |
| Edge + 最终编译 server + 相关 API | PASS，11/11，零失败/跳过 | `test-results/project-audit/final-api-browser.log`；反馈导入 3 项、运营预演 4 项、四语浏览器 4 项，1.2 分钟；使用最终根构建后的入口，仍有 workspace TS 消费，不是 all-dist 包 |
| 根 `pnpm build` | PASS，含最终审计补丁 | `test-results/project-audit-20261029/build-final.log` 整链退出 0；首轮 protocol-manifest 失败留在 `build.log`，中间通过见 `build-fixed.log`。生成 catalog 的仅时间戳变化在核验内容身份不变后清除，没有覆盖业务变更 |
| 根 `pnpm test:run` | INCONCLUSIVE，主动结束，非整体通过 | 首次 ENOENT 已修。复跑从本地 23:13 至 23:32，在 general-server 中完成了持续执行但未产出完整汇总，进入 native warm remote/Unix 命令夹具；本轮有界审查结束后核对进程归属并停止，没有伪造通过/失败计数。日志 `test-run-fixed.log` 和 `test-run-cancellation.json` 保留；最后已核对该轮 launcher、worker、PG 及后代退出，未删除夹具或 pid 文件。后续需在适配环境完整执行 |

原始日志位于当前机器被 Git 忽略的 `test-results/`；这里给出的是可复查的工作区证据位置，不保证另一克隆存在。历史文档中的 `/tmp/*.log` 未在本机恢复，不能以历史数字代替此次执行。当前会话没有 Paperclip 任务上传上下文，本报告作为仓库维护文档保存，没有伪称已上传附件或创建 work product。

## 四、未完成项分组

### 1、仍有实现缺口，须先交接合同

| 范围 | 当前代码事实 | 下一步 |
|---|---|---|
| 六目标 Runner/controller/签名准入 | `mimouse-coding/build-matrix.ts` 固定 `runner_evidence_missing`/blocked；精确 job 字节观测和声明验证已有实现，admission 仍 blocked | 提供每格 Runner、可信 controller、工作流闭包、平台/测试/签名规则，再实现完整准入 |
| 内部产物上传 | `upload_contract_missing`；artifacts 路由只保存本地 manifest，`uploaded=false` | 实现上传、状态查询和确认适配，覆盖超时未知、冲突及重复请求 |
| 业务读取 | shared 要求调用者提供 `sourceRecords/targetRecords`；服务保存 `inputSnapshot` | 按只读源的字段、主键、分页、水位、删除与迟到规则实现读取适配 |
| 业务 apply/持久执行/对账 | `write_adapter_not_implemented`、`dry_run_only`、`writesSupported=false`；无 apply/write route；reconciliation 是未接执行器的纯计算 helper | 按逐操作授权和幂等、恢复、未知状态、对账及补偿规则实现持久闭环 |

逐项待填信息见[联调交接清单](../contracts/integration-handoff.md)。没有外部合同的部分保持明确阻断，不发明接口、签名信任或业务写入权限。

### 2、已有代码，仍缺真实环境证据

Casdoor 实际租户和两个测试身份、Qoder/WorkBuddy 真实账号任务与额度、通知指定收件端及送达、真实 GitLab 多项目/Runner、Langfuse/企微来源、受控 Claude profile 效果与费用，均需各自 C3/C4 回执。源码/替身/本地数据库通过不升级这些等级。

四语本地关键页面现可在 Windows Edge 复验；全站动态文案、所有复杂页面、真实中文/日文 OS 输入法、移动布局以及 Windows/macOS/Linux × 两架构仍未全量验收。现有 7294 键和历史 12940 项不是全站翻译覆盖率。

独立 all-dist 安装包、既有数据升级/恢复、最终发布包和线上环境仍须分别验证。Windows Playwright 测试退出后的 PG 子进程残留已有本轮观察，按精确归属清理，不等于生产数据库生命周期问题已全面修复。

首轮编译入口 API 与浏览器集合实际 **156 通过、12 失败**，不得写为完整通过：11 项技能恢复相关失败首先发生在长临时路径的夹具准备，1 项 Qoder 运行停在 queued。短路径复验现有 POSIX 合同后，Windows 明确不支持的 10 项成功/并发恢复用例条件跳过，新增 Windows 拒绝无副作用和跨平台 ACL 检查通过；加四语浏览器共 **6 通过、10 跳过**，不视作 Windows 已支持整树恢复。

Qoder 另有本地平台缺口：适配器 README 明确 Windows 未 qualified；`groupIsStopped()` 在 Windows 返回 false，而成功要求已确认进程组停止。首轮安装成功后的 `harness_test_failed` 和 queued 尚未闭合，`wslpath` 警告有回退且安装已 201，不能误认其为根因。没有放宽停止证据使其成功。

### 3、持续质量与文档债务

- fork 的 `mimouse` 直接 push 原来只运行资源 CI；本轮增加 Ubuntu/Windows 原生工具回归，但它仍不是完整 typecheck/build/Vitest/MiMouse API gate。
- PR workflow 调用上游 `@master` 的 reusable workflow，本地文件不能证明实际远端版本和运行状态；repository gate 限制的是 AWS Runner，会回落 GitHub Runner，不能误写成所有 fork CI 被阻断。专用 `tests/mimouse` 不会被上游 E2E 自动覆盖。
- 中文入口已按 MiWork 标准落地，既有 `doc/`、英文站点与历史证据尚未逐页转换。保留合同路径和回链，后续按主题分离稳定行为与日期快照。
- 已提交锁文件的 server importer 缺少已有 `paperclip-eval-kernel` workspace 声明；当前运行使用用户开始前的本地锁文件修订，干净冻结安装仍有同步债务。本轮未改用户锁文件或以重新解析依赖冒充冻结安装通过。
- 通过数、静态候选数和翻译键数不足以衡量需求完成率；继续使用稳定需求 ID、实际路径和明确 oracle。

## 五、后续推进顺序

1. 先完成本轮可复现修复的构建、类型和相关回归，保留真实失败/跳过结果。
2. 将无外部凭据的专用 API、源码回归与文档检查逐步纳入 fork 自有 CI；远端 required checks 单独核对。
3. 按原稳定需求与实际入口完成四语、输入法、升级恢复、安装包验收，每条留当前输入证据。
4. 四项外部合同按交接清单收齐后，各自开发适配并做故障/未知回执验证，再安排真实账号 C3/C4。

本轮是审查与修复结果，不是完整计划、全部上游功能或生产就绪的证明。
