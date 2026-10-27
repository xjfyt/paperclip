# 任务详情反馈、属性与 Agent 指令编辑器四语验收

日期：2026-10-27。对应第三批4437键整合；范围为 `IssueDetail` 操作反馈、`IssueProperties` 执行/归档状态和 `AgentDetail → PromptsTab`。**这是待执行的真实浏览器清单，不是手测通过报告。** 最终整合结果以 [VERIFICATION](../VERIFICATION.md) 为准。

## 验收准备与记录

- 使用隔离测试实例、脱敏任务/Agent/工作区夹具，关闭真实模型、自动执行和通知 worker。恢复、重发、停止、归档、指令保存/删除均只对专用夹具操作；本清单不授权生产写入、收费调用或真实工作区修复。
- 准备失败运行、可停止运行、已归档任务、review/approval 各阶段、异常执行策略，以及含旧入口保留修改的指令记录。缺少夹具的项目记“未执行”，不能以空态或隐藏入口代替。
- 每项分别执行中文 `zh-CN`、英文 `en`、西班牙语 `es`、日语 `ja`；另执行同一已打开页面内的四语连续切换，不能全部用刷新页面代替。桌面、窄屏各检查一次换行、溢出、可点击范围、键盘焦点和无障碍名称。
- 记录应用提交、浏览器/OS/输入法版本、语言、夹具标识、实际结果和脱敏截图。网络面板只记录方法、路由及必要的测试字段；不保存 cookie、token 或完整本地存储。记录“通过／失败／未执行”和原因。

| 关键可见文案 | 中文 | English | Español | 日本語 |
| --- | --- | --- | --- | --- |
| 重试排队 | 重试已排队 | Retry queued | Reintento en cola | 再試行をキューに追加しました |
| 撤销归档 | 撤销 | Undo | Deshacer | 元に戻す |
| 发起审查 | 立即开始审查 | Run review now | Iniciar revisión ahora | 今すぐレビューを開始 |
| 取消归档中 | 正在取消归档… | Unarchiving… | Desarchivando… | アーカイブ解除中… |
| 指令视图 | 阅读／编辑／源码 | read / edit / raw | leer / editar / fuente | 閲覧／編集／ソース |
| 复制完成 | 已复制 | Copied | Copiado | コピーしました |

表格是定位样例，不是全部译文；完整期望值见下方贡献文件。系统标签应翻译，用户文字、文件路径、技术标识与服务端原始诊断不应翻译。

## DETAIL-FEEDBACK：真实任务详情的操作反馈

1. **失败运行重试**：在详情页对已有失败运行点击重试，观察 pending、排队成功与失败。请求必须保留原 company/agent/run 身份；找不到运行时显示当前语言的本地错误且不发重试请求。有新 `runId` 的成功响应不能被错误描述成仍在排队。
2. **保存失败**：输入含中文、日文和 `{{keep}}` 的任务草稿，在专用故障夹具返回 `Error` 与非 `Error` 失败。标题与本地回退使用当前语言，`Error.message` 按原文显示；不把任意对象序列化成提示。失败后草稿与再次编辑能力仍在，提交内容不因换语被改写。
3. **停止并完成／取消**：分别检查成功、停止失败、停止成功但状态更新失败。停止请求必须先于状态更新；停止失败不能继续更新状态；部分成功必须明确“运行已停止，任务更新失败”，不得显示全部失败或全部成功。pending 时两个收尾动作均不可重复执行；恢复后可正常操作。
4. **归档与撤销**：从详情菜单归档，检查本地化成功提示、撤销入口、收件箱导航；分别模拟归档失败、撤销失败和撤销成功。失败要维持正确的收件箱回滚状态，不能把失败显示成已恢复，不能因语言切换新增归档/撤销请求。
5. **完成时语言与历史提示**：让归档请求保持 pending，切换语言后返回成功，新 toast 应使用完成时语言；再切语并点击已有撤销，新反馈用最新语言。已出现的 toast 保留原来的文字和操作标签，不要求追溯重写。

## RECOVERY：恢复操作拒绝被接住，不重放动作

1. 在隔离夹具分别检查恢复状态、隔离重发、`forward`、`override` 和 `quarantine_restore` 的成功/失败反馈。保留原 `actionId`、工作区ID、状态、mode、操作理由和重发参数；译文不能进入这些请求字段。
2. 让各恢复请求分别以原始 `Error` 和非 `Error` 对象拒绝。每次只产生一次对应错误反馈，pending 能结束；控制台不得出现 `Uncaught (in promise)` / `Unhandled Promise Rejection`，专用浏览器测试的 `unhandledrejection` 记录应为空。不得用全局吞错来达标，也不能把接口拒绝当成操作成功。
3. 在请求 pending 时切换四语，检查请求数量、身份和操作理由不变；按钮禁用/忙碌状态不能被换语解除。失败后仅在明确再次点击时重试，不因重渲染自动重发。
4. 没有执行工作区时，forward/override 显示本地化“无法协调”提示，quarantine restore 显示“无法修复”提示，不调用 reconcile 接口。隔离重发成功有标识时导航到新任务，无标识时只显示相应成功回退，不能构造错误地址。
5. 此处“无未处理拒绝”只验恢复事件的调用链；失败运行重试、任务保存等有返回值的调用仍可返回拒绝，必须由各自实际调用方正确处理，不能据此声称全部异步路径已通过。

