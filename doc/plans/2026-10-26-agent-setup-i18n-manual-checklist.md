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

## 第二片：共享配置控件（2026-10-26）

- 已补 `RuntimeTestCard` 两个变体的全部本地状态、说明、动作、详情和 aria-label；原始检查 message/detail/hint 保持不变。
- 已补 `AdapterLoginChrome` 的准备/复制/输入授权码、浏览器与本机指引；授权 URL、授权码和 CLI 命令保持不变，没有发起真实登录。
- 已补 `AgentConfigForm` 中 `ModelDropdown` 的 native/searchable 两种呈现、自定义模型、搜索空状态和帮助；模型 ID、品牌、调用方自定义文案与模型排序保持不变。
- 已补 `AiConnectionField` 自身的连接/权限弹窗与 `SecretPicker` 的缺失、非活动状态、浏览/搜索及创建入口；权限、绑定、名称和账户保存语义不变。
- 专注回归：7 文件 / 161 用例通过（512 MB，单 worker）；覆盖共享控件的四语实际渲染、全部运行状态、输入占位符、切语言保留模型值、名称/授权码/URL/命令不翻译。仍不代表浏览器布局、IME 或真实登录验收。
- 原计划 §4.4 单独安全补齐：`OnboardingCardField` 在组合输入或 keyCode 229 时不提交、不 preventDefault；未屏蔽普通输入，普通 Enter 保持提交语义。新增非掩码授权码与掩码 API key 两种回归。真实 IME 仍待上表手测。
- token gates、调色板/角色同步、diff 检查通过。测试命令在上一命令基础上增加 `src/components/AdapterLoginChrome.test.tsx`、`src/components/ModelDropdown.test.tsx`、`src/components/ai-connections/AiConnectionField.test.tsx`、`src/i18n/agent-setup-shared-surfaces.test.tsx`。

## 第三片：嵌套连接选择与凭据步骤（2026-10-26）

- 已补 `AiConnectionSelect` 的默认账户、加载、失败、不可用/不兼容与状态提示；未知服务端不可用原因保留原文。
- 已补 `AiProviderSetup` 的提供商选择、URL/API 格式/认证字段、权限加载兜底、模型帮助与重连；`AiConnectionCredentialStep` 自有连接名称、环境选择、输入与动作同时覆盖。权限摘要来自独立的 `ConnectionSetupFlow`，仍未计为本片完成。
- `SavedProviderKeySelect` 的系统后缀通过 `saved-provider-credentials` 显式标签元数据翻译，原始名称、旧 label 与绑定保持原值；不对用户名称做子串替换。
- 专注回归 **6 文件 / 150 用例通过**（512 MB、单 worker），包括四语实际高级提供商选择、在 provider 步切换语言、保存 `provider` / model ID / URL / `My Local endpoint` 默认名称不变、用户名称包含 `Your default` 时不被误译；四语键与占位符一致。静态资源的键数不构成整条路径覆盖率。
- 复现：在 `ui/` 使用前述命令运行 `AiProviderSetup.test.tsx`、`AiConnectionField.test.tsx`、`NewAgent.test.tsx`、`AgentProviderConnection.test.tsx`、`agent-setup-connection-surfaces.test.tsx`、`saved-provider-credentials.test.ts`（使用各文件的 `src/` 完整路径）。token gates、调色板/角色同步、diff 检查通过。
- 手测追加：四语创建高级网关/本地模型连接，编辑中切语言，检查标题/placeholder 与账号状态更新而权限、模型和 URL 不变；已有账户名称恰含英文系统词时仍保留名称。使用受控账户验证 API 成功/失败与重连，不能仅以 mock 请求通过代替外部连接验收。

## 第四片：实际登录面板与本机登录错误（2026-10-26）

