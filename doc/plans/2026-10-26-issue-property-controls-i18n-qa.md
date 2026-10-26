# 任务属性选择器四语补齐与待验收记录

## 范围与实现证据

- 实际入口：`TaskSidePanel` → `components/IssueProperties.tsx` re-export → `issue-properties/IssueProperties.tsx`。兼顾桌面弹层、inline 折叠选择器；不是另造未使用页面。
- 第一片：标签新增/搜索/颜色及折叠计数、项目空选项显示、父任务/阻塞/子任务固定提示。贡献域 `issuePropertyControlsUi`，四语源文件由主集成统一合成，未编辑正式 locale。
- 第二片：属性/子任务/引用/计划/产物 tabs、关闭/重开 aria、路径复制 aria 和反馈。保留原始 tab value 与剪贴板值。
- `PropertyRow` / `PropertySection` 已经由 `property-labels` 翻译，保留其英文稳定输入及 `data-property-label`，不机械重复抽取。
- 项目名称、标签名称、任务正文/标题/标识不翻译；项目空选项仍以原始 `No project` 参与现有过滤，只有显示文本本地化，避免暗改筛选契约。
- 不变更权限、API、查询 key、请求/确认/写入处理及 hooks 依赖。原始错误/未知诊断保持原样。

## 自动化验证

- 使用本工作树 `ui/vitest.config.ts`，`@` 映射到本工作树 `ui/src`；依赖链接复用主树安装，不修改共享 node_modules。
- `NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run --config vitest.config.ts src/components/IssueProperties.test.tsx --maxWorkers=1`：第一片 97/97 通过；两片最终组件 101/101，贡献契约 4/4，共 105/105 通过。
- 四语真实组件测试验证标签/项目/父任务/阻塞提示、原始用户名称与 ID 写入，以及原地切换语言不新增读取/写入调用。
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
