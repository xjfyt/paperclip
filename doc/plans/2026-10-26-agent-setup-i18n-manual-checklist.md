# Agent 创建界面四语补漏与待手测清单（2026-10-26）

## 中央集成状态补记（2026-10-26 19:30 UTC）

文中后续连接/OAuth/remote MCP/断开管理四片已合入3186阶段，四语合成、中央UI类型/构建及794文件9222项分批聚合通过。原分支未跑完整检查的陈述是提交时记录，不是当前中央状态。真实供应商登录、实际remote MCP连接/注销、真实CLI及各部署环境仍待人工验收，不能用mock或全UI单测替代。

统一证据及版本边界见 [VERIFICATION](../mimouse/VERIFICATION.md)。下文早期“未运行/待集成”如无后续限定，指原切片提交时，不覆盖本补记；未提到的实测不作通过推断。


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

## 第六片：高级连接身份与 Agent 访问范围摘要（2026-10-26）

- 仅补 `ConnectionSetupFlow` 中 `connectionDefaultSummarySentence`、`ConnectionAccessDefaults`、`AccessStepContent` 的自有文案及必要调用接缝，新增独立 `connectionAccessUi` 领域。标准连接页两处摘要、`AiProviderSetup`、`RemoteMcpConnectionSetup` 显式传入响应当前语言的翻译函数；没有重写整个连接设置文件。
- 明确保留个人/组织共享/Agent 专用身份、全部/指定 Agent、固定请求方 Agent、重连不变更现有范围等区别；无凭据不表示向所有 Agent 授权。未知身份/范围或无效计数仅显示“尚未确认”，不是权限校验或授权策略变更，也不改写为已授权/只读。
- `organization/user/agent`、`all/specific`、所选 ID、权限回调、ownership、认证方式和请求 payload 保持原值；外部禁用原因、用户名、URL 与凭据不翻译。数字自闭 React 插槽保持姓名强调样式，用户名中的字面 `<strong>` 不会变成标记；资源另按实际合成器的严格安全正则校验。
- 四语真实渲染回归覆盖身份与范围、0/1/多选、固定 Agent、重连保留、不可授权选项的 disabled/title/aria、外部原因原样、未知范围。切语言保留展开状态和选择，不触发授权/连接/刷新；标准连接、远程 MCP 与高级提供商保存参数一并回归。远程 MCP 测试仅验证既有 read/write/unknown 动作权限对象未被改动，不冒充真实读写调用或授权验收。
- 最终专注回归 **7 文件 / 275 用例通过**（512 MB、单 worker），独立审阅、token gates、调色板/角色同步及 diff 检查通过。jsdom 的 `Window.open()` 未实现告警不是浏览器授权成功证据；未运行完整类型检查/构建。
- 复现命令（`ui/`，纯 mock/jsdom；不执行真实授权、登录、数据库或网络）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/i18n/connection-access-surfaces.test.tsx \
  src/i18n/connection-access-remote.test.tsx \
  src/components/ai-connections/AiProviderSetup.test.tsx \
  src/pages/apps/AppsConnect.test.tsx \
  src/features/connections/ConnectionSetupFlow.architecture.test.ts \
  src/features/connections/ConnectionSetupFlow.oauth.test.ts \
  src/features/connections/connection-defaults.test.ts --maxWorkers=1
