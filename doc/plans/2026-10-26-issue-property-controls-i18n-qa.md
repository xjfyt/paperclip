# 任务属性选择器四语补齐与待验收记录

## 范围与实现证据

- 实际入口：`TaskSidePanel` → `components/IssueProperties.tsx` re-export → `issue-properties/IssueProperties.tsx`。兼顾桌面弹层、inline 折叠选择器；不是另造未使用页面。
- 第一片：标签新增/搜索/颜色及折叠计数、项目空选项显示、父任务/阻塞/子任务固定提示。贡献域 `issuePropertyControlsUi`，四语源文件由主集成统一合成，未编辑正式 locale。
- 第二片：属性/子任务/引用/计划/产物 tabs、关闭/重开 aria、路径复制 aria 和反馈。保留原始 tab value 与剪贴板值。
- `PropertyRow` / `PropertySection` 已经由 `property-labels` 翻译，保留其英文稳定输入及 `data-property-label`，不机械重复抽取。
- 项目名称、标签名称、任务正文/标题/标识不翻译；项目空选项额外匹配当前可见译文，保留原始 `No project` 英文搜索兼容；真实项目名称仍只匹配原名，不改变排序、请求或清空 payload。此窄兼容修正经独立审阅发现并获集成确认。
- 不变更权限、API、查询 key、请求/确认/写入处理及 hooks 依赖。原始错误/未知诊断保持原样。

## 自动化验证

- 使用本工作树 `ui/vitest.config.ts`，`@` 映射到本工作树 `ui/src`；依赖链接复用主树安装，不修改共享 node_modules。
- `NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run --config vitest.config.ts src/components/IssueProperties.test.tsx --maxWorkers=1`：第一片 97/97 通过；两片最终组件 101/101，贡献契约 4/4，共 105/105 通过。
- 四语真实组件测试验证标签/项目/父任务/阻塞提示、原始用户名称与 ID 写入，以及原地切换语言不新增读取/写入调用。四语测试同时验证“无项目”可见译文/原英文都可搜索，清空仍提交原五个 null 字段，真实项目名仍逐字匹配。
- 新增四语 tabs/复制测试：关闭子任务 tab 后切换语言仍保持关闭，可用新语言菜单重新打开；复制包含中文的路径逐字保持，tab 操作不写入任务且不额外刷新 work products。既有分配中断/确认等回归随完整属性组件套件通过。
- `node scripts/check-token-gates.mjs` 与 `git diff --check` 通过。
- 磁盘不足 1 GB，遵循集成资源约束，未运行全量测试、类型检查、build；上述定向测试不等于全仓或浏览器验收通过。

## 用户待测（均未实测）

四语逐项测试并记录浏览器、版本、语言、UI 模式和结果：

- 桌面/inline：打开与关闭标签、项目、父任务、阻塞选择器；输入查询后切换语言，查询与用户数据保持原样，未发生保存或额外请求。
- 中文真实 IME：标签名称及搜索输入拼音组合中按 Enter 不误创建/切换关系；组合完成后点创建仅提交一次。日语 IME 同样验证。jsdom 不证明真实 IME 行为。
- 320/375 px 窄屏及西语长文案：按钮、颜色选择器、提示、横向空间无覆盖；日语换行可读；键盘焦点和 aria 标签对应。
- 侧栏 tab 关闭/重开、切换语言和窄屏键盘焦点：计划/产物/引用/子任务标题与关闭 aria 同步，复制路径提示改变但剪贴板内容不变。
- 取消/关闭弹层后重新打开，键盘 Escape、反复点击和页面后退/前进保持原有选择状态。
- 选择/清空项目、父任务、阻塞、标签后重载核对服务器实际持久化；无权限场景保留原拒绝行为。

## 明确后续边界

模型覆盖、watchdog、monitor/计划重试、工作区控制与未知错误尚未在本片全部翻译；不能以 AST 候选数下降宣称整个高频路径或原计划完成。本次已完成的第二片仅处理属性侧栏 tab 与复制路径的固定文案，未扩展到其他控制流程。

## 第四片：实际 composer 负责人空项（浏览器发现后修正）

- 集成 Chrome 人工检查发现负责人 aria 已本地化，但底部可见文本仍显示 `No assignee`。本片不以 aria 通过代替可见文本验收。
- 实际 `TaskChatComposer` 分支：存在 `companyId` + `modelAgents` 时使用 `ComposerRunSettingsPicker`；否则使用 `InlineEntitySelector`。两支系统空项、搜索提示、无匹配提示均补齐四语，运行设置 picker 的负责人标题/列表 aria 一并补齐。
- 新贡献域 `composerAssigneeUi`（7 keys）；未编辑正式 locale、main、模型设置语义或发送键事件。
- `InlineEntitySelector.noneSearchText` 是可选属性，默认完全保持旧行为；仅 composer 传入 `No assignee` 别名。系统空项匹配当前显示译文和原英文；运行设置 picker 还保留 `Unassigned` 旧别名。用户 Agent 名称、角色、模型标签、id 和配置不翻译、不改写。
- 定向测试覆盖两个实际组件的可见 `textContent`、译文/英文搜索、动态语言、无匹配状态、用户名称保持、空字符串负责人回调及原 `null` 设置清空；选中 Agent 时语言变化不重拉模型、不修改设置，fallback 不发送消息。
- 使用本 worktree 的 `ui/vitest.config.ts`（`@` 指向本树），共享依赖只读复用；单 worker、512 MB。最终 4 文件 155/155 通过（两 composer 分支、InlineEntitySelector 回归及四语贡献契约），token gates 与 diff 检查通过；未跑重型 types/build。
- 待实际浏览器复验：四语分别进入已有负责人/无负责人的任务；检查底部可见文字和展开列表；译文与英文搜索；切语言不发送或保存；西语 320/375px、日语换行、真实中日 IME 输入/组合取消、Escape/反复开关。模型选择/effort 内其余固定英文不属于本片，仍留后续。
