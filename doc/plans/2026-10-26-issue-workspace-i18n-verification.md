# 任务 Workspace 属性四语核验（2026-10-26）

范围：真实任务详情 → `IssueProperties` 的工作区选择/复用、工作区链接、运行服务 QuickControls 与本地操作反馈。新增独立 `issueWorkspaceUi` 29键，未改生成 locales。

完成 Default/新建隔离/复用模式及“下次运行生效”说明、返回/搜索/加载/失败/无结果、Recent/All 系统分组、工作区链接、QuickControls 的启停/重启和辅助名称。系统分组按稳定 group.id 翻译；真实同名 All workspaces、名称、分支、路径、ID和URL保留。共享动作按钮同时翻译 Run 显示，不改变 action 值；完整 `WorkspaceRuntimeControls` 的其它标题/状态/说明，以及独立工作区页面不在本片范围。

成功反馈保存翻译键，当前语言切换会更新本地提示，不重新请求操作。非Error异常使用本地兜底键；普通服务端Error始终保留原文，哪怕恰好与本地错误句子相同。缺工作区的本地Error用对象身份区分，不靠匹配服务器错误文字猜测。请求与工作区策略、pending门禁、用户输入和执行权限不改。

## 已执行

**5文件221项通过**，512 MB/单worker：

```sh
cd ui
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/components/IssueProperties.test.tsx src/components/WorkspaceRuntimeControls.test.tsx src/i18n/issue-workspace-messages.test.ts src/lib/issue-workspace-selection.test.ts src/lib/reusable-execution-workspaces.test.ts --maxWorkers=1
```

- 四语 default/isolated/reuse 精确payload、真实同名工作区与分支保留、分组、搜索、Back；打开复用选择器切语言保留输入且不保存。
- 四语loading/error/empty完整分支及关闭不保存；现有隔离开关/策略隐藏和已绑定工作区访问回归同跑。
- 四语QuickControls启停/重启的原请求、pending全部禁用防重复；原名称/URL保留。
- 四语成功反馈/原Error/本地fallback，并在同一挂载组件切语言，不重发请求。
- 现有runtime sections/请求解析、工作区选择与复用去重/搜索纯函数回归；四语键/占位/安全文本一致。
- `check-token-gates.mjs`、`git diff --check`通过。日志 `/tmp/advanced-workspace-tests.log`、`/tmp/advanced-workspace-tokens.log`。

首次试跑发现新增测试误写了工作区命令ID（实际为service:web）及未使用的test helper import被transpiler移除；修正测试夹具、加入四语真实QuickControls回归后全文件重跑通过，未修改协议值迁就断言。没有安装依赖、改锁文件、运行全量或重型类型/构建。

## 待中央及浏览器核验

- [ ] compose + --check，实际任务详情四语选择器/提示/ARIA无raw key；生成物由中央统一提交。
- [ ] default/隔离/复用、有/无绑定工作区及原工作区继续活动说明；用户名称、分支、路径、链接不改写。
- [ ] 本地/中日IME搜索、未匹配结果、Back/关闭/重开、Escape/外部点击及后退前进，不意外提交。
- [ ] 手机、200%缩放、长西语/日语仍可读，键盘焦点返回正确。
- [ ] 授权测试环境验证启停/重启的真实请求、pending重复点击、服务器拒绝和网络失败；语言切换不再执行请求。不要因语言验收创建工作区/调用真实Agent。
- [ ] 中央类型、构建、相关宿主回归及CI。以上jsdom/单元通过不等于真实工作区操作和全应用四语通过。