```

- 手测追加：四语进入高级连接并展开“更改”，切换个人/组织/专用身份和全部/指定 Agent；检查 0 选择不能误读成全部，受限用户不可选择组织级/全部范围且原因可读。任务宿主仅授予请求 Agent，重连仍保留原范围；验证四语长文/键盘/屏幕阅读器。使用测试账户核对真实保存后的授权范围与服务端拒绝越权，不能只依据 UI disabled 判定授权安全。

## 第七片：连接完成页与三行摘要（2026-10-26）

- 仅补 `accessSummaryLines` 的身份/可用范围/已启用操作数量，以及 `ConnectionSetupCompletionScreen` 的完成标题和查看连接按钮；新增独立 `connectionCompletionUi` 领域，复用第六片身份/范围通用键。实际标准连接宿主传当前翻译函数，三行摘要不会固定为进入完成页时的语言。
- 保持个人/组织/Agent 专用身份、全部/指定范围、0/1/多项动作的区别；未知身份或非法计数只显示未确认，不推断组织级授权、只读或全部动作。没有修改权限判断、读写分类、业务 ID、请求 payload 或查看连接后的导航路径。
- 完成页本身没有本地错误状态；本片不会顺带改写 OAuth controller 的错误缓存。调用方传入的自定义 summary/原始诊断和应用名称仍是原始文本；名称含字面 HTML 也不解析为标记。
- 四语渲染与切换回归覆盖实际完成标题、三行摘要、单复数、未知值和调用方原文。真实 `AppsConnect` mock 流程先完成，再轮流切换四语，核对 connect/finish/install 调用记录完全不变；点击已翻译按钮仍导航至同一 connection ID 的 permissions 页面，不因切换语言再次完成或自动导航。
- 最终专注回归 **8 文件 / 292 用例通过**；独立审阅、四语键/占位符及实际合成器安全规则、token gates、调色板/角色同步和 diff 检查通过。未执行完整类型检查/构建、真实授权、数据库或网络。
- 复现命令（`ui/`，纯 mock/jsdom、512 MB、单 worker）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/i18n/connection-completion-surfaces.test.tsx \
  src/i18n/connection-access-surfaces.test.tsx \
  src/i18n/connection-access-remote.test.tsx \
  src/components/ai-connections/AiProviderSetup.test.tsx \
  src/pages/apps/AppsConnect.test.tsx \
  src/features/connections/ConnectionSetupFlow.architecture.test.ts \
  src/features/connections/ConnectionSetupFlow.oauth.test.ts \
  src/features/connections/connection-defaults.test.ts --maxWorkers=1
```

- 手测追加：使用测试连接完成配置后，在四语间切换，检查标题、身份/范围/动作计数及按钮；确认权限页的连接 ID 与实际授权范围没有改变，没有再次发起授权/保存。使用长应用名称和窄屏核对摘要对齐、换行及键盘焦点；真实供应商授权和浏览器布局仍须用户验收。

## 第八片：标准 OAuth 登录状态与本地错误缓存（2026-10-26）

- 实际入口为 `AppsConnect` 页面及任务/独立 dialog → `ConnectionSetupFlow` → `StandardConnectionSetupFlow`，其中 curated 和 generic 两处使用 `OAuthConnectStateScreen`。本片仅补这两处状态屏、标准控制器自身的本地错误、共享 `StepHeader` 的自有标题/取消/进度 aria，以及 `UnverifiedServerBadge` 的安全警告标签；独立 `connectionOAuthUi` 四语贡献，未生成最终 locale。
- `oauthError` 改为既有 `LocalizedUiMessage` 描述符或原文，在状态屏 render 时翻译；回调取消/未完成、弹窗阻止/关闭、连接检查失败、已知 `invalid_grant` 和未知非 Error fallback 可在显示后切换语言。本地刷新账户 guard 使用既有 `LocalizedUiError`；未知 `Error.message`、供应商 guidance、host、URL、用户名称和外部 step 标签保持原文，不按英文字符串猜测来源。
- 没有改动 callback origin/interaction/outcome 校验、abort/session、认证状态值、权限判断、请求 payload、导航或任何 effect/callback 依赖；没有把 `t` 加入轮询依赖。保留仅认识地址时才批准授权、未经验证服务器、取消后已保存连接未改等安全含义。共享 header/badge 变更仅替换显示文本，不能据此声称它们所有宿主已完成四语。
- 新增屏幕四语渲染覆盖 entry/resume/starting/redirecting/error、按钮、进度 aria、安全警告、原始 URL/host/供应商诊断和 HTML 字面名称；实际 `AppsConnect` mock 流程先触发 connect/start 的本地 fallback、已知授权过期或原始外部错误，以及已保存 draft 的三种回调失败，再切四语，核对 connect/startOAuth/finish/install/查询记录不增加。保留 draft ID 与 `asCurrentUser` 语义，只有主动重试才重新启动。
- 弹窗阻止后的四语切换不重复打开窗口/启动请求；独立 dialog 测试拦截 interval 并主动执行原注册回调，证明切语言不重新注册/清理 1 秒轮询、不调用 finish/onComplete；只有原回调读取 mock 已保存 active 状态后才完成。该测试不是实时浏览器计时、真实弹窗或外部 OAuth 验收。
- 最终专注回归 **11 文件 / 332 用例通过**；资源/实际合成器安全规则、独立审阅、token gates、调色板/角色同步与 diff 检查通过。未执行完整类型检查/构建、真实授权、数据库或网络。
- 中央整合类型检查曾发现新增 interval 测试的全局 `window` 重载被推断为 Node `Timeout`；测试 spy 已明确使用浏览器 `Window` 接口，保留数字句柄/回调/断言，不改生产类型。修后重跑 `AppsConnect.test.tsx` 与 `connection-oauth-surfaces.test.tsx`，**2 文件 / 227 用例通过**；完整 UI 类型结果由中央复检记录。
- 复现命令（`ui/`，512 MB、单 worker，均为纯测试或 mock/jsdom）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/i18n/connection-oauth-surfaces.test.tsx \
  src/i18n/connection-completion-surfaces.test.tsx \
  src/i18n/connection-access-surfaces.test.tsx \
  src/i18n/connection-access-remote.test.tsx \
  src/components/ai-connections/AiProviderSetup.test.tsx \
  src/pages/apps/AppsConnect.test.tsx \
  src/features/connections/ConnectionSetupFlow.architecture.test.ts \
  src/features/connections/ConnectionSetupFlow.oauth.test.ts \
  src/features/connections/connection-defaults.test.ts \
  src/lib/oauthHandoff.test.ts src/lib/authorizationUrl.test.ts --maxWorkers=1
