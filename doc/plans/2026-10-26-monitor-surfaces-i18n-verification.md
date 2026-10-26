# 任务监测横幅与输入栏四语核验（2026-10-26）

真实入口：`IssueDetail` 挂载 `IssueMonitorBanner`（标题下）和 `IssueMonitorComposerStrip`（输入栏上）；同步补齐其检查操作成功/失败 toast。新增 `monitorSurfaceUi` 39键，未改最终 locales；时间显示复用前片 `issueMonitorUi`。

覆盖scheduled/retrying/due/overdue、工作区争用、账号池用量等待、GitHub待审查、检查按钮、取消确认/保留/pending/本地失败、服务名/次数/本地时间框架和输入栏提示。copy builder显式接收locale（默认en），不读取隐含语言来改变纯函数默认输出；hook把语言纳入memo依赖，避免只更新按钮而标题陈旧。

原source/state判定、倒计时频率、宽限、隐藏规则、workspace锁等待不提供Check now、取消只对monitor开放等行为不变。服务名、PR URL/标题、账号身份、未知诊断与服务器Error原文保持；只有非Error本地fallback保留翻译键并随语言更新。toast按事件发生时语言创建，不事后重写既有toast。

## 已执行

- 完整定向4文件103项通过：IssueMonitorBanner、monitor-surface-messages、monitor-display、issue-monitor。
- 真实宿主IssueDetail只筛选monitor：7项通过、138项未运行（skipped由筛选产生，不计通过），包含四语真实check API参数/成功与原错误toast、取消保持政策、旧任务迟到错误不污染新任务。
- 四语同一挂载横幅/输入栏的memo标题刷新、服务原名与诊断保留；取消确认保留/关闭、不自动提交、pending禁止重复、切语言保留错误状态；workspace/pool特例门禁。
- `check-token-gates.mjs`、`git diff --check`通过。均512MB/单worker，没有全量、重型类型/构建或真实网络执行。

在ui/：

```sh
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/components/IssueMonitorBanner.test.tsx src/i18n/monitor-surface-messages.test.ts src/i18n/monitor-display.test.ts src/lib/issue-monitor.test.tsx --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/pages/IssueDetail.test.tsx --maxWorkers=1 -t monitor
```

日志：`/tmp/monitor-surface-tests.log`、`/tmp/monitor-host-tests.log`、`/tmp/monitor-surface-tokens.log`。

## 待中央和真实手测

- [ ] 合成资源并--check，真实任务标题下与输入栏上切换四语，标题/元信息/取消确认同步；无raw key。
- [ ] scheduled/due/overdue、queued/running后隐藏、done/cancelled隐藏、workspace_busy与pool_wait、GitHub待审查；观察时序不因语言改变。
- [ ] 键盘/移动端/200%缩放、长西语日语、Escape/外部取消/后退前进；取消不误执行，焦点返回正确。
- [ ] 授权测试环境才检查真实Check now/取消请求及pending/拒绝/网络失败，不因翻译验收自动执行Agent。
- [ ] 中央完整类型/生产构建/宿主回归及CI。scheduled retry属性与卡片另片交付；enrollment本轮不扩展。
