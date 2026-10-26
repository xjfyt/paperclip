# 任务模型属性四语核验（2026-10-26）

范围：真实 `issues/:issueId` → `IssueDetail` → `IssueProperties` 的模型覆盖属性，承接 watchdog 切片。新增独立 `issueModelUi` 26键，未修改生成 locales。

已补模型来源/主模型/覆盖摘要及说明、默认模型与搜索空态、思考强度、Chrome 开关与ARIA、不兼容/未选择 Agent 的提示和清除操作。属性标题保留 `data-property-label="Model"` 钩子，仅显示翻译。已知思考强度按固定值翻译，英文摘要统一使用按钮的 High 等显示标签；未知未来值原样保留。真实模型名称、模型ID、Agent 名称、Chrome 和 --chrome 技术值不翻译，primary/custom、各适配器思考字段和值、其它覆盖配置保持不变。系统默认模型同时支持本地译文及英文搜索，真实同名模型保持原文。

## 定向验证

最终3文件150项通过，单worker/512 MB：

```sh
cd ui
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/components/IssueProperties.test.tsx src/i18n/issue-model-messages.test.ts src/lib/codex-reasoning-effort.test.ts --maxWorkers=1
```

四语 × Codex/Claude/OpenCode 的模型选择、思考强度与原字段、Chrome配置、primary清空回调；同名 Default model 的真实模型身份、原始ID/自定义配置保留；未匹配搜索与默认搜索别名；四语不兼容适配器、未知 effort 与打开弹层语言切换不自动保存。原有 Astra effort 兼容性回归同跑。测试最初发现夹具等待了覆盖值却未等待Agent查询，修正等待条件后重跑全文件；未修改产品逻辑迎合测试。

`check-token-gates.mjs` 和 `git diff --check` 通过。日志 `/tmp/advanced-model-tests.log`、`/tmp/advanced-model-tokens.log`。以上为单元/jsdom证据，不是浏览器、真实模型执行或完整类型/构建/CI证据。

## 待中央集成及真实手测

- [ ] 中央 compose + --check 后，用实际资源确认模型属性四语，未出现raw key；模型名/ID不改变。
- [ ] 使用有覆盖配置、仅继承配置、无负责人、不支持适配器、未知历史effort的安全测试任务；只读检查不触发模型执行。
- [ ] 选择器本地/英文默认搜索、真实同名模型、未匹配结果；切语言不改变选择/查询/未保存任务内容。
- [ ] Tab/Enter/Space、Escape/外部关闭/重开、移动端关闭、后退前进；取消不保存，ARIA同步语言。
- [ ] 窄屏、200%缩放和长西语/日语可读；仅授权测试环境校验模型/effort/Chrome/恢复primary的实际payload。
- [ ] 中央类型检查/生产构建/相关宿主回归及CI。monitor、workspace和enrollment仍是独立未完成切片。