```

- 手测追加：使用测试账户分别从页面、任务弹窗及独立弹窗打开标准 OAuth 连接；在等待、弹窗被阻止/关闭、取消/失败回调、恢复已保存 draft 时切四语。核对正在授权的 host 和 URL 不变、未经验证警告可读、草稿身份/范围保留、不重复打开窗口或启动授权/完成。显式点击重试或新标签页后应仍沿用原连接；真正成功必须以已保存连接验证为准。再测试窄屏、长名称、键盘取消/返回及屏幕阅读器；真实供应商授权、跨窗口消息和计时仍待用户验收。

## 第九片：OAuth handoff 工具描述符与最小真实宿主（2026-10-26）

- `authorizationUrl.ts` 仅给共享 validator 的六类本地拒绝附加显示 key，原有英文 `message` 保留；没有改动 HTTPS、loopback、同源、用户名/密码、fragment 或协议判断，也不回显拒绝的 URL。
- `OAuthHandoffError` 保留名称、错误码和 `Error.message`，只有明确本地构造点附加可选翻译 key。`invalid_handoff` 与 `unavailable` 均非唯一文案来源，禁止按错误码/英文文本猜测翻译；真实网络 `lastError.message`、存储异常和 AbortError 原样，现有同 session 重试/清理规则不变。
- 独立 `connectionHandoffUi` 四语贡献；接线仅标准 OAuth catch 与真实 `/oauth-handoff` 页面。页面错误保存描述符、render 翻译，`resume`/effect 依赖未新增翻译函数。未知外部诊断保持文本，不重新请求来“更新语言”。没有扩展 `ToastContext`；其它 handoff 宿主仍可使用兼容英文 message，不能声称所有宿主已消费描述符。
- 回归覆盖六类 URL 拒绝及不泄露输入、401/403/404/500 分支、同 opaque session 的既有请求次数、原始网络诊断/Abort；实际 handoff 页面在已显示错误后切四语，sessionStorage 和请求记录不变、不导航。实际 AppsConnect 遇到无效协议授权地址后切语言，也不重新 connect/startOAuth/finish、不泄露拒绝 URL。
- 最终专注回归 **7 文件 / 276 用例通过**；独立审阅、资源/合成器安全规则、token gates、调色板/角色同步与 diff 检查通过。真实授权、浏览器导航/存储策略及网络故障仍待手测。本片未执行完整类型检查/构建、数据库或真实网络。
- 复现命令（`ui/`，512 MB、单 worker，纯测试/mock）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/i18n/connection-handoff-surfaces.test.tsx \
  src/lib/oauthHandoff.test.ts src/lib/authorizationUrl.test.ts \
  src/pages/apps/PaperclipCloudOAuthHandoff.test.tsx \
  src/pages/apps/AppsConnect.test.tsx \
  src/i18n/connection-oauth-surfaces.test.tsx \
  src/features/connections/ConnectionSetupFlow.architecture.test.ts --maxWorkers=1
```