- 已补 `AgentConfigForm` 中 `AdapterLoginPanel` 的显示验证码/提交浏览器验证码两模式：标题、复制/打开/提交动作、准备/完成/超时/取消、账号绑定、保存登录、明文传输警告及本地错误。授权 URL、验证码、供应商标识与服务端原始诊断不自动翻译；Claude 终态仍使用固定脱敏失败提示，不展示可能包含凭据的供应商原文。
- `useLocalAiLogin` 的本地错误保存为描述符，显示时翻译；`LocalizedUiError` 保留英文 `Error.message` 兼容值，仅由显式识别的宿主使用翻译 key。`AgentProviderConnection` 已识别描述符，未知外部 `Error.message` 原样保留。
- 语言切换不纳入登录 effect/query key/轮询依赖；回归验证已有错误在日语→中文后更新，不新建/取消登录、不重读凭据、不重复提交。另用假时钟验证原有 5 秒本机轮询截止点没有因切语言被重置；两种面板的 URL/验证码/输入草稿不变。
- 原计划 §4.4 独立安全补齐：非 onboarding 的 `Browser code` 原生输入新增组合输入/keyCode 229 早返回。四语回归确认组合 Enter 不提交且不 preventDefault，普通中文输入正常保留，普通 Enter 仍 preventDefault 并仅提交一次。第二片的 `OnboardingCardField` guard 保持；真实操作系统 IME 仍未测试。
- 最终专注回归 **7 文件 / 266 用例通过**（512 MB、单 worker）；覆盖此前创建/连接场景与新增登录两模式、错误动态翻译、轮询不重置、脱敏和 IME 回归。token gates、调色板/角色同步及 diff 检查通过；没有执行全量类型检查、生产构建、数据库、真实浏览器或供应商登录。
- 复现命令（`ui/`）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/components/AgentConfigForm.render.test.tsx \
  src/components/ai-connections/useLocalAiLogin.test.tsx \
  src/i18n/agent-setup-login-resources.test.ts \
  src/pages/NewAgent.test.tsx \
  src/components/new-agent/AgentProviderConnection.test.tsx \
  src/components/AdapterLoginChrome.test.tsx \
  src/components/ai-connections/AiProviderSetup.test.tsx --maxWorkers=1
```

- 手测追加：登录等待中、失败后、验证码已填入后切换四语，核对请求数/草稿和原定轮询节奏；在非 onboarding 面板及 onboarding 两个入口分别用真实中文/日文 IME 确认候选；验证 HTTP 明文警告四语可读，截图必须遮盖验证码/账号信息。

## 第五片：向导中的本机登录错误宿主（2026-10-26）

- 仅补 `OnboardingWizard` 创建步骤对 `localLogin.connect()` 的本地错误宿主：已定义的 `LocalizedUiError` 存为 key，显示时翻译；派生 `error`/`visibleError` 仍为字符串或 null。未知服务端 `Error.message` 和原有其他兜底不变。
- 没有改变 attempt/session、重复创建、取消、导航保护及 effect 依赖；这不是整个首次向导文案的再实现，也不代表其他向导错误全部可动态重译。
- 新增真实 hook 的三个本地 guard 单测；宿主回归在 connect 边界注入同类 guard（不冒充真实供应商授权），验证先出现日语错误，再切中文，完整保存草稿包含 Agent 名称/模型/步骤仍不变，不额外 connect/start/check/cancel/hire。另验证未知服务端诊断在切语言后仍原样。
- 最终相关回归 **6 文件 / 158 用例通过**（512 MB、单 worker），token gates、调色板/角色同步及 diff 检查通过。复现（`ui/`）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/components/OnboardingWizard.test.tsx \
  src/components/OnboardingWizard.adapters.test.tsx \
  src/components/OnboardingWizard.company-integration.test.tsx \
  src/components/OnboardingWizard.step.test.tsx \
  src/components/OnboardingWizardVariant.test.tsx \
  src/components/ai-connections/useLocalAiLogin.test.tsx --maxWorkers=1
```

- 手测追加：在受控测试条件下模拟本机登录尚未准备好的连接错误，再切换语言；检查错误翻译、现有 Agent 名称与模型草稿、按钮恢复及网络请求数。不要为观察错误而使用生产密钥或破坏真实账户会话。

## 已知剩余范围（不是本片已完成项）

- 真实登录、剪贴板权限及浏览器布局尚未四语验收。系统提示已抽取不代表外部交互已通过。
- `AdapterLoginPanel` 与 `useLocalAiLogin` 本片指定显示层已补；`environmentDisplayLabel` 仅拼用户环境名和原始 driver 标识，保留为用户内容/技术值。高级连接的 `ConnectionSetupFlow` 中 `connectionDefaultSummarySentence`、`ConnectionAccessDefaults`、`AccessStepContent` 仍有权限摘要与 Change 等英文，需独立切片；本片没有更改权限语义。
- 第四片审计发现的 `OnboardingWizard` 本机 connect 错误宿主已由第五片接通；向导的其他硬编码校验/错误及尚未审计的系统文案，不在本次 Agent 创建切片完成结论内。
- 服务端/适配器 `Error.message`、运行检查结果以及用户/组织/环境名称保持原始内容，不能以纯英文扫描结果判定它们都应翻译。
- 基线 `6bee5bc` 的 `optionalOnboarding.configureAgent` 三语使用“智能体/agente/エージェント”；本片创建按钮使用独立 Agent 术语键，不覆盖其他域片段。并行 core 切片已修中文 Agent 术语，其他语种与最终集成状态以合并后的资源为准。

测试输出和以上边界应随集成结果更新；资源键数只检查一致性，不作为页面覆盖率或端到端完成率。
