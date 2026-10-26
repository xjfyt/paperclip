# 高级任务属性：Watchdog 四语核验（2026-10-26）

## 范围与真实入口

基线 `4d7b7a38039c4d5859a821bd7ac0f9c72c991e6f`。复用干净工作树并保留原分支；没有创建额外 worktree、安装依赖或改锁文件。

实际入口为 `App.tsx` 的 `issues/:issueId` → `IssueDetail` 的桌面属性面板/内联属性 → `components/IssueProperties.tsx` re-export → `issue-properties/IssueProperties.tsx`。属性标题 `Watchdog` 已经由 `PropertyRow/usePropertyLabels` 翻译，不是因为源码英文就算漏译。

本片只完成该入口中的 **Watchdog 属性编辑组**，新增 `issueWatchdogUi` 18 键 en/zh-CN/es/ja：停用标记、Agent 选择/搜索/空结果、可选指令标题与占位、子任务链接、保存/更新/移除及 pending 文案。共享 `InlineEntitySelector` 新增可选 `closeLabel`，此调用传入四语移动端关闭名称，其他调用保持原默认；搜索输入的 ARIA 名称使用调用方已有搜索占位语。

不翻译 Agent 名称、用户指令、任务标识、服务器诊断、模型输入、协议值和参数。不改变权限、执行门禁或状态逻辑。系统“不设置监控 Agent”选项同时保留英文搜索别名；同名真实 Agent 仍显示原名。指令仍仅执行原有 trim/空白转 null。

## 同次真实路由检查的剩余项

以下是有界审计发现，不是完整 UI 分母，也未在本片实现：

| 组 | 实际源/入口 | 已确认的残余示例 |
| --- | --- | --- |
| models | 同一 `IssueProperties` 的 `assigneeAdapterOptionsContent` | Default model、Thinking effort、Clear adapter options；模型 ID/供应商名应保留 |
| monitor | 同一 `IssueProperties` 的 `monitorContent` / 详情 | Next check、Check now、时间/倒计时框架；需要连同 `lib/issue-monitor.ts` 检查 |
| workspace | 同一 `IssueProperties` 的 workspace picker / runtime controls | New isolated workspace、Reuse existing workspace、runtime action toast；路径/分支/工作区名称应保留 |
| enrollment | `apps/connect` → `AppsConnect` → `features/connections/ConnectionSetupFlow.tsx` | enrollment 页面/弹窗、本地错误 fallback（如缺失 enrollment link、Cloud registration 检查失败） |

`pages/apps/Connections.tsx` 虽有英文 `CloudConnectorEnrollmentBanner`，但当前 `App.tsx` 将 `apps/connections` 重定向到 `apps`；不能把该旧页面当实际已挂载的 enrollment 入口。真实入口中的 session storage、授权 URL、access state、轮询与返回路径都不属于翻译值。

新任务创建、其他 watchdog 宿主、所有共享选择器调用方不在本片范围，不能从属性面板的通过推导为全部完成。

## 已执行验证

最终 **3 文件 142 项通过**，无失败/跳过；512 MB、单 worker，不跑全量/重型类型/构建。

在 `ui/` 中：

```sh
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/components/IssueProperties.test.tsx src/components/InlineEntitySelector.test.tsx src/i18n/issue-watchdog-messages.test.ts --maxWorkers=1
```

- 四语停用/表单/链接/ARIA；原 Agent 同名英文和自定义指令不翻译；href、agent ID、保存 trim/null payload 保持不变。
- 实际组件打开编辑器后切换四语，保留 textarea 节点、草稿和选中 Agent；关闭再打开才按既有行为恢复保存值，未发送 mutation。
- 四语无 Agent 禁止保存、创建成功参数、更新与移除 pending 文案、重复点击禁用、原服务器错误保留。
- selector 使用真实 Radix 的四语关闭路径，不改变选择或触发 onChange；原有焦点、Escape、滚动等整文件回归同时通过。
- 资源键/占位符/安全文本一致性；`check-token-gates.mjs`、`git diff --check` 通过。

日志：`/tmp/advanced-watchdog-final-tests.log`、`/tmp/advanced-watchdog-tokens.log`（工作区临时证据，不是用户可下载产物）。首次试跑因测试资源 import 尚未写入导致4项英文期待失败；补齐 test-only 注入后全文件重新执行，最终结果见上。没有修改产品文案迎合断言。

## 中央合成与手测清单（尚未执行）

本片未改生成的 `ui/src/i18n/locales/*.json`；测试 helper 注入只证明 contribution 与组件接线。中央 cherry-pick 后须运行 `node scripts/compose-mimouse-locales.mjs`，提交生成资源并执行 `--check`，再做实际资源和宿主回归。不得把本片结果视作当前发布构建已经含新词条。

- [ ] 合成后真实任务属性面板切换 en/zh-CN/es/ja：无 raw key/英文系统残余，用户名称/指令/标识不改写。
- [ ] 桌面 popover、内联面板、窄屏移动选择器和 200% 缩放：长西语/日语不遮挡保存/移除或指令；关闭标签可读。
- [ ] Tab/Shift+Tab、Enter/Space、Escape、点击外部关闭、返回触发器；浏览器后退/前进和关闭不提交。
- [ ] 选择器用本地译文和英文别名搜索空选项；输入实际中日 IME 时不提前提交；真实 Agent 的名称/搜索保持原样。
- [ ] 打开编辑器切语言不丢指令/选择；关闭再开恢复原值；无 Agent、无匹配 Agent、active/disabled 和带/不带子任务链接状态。
- [ ] 仅在授权测试环境做实际新增/更新/删除和 API 拒绝/超时，核验 pending 不重复请求、错误原文可见、跨语言 payload 一致。不要为语言验收自动唤醒/执行 Agent。
- [ ] 中央类型检查、生产构建、相关宿主回归及推送后 CI；本片未运行，不沿用之前全量数字。

## 中央集成补充（2026-10-26 23:28 UTC）

本片已合入mimouse并合成3506键四语资源；compose --check、3文件142项定向回归、完整UI类型与生产构建通过。没有本片新全UI/真实浏览器验收，不外推旧3312全量结果。