- 手测追加：在测试环境触发 handoff 过期、无权限、暂时不可用、无效供应商地址与重复近期登录恢复，切四语检查语义和返回/重试按钮；切语言不应重新交换 session、清草稿或导航。主动重试沿用既有流程。原始网络诊断不承诺翻译；拒绝 URL 的提示不得泄露 URL 内凭据。

## 第十片：远程 MCP controller 本地错误与登录状态（2026-10-26）

- 实际入口为 `/apps/connect?source=zapier|arcade|composio|executor` 和任务宿主，经 `ConnectionSetupFlow` 分派至 `RemoteMcpProductionSetup`，渲染 `RemoteMcpConnectionSetup` 或复用账户的 `RemoteMcpAccountChoice`。本片不替代标准 OAuth controller，不把设计示例当生产流程证据。
- 本地 header/console URL guard、保存凭据提示、blocked popup、非 Error fallback 和账户复用 fallback 使用既有描述符；`notice`/`choiceError` 在 render 翻译。共享 URL 拒绝明确消费 `translationKey`，真实外部 Error.message 与设计示例传入的自定义 notice 仍原样。未改认证/权限/状态枚举、request payload、用户输入或消息 effect 依赖；没有新增轮询。
- 独立 `remoteMcpStatusUi` 四语贡献，覆盖等待/取消/错误状态及账户复用说明，保留“复用不代表已验证下游应用权限”的安全含义。登录恢复链接用安全数字 React 槽，href/target/rel 与原 onClick 不变，不把URL或账户名称送入翻译标记解析。
- 四语受控渲染测试包括 rejected/unreachable，但不声称生产请求会发出这些状态。实际 AppsConnect 用例覆盖五种 local guard/未知失败/raw诊断/URL拒绝，先显示错误再切四语，DOM字段值、sessionStorage 与 connect/startOAuth/finish/install 记录不变；三种 blocked popup 和三个提供商失败回调切语言不重复认证，随后主动点击当前原生登录链接/重试仍沿用原 draft/interaction 语义。
- 最终专注回归 **7 文件 / 330 用例通过**；独立审阅、资源/合成器安全规则、token gates、调色板/角色同步与 diff 检查通过。真实供应商登录、跨窗口消息/弹窗策略和浏览器布局仍待用户测试；本片未执行完整类型检查/构建、数据库或真实网络。
- 复现命令（`ui/`，纯 mock/jsdom、512 MB、单 worker）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/i18n/remote-mcp-status-surfaces.test.tsx \
  src/i18n/connection-access-remote.test.tsx \
  src/i18n/connection-handoff-surfaces.test.tsx \
  src/pages/apps/AppsConnect.test.tsx \
  src/features/connections/ConnectionSetupFlow.oauth.test.ts \
  src/features/connections/ConnectionSetupFlow.architecture.test.ts \
  src/features/connections/ConnectionIntentInteractionBody.test.tsx --maxWorkers=1
