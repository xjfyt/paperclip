# Agent 配置四语验证与边界（2026-10-29）

## 已覆盖的实际入口

- `AgentConfigForm`：编辑表单、Secrets 子页、环境选择、运行策略、帮助、保存、模型/推理强度与测试反馈；`Field` 不自动翻译任意入参，本地调用点显式提供译文。
- `PrimaryAgentPresentation`、`AgentLifecycleStatus`：确认弹窗、可访问名称、进行中状态与重试。
- `TrustPresetSection`：信任预设、隔离边界选择、只读策略摘要与计数；权限 key、边界 ID、工具 ID 和保存结构不变。
- `AgentChannelsPanel`：频道列表、空/加载/失败状态；只读重试不创建频道或执行 Agent。刷新失败保留同公司查询已有数据，新的公司不会借用旧公司的数据。
- `PrimaryAgentProvider`：错误回执产生时按当前语言创建 toast 标题和重试标签；正文仍是原始提供商错误。

用户名称、环境名称、模型/provider 标识、路径、URL、原始诊断和未知状态不按内容匹配翻译。三个领域贡献目录由中央 locale compose 生成，不手工修改生成 JSON。键数不是全 UI 覆盖率。

## 有意保留的错误快照合同

`AgentConfigForm` 自己持有的测试/模型刷新本地错误使用稳定 key，显示时翻译；任意 `Error.message` 不因恰好等于英文提示而被改写。

三个“未选择组织”的保护错误通过 `agentConfigurationContextError` 的明确 action code 生成 `LocalizedUiError`，同时携带稳定 `translationKey` 和**动作发生时语言**的 `message`。这些保护仍在任何创建密钥、上传图片或检测模型请求之前执行。

现有跨组件消费者（如 `SecretPopoverForm`、图片上传错误消费者）自行存储 `Error.message` 字符串。已经保存的错误快照不会因后来切换语言而改写；下一次明确操作才取得当前语言的新消息。`agent-configuration-errors.test.tsx` 用真实 `SecretPopoverForm` 验证这一边界，以及名称、值、焦点和选择区间保留。没有为本片改变编辑器的错误合同或翻译任意外部错误。

`ToastProvider` 同样保存字符串快照：已经显示的主 Agent 失败 toast 不会在语言切换后重建、重启计时或重复发送；下一次错误回执使用当时的语言。`PrimaryAgentProvider` 原有 company/user scope guard 与原请求 `Choice` 未修改；新增测试验证旧 toast 在切公司或切用户后不能重试到新上下文，以及晚到成功只更新原请求缓存。这是对既有保护的回归验证，不是新增权限行为。

## 定向验证记录

- 第一片：4 文件 158 项通过。实际表单热切保留名称、变量草稿、焦点、选择和保存 payload；主 Agent 弹窗不重建，生命周期原错误不变。
- 第二片：首次其余 3 文件 44 项通过；旧 Pi 测试按小写展示文本定位失败。仅将定位改为译文，`thinking: "low"` 和不写 `effort` 断言保留；复验真实表单 132 项通过。中央类型检查发现部分 `Environment` 夹具后，改用完整 `makeEnvironment` DTO，受影响 4 项再通过。
- 第三片：3 文件 50 项通过。包含 Trust 真实控件、频道旧公司请求晚到、新 agent 过滤、错误重试和 stale-data 保留。
- 第四片：provider/既有配置 3 文件 38 项通过。新错误边界测试首次有数组闭括号解析错误；修正后该文件 8 项通过。未把首次失败批次称为全绿。
- 每片通过 token gates 与 `git diff --check`；初次失败和复验日志均保留。未在这些组件测试中连接真实提供商、发送频道消息或执行 Agent。

完整 UI 类型检查、locale 合成与生产构建由整合提交统一验证；上述不同切片和复验的数字不能简单相加当作一次完整批次结果。未扩大到全部 adapter 配置字段，亦未声称旧 primitives 中无调用的路径弹窗副本已覆盖。
