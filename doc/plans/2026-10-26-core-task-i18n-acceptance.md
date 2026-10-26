# 核心任务界面 i18n 补齐与人工验收（2026-10-26）

## 范围与边界

对照原计划再次检查实际挂载路径，本次只补齐以下可见文案，不改变执行、分配、权限或预算逻辑：

- `SidebarAgents.tsx` 与 `SidebarAgents.production.tsx`：行菜单、暂停/恢复结果、禁用原因、预算与汇报关系无障碍提示、排序菜单。
- `NewIssueDialog.tsx`：父任务/工作树检查、子任务创建、私密继承、已分配待规划说明、暂停/导入说明与项目选择。
- `issue-properties/IssueProperties.tsx`：负责人、审查人、审批人选择器内的搜索、空选项、分组、分配按钮；保留已有 PropertyRow 标签映射。
- 补齐 `app.cloudCreateUnavailable` 四语；中文可选配置统一使用 `Agent`；西语 WeCom 脱敏说明改为 `con datos ocultos`，避免被理解为“已起草”。

保留用户提供的名称、任务编号、MIME、路径、分支和接口状态值。未挂载的 `CommentThread.tsx` 不在本次切片；本文件不宣称整个应用已无英文库存债务。子控件 `ComposerWorktreePicker`、`BuiltInAgentBadges` 的部分英文，以及共享 `useResourceMemberships.ts` 的退出/收藏结果与错误 toast，仍需后续单独补齐，未扩大到这些模块。
新增四语贡献位于 `ui/src/i18n/contributions/coreTaskUi/`。集成时必须由统一流程重新生成根 locales；本分支不直接编辑生成产物。测试通过测试专用资源装载器读取贡献文件。

## 自动检查

在现有依赖上执行，Node 堆限制 512 MB、单 worker，无服务、DB、外网或依赖安装：

```sh
cd ui
NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run \
  src/components/SidebarAgents.test.tsx \
  src/components/NewIssueDialog.test.tsx \
  src/components/IssueProperties.test.tsx \
  src/i18n/core-task-messages.test.ts --maxWorkers=1
```

结果：4 个文件共 235 项测试通过（SidebarAgents 42、NewIssueDialog 91、IssueProperties 93、core-task-messages 9）。覆盖四种语言、两种侧栏实现、打开菜单后的语言切换、预算暂停禁用状态、父任务失败时的提交门禁、待规划/导入暂停说明、负责人本地化搜索及名字中的尖括号按纯文本呈现。字典检查覆盖键集合、插值、富文本组件槽位和品牌名称。

另外执行 `git diff --check` 与设计 token 三项门禁（`check-token-gates.mjs`、`sync-agent-palette-tokens.mjs --check`、`sync-cliplab-character.mjs --check`）。
静态可见字面量扫描在两份侧栏模块返回 0 项，在新建任务模块仅余应保留的 `application/octet-stream`；这不是全应用翻译覆盖率。
未运行全库 typecheck/build、浏览器 E2E、真实授权请求或真实 Agent 运行；以下项目仍需人工验收。

## 人工验收（全部待执行）

语言组合：`zh-CN / en / es / ja`；外观组合：桌面展开、折叠侧栏、移动端；界面组合：精简与经典。

- [ ] 打开 Agent 行菜单，核对收藏/取消收藏、编辑、暂停/恢复、退出；保持菜单打开切换语言，菜单及时刷新，Agent 名称原样不变。
- [ ] 分别使用手动暂停、预算暂停、无效汇报关系、内置待配置/待审批 Agent：核对禁用原因、屏幕阅读器名称、悬浮提示；预算/无效关系不得因切换语言而解锁恢复。
- [ ] 检查排序菜单三项翻译；切换排序、关闭再打开、刷新后顺序仍遵循原有保存规则。
- [ ] 仅在允许的测试 Agent 上执行暂停/恢复，验证成功与失败 toast 本地化、名称准确、等待中不能重复操作；取消/关闭菜单不得发请求。
- [ ] 从父任务创建子任务：慢网络期间显示正在检查且禁止创建；模拟父任务查询失败后错误与重试本地化；重试成功继承私密权限，父任务标题/编号不被翻译。
- [ ] 选择失效工作树或模拟工作树列表错误：错误本地化且禁止提交；改选可用/新工作树后恢复原有创建规则，工作树名/分支不变。
- [ ] 选中暂停 Agent（含从组织导入的 Agent）以及“已分配但待规划”草稿，核对说明完整、加粗内容正确、窄屏不裁切；新建任务不应意外恢复 Agent。
- [ ] 新建窗口项目选择器：搜索、空选项、移动端标题和私密继承说明本地化；取消、Esc、再次打开仍按原有草稿规则工作，不重复创建。
- [ ] 属性面板搜索负责人/审查人/审批人：本地化搜索标签与屏幕阅读器名称正确；搜索本地化“无负责人”可命中，随机不存在文本显示本地化无结果；真实用户及 Agent 名称保持不变。
- [ ] 属性面板选择“分配给我”、请求人及具体 Agent：使用原有 ID 发起分配；有运行时仍先经过原有中断确认，取消不改变分配。
- [ ] Cloud 无可用创建地址时提示四语完整，Paperclip Cloud 不翻译且不显示无效创建按钮；中文可选配置使用 `Agent`；西语 WeCom 提示明确为敏感数据隐藏，不暗示可重建配置。

记录建议：语言/界面模式、测试数据、操作、预期/实际、截图、是否产生请求；失败时保留错误与复现步骤。
