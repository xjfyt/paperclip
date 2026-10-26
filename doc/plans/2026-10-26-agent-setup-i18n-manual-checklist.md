# Agent 创建界面四语补漏与待手测清单（2026-10-26）

## 范围和结论

对应原计划 §4.2–4.4。入口是 `App.tsx` 的 `agents/new` → `pages/NewAgent.tsx` → `components/new-agent/NewAgentSetup.tsx`，不是 Storybook 原型或 legacy 创建窗口。本片覆盖 `NewAgent` 页面和 `NewAgentSetup`、`AgentBasicsDialog`、`AgentProviderConnection` 三个组件（共四个文件）：面包屑、名称/适配器两步、连接/配置/确认界面、自有表单标签与 aria-label、占位符、提示、空状态、校验及错误兜底。

使用 `agentSetupUi` 领域片段，复用已有合适的通用键。保留 Agent 术语；品牌、CLI 命令、模型 ID、环境变量名、协议/选项值、用户输入及服务端原始诊断不自动翻译。连接的持久默认名 `My … subscription` / `My … API` 不在这次纯显示变更中重写。正式 locales 由集成 owner 合成，本片不编辑生成文件。

**仅代表上述四文件的补漏及专注自动化证据，不代表整条创建路径或全站 i18n 已完成。** 以下手测全部待执行。

## 自动化证据

- 用现有依赖、单 worker、512 MB V8 上限运行，无安装、数据库、浏览器或外部网络。
- 最终专注测试 **3 文件 / 113 用例通过**（2026-10-26）；三个测试文件：`NewAgent.test.tsx`、`AgentProviderConnection.test.tsx`、`agent-setup-resources.test.ts`。
- 四语验证实际渲染的名称/适配器步骤、配置/确认、组织缺失状态、提供商输入占位符及错误兜底；检查键/占位符一致、安全文本、复数、原样保留用户名称与 `provider/model`、CLI 命令。
- 先触发本地校验/提供商错误，再切日语与中文，验证错误重译且不重发请求；凭据清理提示重译而外部诊断原文保留。
- 在界面内切换到日语，验证面包屑和字段标签更新，已有仓库 URL 草稿不变；既有创建/凭据/重复点击等单测同时回归。
- 所有 token gate 与调色板/角色同步检查通过。未运行全量类型检查、生产构建、全量测试、真实 CLI/供应商登录、浏览器截图及发布环境。
- jsdom 的 `Window.scrollTo()` 未实现告警属于非浏览器环境局限，不是浏览器布局通过的证据。

复现命令（仓库 `ui/` 目录）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/pages/NewAgent.test.tsx \
  src/components/new-agent/AgentProviderConnection.test.tsx \
  src/i18n/agent-setup-resources.test.ts --maxWorkers=1
```

## 用户手测矩阵

每行在 English / 简体中文 / Español / 日本語 分别执行，记录版本 SHA、浏览器/视口、结果、截图或脱敏错误。先在测试组织使用受控凭据，真实连接/创建会产生外部副作用及费用。

| 场景 | 操作与预期 | 当前状态 |
| --- | --- | --- |
| 正式资源集成 | 合成四语正式 locales 并执行 `node scripts/compose-mimouse-locales.mjs --check`；真实页面没有 `agentSetupUi.*` 键名或意外英文回退 | 待集成 owner 验证 / 待用户手测 |
| 名称与适配器 | 从 Agent 列表创建；检查两步标题、名称 placeholder、返回/取消/外部邀请、适配器加载失败；包含中日文字、`<` 与长名字仍按文本显示 | 待手测 |
| 中文 IME/键盘 | 中文输入法组合期间 Enter 不提前提交；组合完成后的 Enter、Tab 焦点、返回/关闭/重开符合既有行为 | 待手测，jsdom 不证明真实 IME 行为 |
| 语言切换/草稿 | 名称、仓库 URL、模型 ID 或密钥草稿输入后切换四语；系统标签更新、输入不变；刷新语言偏好保存，确认不意外重复创建 | 待手测 |
| 提供商 API | Claude/OpenAI/Grok 的订阅/API/高级连接选择；无保存密钥、1/多个保存密钥、新密钥 placeholder、连接失败、重试；API key 不进入截图或日志 | 待手测 |
| 真实登录生命周期 | 本机与托管环境；准备/等待验证码/连接中/失败，取消登录、返回、切换方式、重开；过期登录结果不污染新选择 | 待手测，真实 CLI 与授权未执行 |
| 环境与模型 | 无可用环境、托管环境限制、默认环境、模型加载失败、手填模型；标签翻译而持久 ID 与 `provider/model` 不变 | 待手测 |
| 适配器专用表单 | Cursor Cloud 仓库/分支及必填密钥；Kimi 模型/协议/base URL；Hermes URL；各种校验与 CLI 提示 | 待手测 |
| 创建/审批/确认 | 正常创建、待审批、新建失败、创建后刷新/重新加载失败；确认动作与 Agent 名称插值；批准前不能分配工作 | 待手测 |
| Dot 路径 | 未确认外部计费、未启用 MCP、创建、配对提示与返回；文案不暗示已限制不可观测的提供商费用 | 待手测 |
| 失败后凭据清理 | 在受控测试条件下模拟创建失败与清理失败；原始诊断保留，清理提示为所选语言；核查是否有残留凭据再重试 | 待手测 |
| 西语/日语布局与无障碍 | 窄屏/200% 缩放下长按钮、进度条、帮助文字无裁切；日语换行可读；可见标签与 aria-label 一致；屏幕阅读器顺序合理 | 待手测，无浏览器布局验收 |

## 已知剩余范围（不是本片已完成项）

- `RuntimeTestCard.tsx` 仍有运行连接测试/前置检查的标题、说明、动作和 `Runtime test` aria-label；本片未修改该共享组件。
- `AdapterLoginChrome.tsx` 仍有登录准备、授权码、复制/提交、账户切换、本机 CLI 指引等系统文案；其真实登录与剪贴板流程尚未四语验收。
- 继续审计 `AgentConfigForm` 的模型选择/登录面板、`AiConnectionField`、`SavedProviderKeySelect`、`SecretPicker` 及环境显示辅助函数的实际渲染；共享组件被调用不等于其文案已覆盖。
- 服务端/适配器 `Error.message`、运行检查结果以及用户/组织/环境名称保持原始内容，不能以纯英文扫描结果判定它们都应翻译。
- 基线 `6bee5bc` 的 `optionalOnboarding.configureAgent` 三语使用“智能体/agente/エージェント”；本片创建按钮使用独立 Agent 术语键，不覆盖其他域片段。并行 core 切片已修中文 Agent 术语，其他语种与最终集成状态以合并后的资源为准。

测试输出和以上边界应随集成结果更新；资源键数只检查一致性，不作为页面覆盖率或端到端完成率。