## PROPERTIES：状态文字变化，属性合同不变

1. **执行阶段**：分别查看 review/approval 的 pending 与 changes_requested，有参与者/无参与者两种记录；阶段文字与 tooltip 四语正确，参与者原名不变。pending 不显示可重复启动入口；可发起时“立即审查／审批”仍只提交既有 `{ status: "in_review" }`，换语本身不写任务也不重新读取 Agent 列表。
2. **防护与关系**：异常执行策略显示本地化不可用说明，不能恢复本应隐藏的编辑控件或清除已有策略。检查超过两个阻塞项/子任务的数量摘要、添加子任务、Triage、来源中的 via，以及子任务原始标题。优先级开关仍关闭，不因新增译文而出现 Priority 控件。
3. **PR 加载失败**：本地化失败说明与重试入口；切语不自动拉取，明确点击重试才请求一次原任务的 work products，成功后正确退出错误状态。
4. **取消归档**：检查归档人原名、时间和本地化 tooltip；pending 中按钮禁用并显示本语言状态。切语不产生第二次请求；失败后本地回退随语言更新，服务器诊断保持原文。再次点击成功后错误清除。
5. **稳定选择器**：在开发者工具核对可见标签翻译，但 DOM 合同保持 canonical 英文：`[data-property-label="Execution"]`、`[data-property-label="Archived"]`、`[data-property-label="Pull requests"]`，以及对应布局的 `Subtasks` / `Sub-tasks`。行/值/区块钩子仍为 `data-property-row="true"`、`data-property-value="true"`、`data-property-section="true"`。定位不要依赖翻译后的文字充当属性值；Triage 是区块标题，不能凭空要求同名行钩子。

## INSTRUCTIONS：换语保留草稿、原路径和选区

1. **文件与视图**：打开 Agent 指令页及高级区，检查入口徽标、managed 空路径回退、文件语言说明、废弃虚拟文件、新文件说明、阅读/编辑/源码、复制的可见反馈及 aria 名称。原根路径、文件名、语言ID、指令正文必须原样显示，不能把其中的 `<strong>` 等片段解释成系统错误区域的 HTML。
2. **连续换语**：分别在真实 Markdown 富文本编辑器与 raw 文本编辑器输入未保存的中文/日文多行草稿，设置非空选区，记录当前文件、编辑模式、dirty 状态及内容；不刷新页面连续切换四语。草稿、当前文件/原路径、选区及保存可用状态不因编辑器重建而丢失。语言控件主动接管焦点应单独记录，返回编辑器后检查选区，不把正常控件焦点移动误判为草稿丢失。
3. **真实 IME**：用操作系统中文拼音、日文输入法在组合输入中换语；候选确认 Enter 不得意外保存/提交，组合结束后的字符不可重复或丢失。换语、返回编辑器、普通输入、关闭再打开分别检查。仅派发 composition 事件或直接填值不能算此项通过。
4. **保存基线**：保留未保存草稿时让测试夹具出现更新的服务端内容，再切语并显式保存。请求应保留开始编辑时固定的 `baseHash` / `baseRevisionId`、原始 path 与精确 content；不能因为翻译重渲染换成新基线、自动保存、清除草稿或触发候选解决请求。冲突时显示错误并继续保留草稿。
5. **旧入口保留修改**：用 `OLD.md → CURRENT.md` 夹具展开保留修改，检查只读区域、原/现路径、说明和复制名称四语；原正文不变，无可编辑控件，单纯查看/换语/复制不启用保存，也不请求旧入口文件或解决候选。明确切入当前入口编辑并粘贴后，才按当前入口的正常保存基线保存。
6. **真实剪贴板与删除同意**：实际复制指令及保留修改，粘贴到测试文本区核对换行、Unicode、标记原文；另测剪贴板权限拒绝，不把 mock 调用成功当成系统复制成功。删除非入口夹具时确认框翻译、路径原文；取消不得发送删除，明确确认才按原路径及基线删除一次。

## ERRORS：本地键和服务端原文不能混淆

