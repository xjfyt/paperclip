# 任务恢复卡片四语核验（2026-10-26）

## 范围与接入证据

- 发布基线：`6eb9e457bbc0e59b142cc922f3c2c26f1e7a2d57`。
- 真实入口：`IssueDetail` → `IssueChatThread` → `IssueRecoveryActionCard`；运行页面另经 `RunWorkspaceRecoverySurface` 复用卡片。
- 新增 `issueRecoveryUi` contributions：en、zh-CN、es、ja。只翻译本地系统文案：状态、标题、元数据、空负责人提示、重试说明、诊断框架、操作与安全确认、ARIA。另补 `RunWorkspaceRecoverySurface` 的标题、事件 toast 与本地错误兜底。
- 事件 toast 保留创建时语言，切换语言不会重新翻译已存在的 toast；未声称整条运行恢复流程全部四语。隔离任务创建的持久化 title/description（Agent 输入）保持原样。
- 原样保留外部诊断、证据、nextAction、名称、ID、分支/SHA、路径、操作理由、请求参数和机器状态。`<timestamp>` 是救援分支示例的技术占位符，Paperclip 为品牌名，均保留。
- 不修改执行/重试/唤醒、权限、预算或收费确认、批量操作、对话状态逻辑。卡片无可搜索的选择器；“未分配”是展示提示，不新增选择器或按显示名称推断身份。
- 相对重试的既有 `now`/过期/运行中判断保留；分钟文案四语化。非英语超过一小时的时间显示采用所选语言的日期时间，英语保留原紧凑相对时间。绝对时间 tooltip 同步所选语言。
- 本分支未手改/提交生成的 `ui/src/i18n/locales/*.json`；中央集成需运行 `node scripts/compose-mimouse-locales.mjs` 并提交生成输出，随后 `--check`。

## 已执行的轻量验证

最终定向结果：5 个测试文件，149 项通过（单 worker、512 MB）。

绝对 Node：`/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`。

在 `ui/` 中运行（不安装、不改 node_modules）：

```sh
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/components/IssueRecoveryActionCard.test.tsx src/i18n/issue-recovery-messages.test.ts src/components/IssueBlockedNotice.test.tsx src/components/RunWorkspaceRecoverySurface.test.tsx src/lib/recovery-lineage.test.ts --maxWorkers=1
```

- 四语实际组件：操作/确认说明、空负责人、状态与 ARIA、已解决结果、计划/错过重试、开放确认与 memoized 标题语言切换。
- 运行页宿主四语修复成功 toast、事件语言边界，以及隔离任务 create 全字段参数保持一致。
- 原始诊断、用户 nextAction、同名 `Board` Agent 不被翻译；resolve outcome、隔离任务参数、trim 后人工理由保持一致。
- 现有权限和 pending 门禁回归；空白理由拒绝、pending 重复点击不重复触发、Escape 关闭确认不触发动作。
- contributions 键/占位符/安全文本一致性；相邻恢复宿主与纯 lineage 测试。
- `node scripts/check-token-gates.mjs` 和 `git diff --check`。

以上是 jsdom/单元测试，不是浏览器端到端、真实请求、真实模型、全量 typecheck/build 或 CI 通过证明。

## 待用户/中央集成手测（均未执行）

- [ ] compose 后，从真实任务失败卡片进入，逐一切换 en/zh-CN/es/ja，无 raw translation key、陈旧标题或英文系统文案；原诊断和用户内容保持原文。
- [ ] 在任务线程及 Agent 运行页检查 full/compact 两种卡片；窄屏、长西语/日语、200% 缩放时按钮与弹层可读，无截断关键安全提示。
- [ ] 用键盘 Tab/Shift+Tab/Enter/Space 打开、导航和确认；Escape/点击外部取消、焦点返回触发器。原卡片没有单独 Cancel 按钮，本次未新增。浏览器后退/前进不提交操作。
- [ ] 不具权限时不出现紧急覆盖/误报操作；无工作区隔离权限时不出现隔离任务操作。
- [ ] 确认框打开时切语言，理由文本、分支/SHA 与人工输入不丢失；关闭再打开遵循既有行为。
- [ ] 仅在获授权的安全测试环境执行实际恢复：各操作 payload 和原始机器码不随语言变化，pending 时重复点击不重复请求；人为模拟 API 拒绝/超时/网络失败后，宿主错误反馈清楚且无意外状态迁移。
- [ ] 核验无人负责、原负责人自行重试、独立恢复负责人、Board 升级、native run、重试过期/用尽/正在运行；已解决卡片不再显示可执行操作。
- [ ] 有/无工作树争用、脏改数量 0/1/多项/未知、祖先关系 ancestor/diverged/unknown，以及未知诊断/未来机器码仍可辨认；救援路径与分支原样显示。
- [ ] 日期/时区、长于一小时和刚到期的时间显示；确认仅改变显示，未改变 retryExpired、预算、原负责人或运行活动判断。
- [ ] 中央集成全量类型检查/构建、真实浏览器和对应提交 CI；真实模型/付费执行须单独授权，本次未调用。
