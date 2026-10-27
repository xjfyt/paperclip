# MiMouse UI 分段验证与严格聚合

`node scripts/test-mimouse-ui.mjs` 默认仍按排序库存每批 10 个文件串行全跑。
`--list` 保留 `fileCount`、`batchCount`、`sourceSha256`、`batches`，另提供
`verificationInputs`（策略、SHA-256、输入文件清单）。批次编号从 **1** 开始，范围两端均包含。

```sh
# 先看实际库存；不要硬编码历史的文件数或最后批次号
node scripts/test-mimouse-ui.mjs --list
# 适合执行会话较短的环境：每次只跑少量完整批次
node scripts/test-mimouse-ui.mjs --batches 1:5
node scripts/test-mimouse-ui.mjs --batches 6:10
# 继续至 --list 给出的最后一批；保存每次打印的 manifest 路径
node scripts/test-mimouse-ui.mjs --aggregate \
  test-results/mimouse-ui/run-<first>/manifest.json \
  test-results/mimouse-ui/run-<next>/manifest.json
```

最后一个命令只是语法示例：**必须提供覆盖全库存的全部 manifest**，否则非零退出。
显式范围越界、倒序、未知参数、空库存均拒绝。每次运行/聚合使用新的随机后缀目录，
不覆盖旧证据，不自动接着写旧 manifest，也不把旧 v1 日志“升级”为通过。

## 中断恢复和通过条件

每个批次启动前原子写入 `running`，结束后写入文件清单、时间、退出码/信号、
输入摘要前后值、日志及 JSON 报告 SHA-256、实际文件/断言计数。整个范围完成且
所有批次通过后，manifest 才标记 `passed`；失败立即停止，未执行批次不算通过。

## 精确文件选择

Vitest 位置参数是**不区分大小写的子串过滤器**，不能把传入完整相对文件名当作
精确选择。例如某批末尾的 `AttentionInteractionResolver.test.ts` 会同时命中下一批
的 `AttentionInteractionResolver.test.tsx`。历史上两文件恰在同批而通过，并不能证明
跨批选择正确。

runner 按完整库存重算每批的误命中文件，只对不属于该批的碰撞文件传入额外
`--exclude=<精确转义的相对路径 glob>`；不生成替代配置，不覆盖原
`ui/vitest.config.ts` 的 setup、aliases、插件或已有 exclusions。
glob 元字符按字面转义，排除只作用于该次子进程；文件到自己的批次仍须执行。
若未来 Vitest 选择行为改变或出现库存外的误命中，严格报告库存校验仍会拒绝通过。

`runner.selection` 记录策略版本和所有批次的排除列表；
每批 `selection` 记录策略、实际 filters 和 exclude globs。聚合器从当前库存重算，
拒绝缺失、额外或被篡改的选择证据，不仅相信 manifest 自报内容。
修复前的 v2 runner 身份/命令和输入摘要不同，**不能与新证据混合聚合或手工升级**；
应冻结最终代码后重新建立全量证据。

在 2026-10-27 的库存中，可用以下命令分别复验第 7 批（只排除上述 tsx）
和第 8 批（tsx 必须正常执行）；先 `--list` 确认当前批次边界未变化：

```sh
node scripts/test-mimouse-ui.mjs --batches 7:7
node scripts/test-mimouse-ui.mjs --batches 8:8
```

## 中断与聚合

会话中断留下的 `running`/不完整 manifest **不能参加聚合**，即使其中前几个批次
成功。先确认自己启动的旧测试已不再运行，再重新运行该短范围，使用新的证据目录。
保留旧日志用于故障分析，不编辑状态或拼接历史日志来声称成功。

聚合器要求：原生 v2、整个范围完成、每批退出 0 且无信号/进程错误、
报告实际文件与计划文件精确一致、所有断言 passed、无 skip/pending/todo 或空文件；
日志/报告哈希一致；库存与当前工作树一致；全部批次恰好一次，无遗漏/重复；
各分段及当前工作树输入摘要和 runner 身份/命令一致。聚合完成前再次检查输入。
失败或 incomplete 数据不会产生成功聚合报告。

仅 Vitest 退出 0 不够：缺报告、少跑文件、跳过断言、空测试文件均拒绝。
这是验证工具的证据约束，不改应用测试、不删除断言，也不把 skip 转成 pass。
JSON 报告与日志属于本地可审查证据，不是防恶意篡改的签名证明。

