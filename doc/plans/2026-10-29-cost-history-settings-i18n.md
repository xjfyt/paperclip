# 成本历史及模型设置四语重建核验（2026-10-29）

## 实际范围

- `Costs.tsx:760–761` 消费 `FastResponseHistory` / `DecisionHistory`，共用 `DecisionHistoryTable`。
- `CompanySettings.tsx:373` 的 General 分支消费 `DecisionModelSettingsSection`。
- `CompanyConnections.tsx:40/42` 消费两个设置 Section；现有实验开关与管理权限判断未改变。
- 本片没有改上述父页面、其他成本/预算卡、API、查询键、请求日期边界或后台轮询条件。
- 四语贡献：`costHistoryUi` 45 键、`decisionSettingsUi` 40 键、`fastResponseSettingsUi` 30 键。运行时 `locales/*.json` 由中央整合生成，不随本 worktree 修改。

## 显示来源与边界

- 系统表头、加载/失败/重试/空态、配置入口、已知请求/发布/成本状态、设置说明及本地测试反馈翻译成 en/zh-CN/es/ja。
- 未知状态、功能标识、模型/供应商标识、连接名、用户名称、任务标识、未知答案字段/选项、外部错误诊断、模型输出原样作为 React 文本显示，不按内容推测翻译，也不解析 HTML。
- 既有 `errorCode.replaceAll("_", " ")` 已去除，以保留诊断代码原文。
- 只有显示层调用 Intl：日期、时长、令牌数、比例、评分及现有详细金额 helper。费用仍为 USD，API cents、未知 `null`、明确零费用与不足一美分费用未改写；估算/报告来源保持区分。
- 已挂载语言切换不进入 query key、draft effect 或配置修订号，不触发读/写/测试。现有 query interval 仍可正常轮询，不能把“不因语言重复请求”理解为停用轮询。

## 本 worktree 定向验证

所有请求均使用本地 mock，未运行模型、建立连接、读取真实账户或产生费用。

```sh
source /tmp/paperclip-env.sh
cd ui
NODE_OPTIONS=--max-old-space-size=640 node ../node_modules/vitest/vitest.mjs run \
  src/components/decision-models/DecisionHistory.test.tsx \
  src/components/decision-models/DecisionHistory.i18n.test.tsx \
  src/components/fast-responses/FastResponseHistory.i18n.test.tsx \
  src/components/decision-models/DecisionModelSettings.test.tsx \
  src/components/decision-models/DecisionModelSettings.i18n.test.tsx \
  src/components/fast-responses/FastResponseSettings.test.tsx \
  src/components/fast-responses/FastResponseSettings.i18n.test.tsx \
  --maxWorkers=1
```

- 已完成第一片：DecisionHistory 两文件 13 项通过；第二片：FastResponseHistory 一文件 9 项通过。
- 决策设置两文件 19 项通过；快速响应设置两文件 19 项通过。测试覆盖四语空态/权限/保存与测试禁用状态、设置与模型列表读取失败、原始输出和模型 ID、打开对话框时切语言保留草稿及明确操作原 payload。
- 历史术语已与 Costs tab 统一为中文“快速响应”和日语“高速応答”；最终历史三文件 22 项复验通过（`/tmp/cost-history-terminology-tests.log`）。最终定向分母共 7 文件 60 项通过，不重复累加早期分片的同一测试。
- 日志：`/tmp/cost-decision-history-tests.log`、`/tmp/cost-fast-history-tests.log`、`/tmp/cost-decision-settings-tests.log`、`/tmp/cost-fast-settings-tests.log`（执行环境临时日志，不是独立持久交付）。
- 纯 Node 检查：四语键集/插值/数字链接槽一致、token gates、forbidden tokens 和 `git diff --check` 通过；6 个本域 TSX 文件 esbuild 语法转换通过，不等于完整类型检查。
- 复用 `collectAudit` 对四个生产文件检查：固定文案候选 0，动态候选分别为 16/8/0/5。已人工复核来源；该静态分母不包含子组件内部、父页面其他分支或完整运行时数据流，不能视为全站四语完成率。

## 中央整合及用户手测

- 合入后统一 compose / `--check`，随后运行整合类型、构建、完整聚合与实际入口验证。本片没有运行全仓类型或构建。
- 用合成/可撤销的测试数据在四语检查成本两个 tab：选择日期、切换语言，筛选边界和列表内容不变；加载/读取失败不能被画成空列表；手动重试只重读当前时间窗。
- 核对 unknown、明确零、sub-cent、estimated/reported，不能把未知显示为免费；供应商和用户文本必须保持原样。
- 在两个设置页选择连接、修改 model / sponsor 开关并打开新增连接对话框，再切四语：草稿、当前连接、已选 provider 与展开状态保持；没有自动保存或运行收费测试。
- 长文、窄屏、焦点、屏幕阅读器及真实供应商效果仍需独立验证。自动化设置测试仅隔离 ConnectionSetupFlow 外部连接内部流程，不承诺实际认证成功。