```

- 手测追加：四提供商从 page/dialog 进入，分别测试已有账户复用、新连接、错误 header/console URL、已保存凭据留空、取消/失败回调和弹窗阻止。错误后切语言确认草稿、身份和授权范围不丢，未知服务端诊断保持原文；恢复链接不重复打开窗口或变更 URL；切语言后检查当前链接的键盘焦点、Tab顺序与激活（翻译可能重建链接节点）。实际权限验收仍须测试账户和服务端验证，不能以提示文字或UI禁用状态代替。

## 第十一片：远程 MCP 实际连接表单与展示 metadata（2026-10-26）

- 仅补 `RemoteMcpConnectionSetup` 的 connect 表单、帮助/aria、必要连接标题与上游服务提示，及共享 `SetupWizardFooter` 的保存并退出按钮。没有改其它 SetupWizard 导航或其宿主业务逻辑；非 connect 的权限/管理/draft 展示仍非本片完成范围。
- `providers.ts` 增加明确展示 key 与 `remoteMcpProviderDisplay`，只为实际消费的操作说明、URL/认证帮助及 Zapier/Executor 文字 placeholder 提供译文。provider 名称/ID、setup/dashboard/default URL、Arcade-User-ID、认证值和 URL placeholder 原样。原始 metadata 和无显式 key 的自定义文案仍可原样使用；未将译文写入连接名称、credentialValues、config 或用户可编辑的 agentInstructions。
- 供应商外部 UI 的 Other、Connect、User Source、Integrations、Connect an agent 等指引标签保留，避免指向不存在的译名。保留 URL 可能包含秘密令牌、仅使用用户 API key、工作区/组织 key 不能建立 MCP session，以及“无额外认证”不代表无需身份等安全含义。
- 新增四语实际表单渲染，核对说明、placeholder、密码遮罩、header aria、选项原值和保存按钮，以及四提供商 setupComplete=true 的实际重连标题/说明；mounted 表单切语言不改 token/header/URL/展开状态或调用 edit/connect。实际 AppsConnect 的四提供商用例填写 bearer 与自定义 header 后切四语，再主动提交，核对原始名称、provider ID、URL、认证方式、credentialValues 和原有 finish 次数。
- 最终专注回归 **7 文件 / 284 用例通过**；独立审阅、资源/合成器安全规则、token gates、调色板/角色同步与 diff 检查通过。共享 footer 的 GitHubChatSetup 与 TriggerWizard 现有用例只添加测试资源并回归，不把这些宿主整体计为已本地化。未执行完整类型检查/构建、真实网络或授权。
- 复现命令（`ui/`，512 MB、单 worker，纯 mock/jsdom）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/i18n/remote-mcp-form-surfaces.test.tsx \
  src/i18n/remote-mcp-status-surfaces.test.tsx \
  src/i18n/connection-access-remote.test.tsx \
  src/pages/apps/AppsConnect.test.tsx \
  src/pages/apps/chat/GitHubChatSetup.test.tsx \
  src/components/routine-triggers/TriggerWizard.test.tsx \
  src/features/connections/ConnectionSetupFlow.architecture.test.ts --maxWorkers=1
```

- 手测追加：四提供商分别验证 auto/bearer/headers/none 的可用选项、0/1/多 header、默认/自定义 URL 和 Composio 折叠会话；填写测试凭据后切四语，检查字段值/展开状态/焦点与描述关联不变。验证复制的端点原样、没有将已保存秘密回填展示；主动连接/保存与取消各按原意执行。供应商说明有效性、真实授权、窄屏/长文/屏幕阅读器仍需用户验收。

## 第十二片：真实远程 MCP 管理确认与宿主失败提示（2026-10-26）