## 源码一致性的边界

`sourceSha256` 保留 UI `src` 的旧兼容用途，**不能单独证明分段同源**。
新的 `verificationInputs.sha256` 按相对路径和实际文件字节计算，覆盖：

- `ui` 全树（源文件、配置、setup、public/font 资源及其 NOTICE）；
- `packages`（包括 shared、adapter 源及本地 dist）、`external-adapters`；
- `server`、`cli`、`scripts`（包括本工具及其测试）、`patches`、`tests`、`skills`、`integrations`；
- 根目录非 Markdown/文本文件（包括 package、lock、workspace、tsconfig、Vitest 和 dot 配置）；
- `doc`、`docs`、`design`、`announcements`、`releases`、`tools`、`docker` 下非 md/mdx/txt 文件。
  例如 UI contract 实际读取的 `doc/plans/chat-adapters/*.mjs` 也纳入。

普通进度文档不属于执行输入，不因更新进度 Markdown 造成应用漂移。
输入树内其他 Markdown 不统一排除，避免遗漏运行时资源。新增测试若读取此前不在
该范围的文件，应先扩展输入策略并补回归测试，再建立新证据；不要复用旧摘要。

排除 `.git`、`node_modules`、Rust `target`、`.cache`、coverage、测试报告、
预览/storybook 构建目录和 `.tsbuildinfo`；UI `dist` 不参与测试库存发现，但仍纳入
输入摘要。除显式排除目录外，遇到输入符号链接会拒绝，避免静默漏掉源或资源。

本工具记录 Node 版本/平台/架构、Vitest 包版本和 CLI 入口文件摘要，运行实际命令为
`node node_modules/vitest/vitest.mjs run --maxWorkers=1 --pool=forks --reporter=json --outputFile=... <files>`，
其中 files 前还会插入该批的 `--exclude=<glob>` 参数（没有碰撞则不插入）。
不再通过旧版 `pnpm exec vitest` 包装层。每批 300 秒超时只向本工具直接创建的
Vitest 子进程发送 SIGKILL，不扫描/杀任意 PID 或进程组；不保证清理其全部后代。
超时/信号均失败，不能推断测试已完成。

**不认证整个安装目录、Node 二进制、任意宿主环境变量或外部服务状态**；
安装/环境必须由操作者保持可信且一致。前后指纹检查也不等于连续文件系统监控，
无法证明运行中先改后恢复的瞬态变化。执行期间应冻结代码和相关资源。

## 报告措辞与本工具测试点

- 一条默认调用完整成功：可说“该次无中断 UI 全量运行通过”，附其 manifest。
- 多个范围聚合成功：只说“同输入/runner 的分片聚合覆盖全量库存通过”，附 aggregate.json；
  **不能说一次无中断全跑通过**。聚合结果类型固定为 `aggregate-coverage-not-uninterrupted-run`。
- 单个范围通过：只能声称该范围验证；全量严格聚合未成功前不得声称全量通过。
- 历史 v1 中断 + 人工补跑：保留历史描述，不自动转换为本工具 v2 的通过结论。

```sh
node --test scripts/test-mimouse-ui.test.mjs
# 最小真实 smoke，仍需按当时库存确认范围
node scripts/test-mimouse-ui.mjs --batches 1:1
```

Node 内建测试在临时目录运行受控假 Vitest CLI，不安装依赖、不改共享安装目录。
假 CLI 从文件系统发现测试并模拟 Vitest 子串过滤，不把位置参数直接回显为选集；
覆盖跨批 ts/tsx 碰撞及后批正常执行、大小写和 glob 转义、忽略排除时仍失败、
批次与 runner 选择证据篡改拒绝。
覆盖默认/list/合法范围与错误参数、精确选批、正常全跑及分片聚合、唯一目录、
缺批/重复/顺序/文件库存、v1/未完成/失败、非零退出、缺报告、skip/todo/空断言、
源码/配置/shared/adapter/runner/lock/patch/实际资源漂移、日志报告篡改及输入 symlink。
真实小批次 smoke 证明与本机 Vitest 报告格式兼容，不代表重新完成整套 UI 验证。
