# 任务 Monitor 属性四语核验（2026-10-26）

范围：真实任务详情 → `IssueProperties` 的 Monitor 行、详情 tooltip 和编辑器。新增独立 `issueMonitorUi` 27键；未改生成 locales。scheduled retry、详情页独立 monitor banner 与 enrollment 不包含在本片。

补齐已清除/即将检查/逾期/尝试次数、相对时长、Today、详情标签、检查/编辑/清除、表单占位与ARIA。日期显式使用界面语言，保留原时区和日期比较；原通用格式化函数只增加可选 `todayLabel`，未传时仍为原英语。显示 helper 保留原英语行为，其它三语的秒/分/小时/天格式化只用于显示。原 `formatMonitorEta` due/overdue 判断、60秒宽限、countdown cadence、定时协议和调度行为不改。

不翻译原服务名、备注、状态/清除原因、board、external_service或其它机器值。保存仍按原规则 trim 并转 ISO，清除仍保留 reviewer/approver/maxReviewRounds 等政策，切语言不自动保存。

## 已执行

**4文件223项通过**，512 MB/单worker，未运行全量、重型类型或构建：

```sh
cd ui
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/components/IssueProperties.test.tsx src/lib/issue-monitor.test.tsx src/i18n/issue-monitor-messages.test.ts src/i18n/monitor-display.test.ts --maxWorkers=1
```

- 四语编辑器、显示ARIA、due/overdue/cleared行；原备注和服务名保持原样。
- 同一打开表单切语言，输入节点/时间/草稿不变；保存的ISO、原协议值和清除后的最大审查轮数保持不变。
- 四语显示时长的秒/分钟/小时/天边界、正向/0/负59.999秒/负60秒、时区跨日Today及非法日期；原调度状态/倒计时/时间测试全文件同时通过。
- contribution键/占位/安全检查、`check-token-gates.mjs`、`git diff --check`通过。

日志 `/tmp/advanced-monitor-tests.log`、`/tmp/advanced-monitor-tokens.log`。以上为单元/jsdom，不是浏览器端到端或真实调度证据。

## 待中央及浏览器核验

- [ ] compose + --check 后实际任务详情四语，tooltip和编辑器无raw key；其它Monitor宿主不由本片推导。
- [ ] 鼠标/键盘打开详情，Check now pending、编辑、清除；禁止因语言验收自动触发实际Agent。
- [ ] 定时检查将来/到期/超时/已清除/空状态；切语言、跨午夜、时区、12/24小时显示；时间点/宽限和轮询不受影响。
- [ ] 备注/服务名实际中日IME、外部点击/Escape关闭、重开、后退前进；未保存草稿遵循原行为，关闭不执行请求。
- [ ] 手机、200%缩放和长西语/日语tooltip及表单不遮挡；授权测试环境再检查保存/清除payload和API拒绝反馈。
- [ ] 中央完整类型、生产构建、相关宿主回归和CI。本片不沿用上一快照全量数字。