- 仅补 `RemoteMcpManagement` 自有标题、按钮和断开确认；其真实宿主是 `AppDetail` 的已保存连接管理区。`AppDetail` 仅将断开失败 toast 的标题/非 Error fallback 按发出时语言生成，未知 Error.message 保持原样，不扩 `ToastContext`，也不声称该详情页其它文案已本地化。
- 四语完整保留删除保存凭据、停止后续调用、其他连接不受影响、已经发送的操作可能继续完成、重新连接需要新登录/密钥的含义。canReconnect/canDisconnect/connected/busy 条件、确认事件 preventDefault、成功关闭/失败保留对话框、archive 请求和导航均未改。
- 对话框已打开后切语言，标题/说明/按钮更新而不自动断开或关闭；用户名称包含 HTML 字面值也不解析。受控测试保持 busy 禁用与失败后重试行为；实际 AppDetail mock 流程核对查询/认证/finish/archive 不因切语言重发，主动确认仅 archive 同一连接一次，外部诊断仍原样。实际 canConfigure=false 时切四语仍无断开入口；这不是服务端越权验收。
- 失败 toast 是调用时的字符串：先在日语发出，再切中文，既有 toast 不重发、不承诺动态重译；仍打开的确认框则会更新。此限制有明确回归，未以重新请求实现文案刷新。
- 最终专注回归 **7 文件 / 345 用例通过**；独立审阅、资源/合成器安全规则、token gates、调色板/角色同步与 diff 检查通过。所有归档/失败均是 mock，未删除真实连接或凭据；未执行完整类型检查/构建、数据库或网络。
- 复现命令（`ui/`，512 MB、单 worker，纯 mock/jsdom）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run \
  src/i18n/remote-mcp-management-surfaces.test.tsx \
  src/pages/apps/AppDetail.test.tsx \
  src/i18n/remote-mcp-form-surfaces.test.tsx \
  src/i18n/remote-mcp-status-surfaces.test.tsx \
  src/i18n/connection-access-remote.test.tsx \
  src/pages/apps/AppsConnect.test.tsx \
  src/features/connections/ConnectionSetupFlow.architecture.test.ts --maxWorkers=1
```

- 手测追加：仅使用可撤销的测试连接核对管理入口、权限不足不可断开、确认框四语长文/焦点与 Escape/取消；打开确认后切语言不执行操作。明确确认后验证后续调用被拒、其他连接不受影响、已发送操作仍可能结束。重连需新授权/密钥；请求失败时确认框保留、原始诊断可见，既有 toast 不随语言更新属于本片已记录限制。真实服务端权限/凭据失效与外部供应商效果仍由用户验收。

## 已知剩余范围（不是本片已完成项）

- 真实登录、剪贴板权限及浏览器布局尚未四语验收。系统提示已抽取不代表外部交互已通过。
- `AdapterLoginPanel` 与 `useLocalAiLogin` 本片指定显示层已补；`environmentDisplayLabel` 仅拼用户环境名和原始 driver 标识，保留为用户内容/技术值。此前确认的三个共享权限摘要/选择组件已由第六片补齐，三行摘要和完成页由第七片补齐；`ConnectionSetupFlow` 标准 OAuth 状态屏和自身本地错误缓存由第八片补齐，但其它分支（如校验/错误缓存、密钥表单）仍未包含；远程 MCP 本地状态/错误和 connect 表单已由第十/十一片补齐，真实管理确认由第十二片补齐，但 `RemoteMcpConnectionSetup` 的非 connect 权限/管理/draft 展示分支及详情页其它文案仍未包含，不能据此声称整个连接流程四语完成。所有切片均未更改权限判定或真实授权语义。
- 第九片已给 `oauthHandoff.ts` / `authorizationUrl.ts` 明确本地异常增加描述符并接通最小宿主；`ConnectionSetupFlow.openConnectorEnrollment` 仍使用 `target.message`，远程 MCP 的对应 URL catch 已由第十片接通；PasteConfigTab、AppDetail/AdvancedPanel toast 等其它宿主也未消费全部描述符。现有 toast 只保存字符串，不能承诺已显示 toast 随语言更新；本片不扩展共享 toast。真实网络原始诊断不按错误码猜测翻译。
- 第四片审计发现的 `OnboardingWizard` 本机 connect 错误宿主已由第五片接通；向导的其他硬编码校验/错误及尚未审计的系统文案，不在本次 Agent 创建切片完成结论内。
- 服务端/适配器 `Error.message`、运行检查结果以及用户/组织/环境名称保持原始内容，不能以纯英文扫描结果判定它们都应翻译。
- 基线 `6bee5bc` 的 `optionalOnboarding.configureAgent` 三语使用“智能体/agente/エージェント”；本片创建按钮使用独立 Agent 术语键，不覆盖其他域片段。并行 core 切片已修中文 Agent 术语，其他语种与最终集成状态以合并后的资源为准。

测试输出和以上边界应随集成结果更新；资源键数只检查一致性，不作为页面覆盖率或端到端完成率。