- 用三类诊断复验属性归档与指令候选错误：普通原文、恰好等于英文回退的原文、看起来像翻译键的原文（例如 `agentInstructionEditorUi.editsNotRetrieved`）。服务器 `Error.message` 三者都必须保持字面内容，换语不能靠文本匹配把它改成译文。
- 真正的本地错误来源才随语言即时刷新：属性控件以 local/server 来源区分，指令编辑器以 `ManagementUiError` 区分。确认 `<strong>原文</strong>`、`{{keep}}` 等测试串不被当作 HTML 或再次插值；不展示错误对象的隐藏字段。
- 任务详情 toast 的标题/本地回退、停止后部分成功的系统说明可以翻译，但其中嵌入的原始诊断仍完整保留。历史 toast 的保留规则见 DETAIL-FEEDBACK 第5项。

## 源码证据、已有验证与未覆盖边界

| 提交 | 实现与测试证据 | 已有记录的窄范围结果 |
| --- | --- | --- |
| `eb860181` | [IssueDetail.tsx](../../../ui/src/pages/IssueDetail.tsx)、[IssueDetail.test.tsx](../../../ui/src/pages/IssueDetail.test.tsx)：actual host 的 retry/save/stop/archive/recovery、当前完成语言、缺工作区守卫；无返回值恢复事件从 `void mutateAsync` 改为 `mutate`，沿用 `onError`。 | 提交记录为3文件182项通过；旧实现对照出现10个未处理拒绝，修复后为零。不是本清单新跑的浏览器结果。 |
| `e94a1472` | [IssueProperties.tsx](../../../ui/src/components/issue-properties/IssueProperties.tsx)、[IssueProperties.test.tsx](../../../ui/src/components/IssueProperties.test.tsx)、[property-labels.ts](../../../ui/src/i18n/property-labels.ts)、[primitives.tsx](../../../ui/src/components/issue-properties/primitives.tsx)：阶段、关系、归档、错误来源、canonical hooks 与请求数量。 | 提交记录为2文件256项通过；不等于窄栏或真实接口已手测。 |
| `dc1eb4dd` | [AgentDetail.tsx](../../../ui/src/pages/AgentDetail.tsx)、[AgentDetail.instructions.test.tsx](../../../ui/src/pages/AgentDetail.instructions.test.tsx)：四语元数据、draft/selection、原路径、固定 revision/hash、只读保留修改和原始错误。 | 提交记录为1文件33项通过；MarkdownEditor 使用 textarea mock，剪贴板函数也被 mock。 |

译文来源：[issueFeedbackUi](../../../ui/src/i18n/contributions/issueFeedbackUi/)、[issueRecoveryUi](../../../ui/src/i18n/contributions/issueRecoveryUi/)、[issuePropertyControlsUi](../../../ui/src/i18n/contributions/issuePropertyControlsUi/)、[propertyLabels](../../../ui/src/i18n/contributions/propertyLabels/)、[agentInstructionEditorUi](../../../ui/src/i18n/contributions/agentInstructionEditorUi/)，均有 `zh-CN/en/es/ja.json`。贡献结构与占位符测试只证明对应词条合同，不证明所有实际页面都消费了它们。

截至2026-10-27 11:20 UTC，主流程冻结 `fb68632d` 的中央证据如下；本清单仅补 Markdown，未重跑重型测试：

- 完整 UI 类型检查通过：`/tmp/paperclip-4437-ui-types.log`。
- 生产 UI 构建通过：`/tmp/paperclip-4437-ui-build.log`；仍有混合动态/静态导入及大 chunk 警告，不称零警告构建。
- 定向 UI 回归5文件467项通过，无未处理拒绝报告：`/tmp/paperclip-4437-focused-ui-final.log`。第一次从仓库根目录调用 UI 配置因找不到 `vitest.setup.ts` 导致5个 suite、0项测试失败；改为 `cwd=ui` 使用原配置后通过，没有为通过而改源码或断言。
- 42项 Node 脚本测试与本批 gates 通过：`/tmp/paperclip-4437-scripts.log`，含四语4437键校验及 token gates。
- **4437键完整UI首轮未通过，第79批发现旧英文源码契约；修复后与后续4513键合并重新全量验证，见VERIFICATION。真实浏览器手测未执行。** 真实 MDXEditor 输入法、系统剪贴板、视觉布局、浏览器网络时序及服务端交互仍须按上文逐项记录，不能由类型检查、构建或 mock 测试替代。

审计见 [I18N-AUDIT-20261027-4437.json](I18N-AUDIT-20261027-4437.json)：扫描73个文件，467条字面量候选、1841处动态候选。**4437是本批语言键数；候选数不是剩余未译数量，不是全站覆盖率，也不能与旧审计直接相减计算完成度。** 审计不递归证明完整调用图，识别出的翻译调用也不等于译文和渲染都已验证。
