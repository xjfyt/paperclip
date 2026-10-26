# 企业微信接收管理 UI：实现与人工验收

## 实际范围

新增 `MimouseWecomPanel`，放在 `MimouseFeedback` 中 Langfuse 面板旁边。
只调用现有连接列表、注册、启停以及公司 secret **metadata list**。
不调用供应商、不测试发送、不自动回复、不调用模型、不改变全局 worker 开关。
不提供配置编辑：当前 list 刻意隐藏 botId、范围内容和 secret 引用，不能由列表反推完整配置；没有虚构 detail/versions endpoint。

列表展示 product、state、enabled、imported、允许群/发送人数量与 gapDetected；明确最多 100 条按创建时间倒序，无分页接口。状态不是送达证明，gap 不会因刷新消失，不支持历史重放或历史完整性保证。产品名称等内容用 React 文本节点显示，不解释 HTML/脚本。

### 权限与操作边界

- 面板要求 companyId + userId + **真实 session.id**，不能用 local-board 或 userId 代替 sessionId。现有 Feedback 页其他功能保留原行为，WeCom 独立 fail-closed。
- 列表/已有连接启停权限最终由既有服务端公司管理员/owner/实例管理员鉴权决定。首次注册还由服务事务检查当前 instance_admin 角色；UI 不自授注册权限、不把界面可见当权限证明。
- 注册始终为 disabled：请求正文只有 transport/botId/product/明确 scope 数组/secret 数字 pin，**不包含 enabled，也不紧跟启用请求**。
- 启用另行勾选确认，文案明确“全局 worker gates 允许时可能实际连接并接收消息”。设置 enabled 不直接创建连接，但不能误称启用不会产生后续网络活动。禁用说明在途工作可能完成、遗漏不可重放。
- 注册前必须核实机器人所有权、供应商模式与允许范围。UI 不做全局 bot 归属探测、不获取其他公司的连接。

### 凭据与敏感状态

`ui/src/api/wecom.ts` 使用非合并 `requestResponse` + `readApiJson`，所有 GET 含 signal/no-store，不使用 api.get 的 URL-only inflight map。没有 React Query/global/localStorage/sessionStorage 面板缓存。

Secret metadata 仅保留同公司、scope=company、status=active、deletedAt=null 且数字版本合法的项；投影为 id/name/version，不把 externalRef/providerMetadata 交给 UI。选中时将 metadata 的 numeric latestVersion **复制为固定数字**，可明确选择更早的正整数版本；不会提交字符串 latest，也不会在后台自动随版本变化。服务端最终验证 current/previous、未撤销等条件。

现有 `environment-variables-editor/SecretPicker` 有创建 secret 路径及保留非 active 绑定的行为，本切片不复用这些能力，而采用只读 metadata 选择。无 raw secret 字段、create/reveal/rotate、版本详情或凭据测试 API。

auth session 正在 refetch 时，父级不给 WeCom 传旧 sessionId，私密子树会卸载；验证结束后重新挂载，原 Feedback 其他流程不因瞬时 refetch 被重置。组件按 company/user/session 三维 key 重建。身份变更后旧请求被中止，晚到读取/写入结果不更新新页面；401/403 或读取错误清空私密数据、草稿和确认并隐藏操作。重新刷新权限成功也不恢复被清空的草稿。

### 未知结果不能重放

现有 create 接口没有 requestId/idempotency receipt，故绝不加入“重试创建”。未知 POST 响应（创建或启停）冻结所有写控件：

1. 操作者手动“刷新状态”，仅 GET，不重复 POST。
2. 脱敏列表不能证明具体 bot 身份，产品名称也不是唯一标识；必须与管理员、服务器审计/实际状态独立核对。
3. 只有刷新成功后，才提供“我已独立核对，丢弃草稿”本地动作；它不发请求，清空 bot/scope/secret pin/操作确认后解锁新的意图。

本面板不声明能自动判断原创建是否成功。离开页面/身份切换会丢弃本地未知状态，未把敏感草稿持久化；回来后仍须人工核对，不能因为页面已重置就重复原 POST。400/404/409 明确拒绝会提示检查，不自动重试；403 清空页面。

## 集成清单

- 已直接挂载到 `ui/src/pages/MimouseFeedback.tsx`，将实际 `session.id` 传给新面板，并使 FeedbackCompany 的本地状态 key 包含 session。
- 四语言贡献：`ui/src/i18n/contributions/wecomUi/{en,zh-CN,es,ja}.json`，38 keys。父集成运行 `node scripts/compose-mimouse-locales.mjs`；本提交不改生成 locale、根 App/sidebar/index/package 或后端。
- 仍沿用 `/api/companies/:companyId/feedback-wecom/connections` 后端及服务权限；若生产未挂载应先集成后台，不以 UI 代替权限验证。

## 已运行与尚未运行

已运行的窄纯测试（512 MB heap、单 worker）：API actual-transport、WeCom UI、既有 Feedback 与 Langfuse 回归四个文件。**最终 4 files / 43 tests passed，7.98 秒**；未调用真实网络/DB/worker。分文件：`ui/src/api/wecom.test.ts` 5、`ui/src/components/MimouseWecomPanel.test.tsx` 12、`ui/src/pages/MimouseFeedback.test.tsx` 17、`ui/src/components/MimouseLangfusePanel.test.tsx` 9。verbose 日志有仓库 jsdom/React `act(...)` 环境配置警告，断言均通过；未更改共享测试环境掩盖警告。日志 `/tmp/wecom-admin-ui-tests.log`，token gate 日志 `/tmp/wecom-admin-ui-tokens.log`。

覆盖 retained old observer + new session 同 URL 独立 HTTP、signal/no-store、迟到中止、secret 元信息过滤及数字 pin、disabled-only 注册、显式启停确认、未知请求不重放、手动核对后清草稿、三维身份切换、晚到读写、403、失败读取、四语言及 inert HTML 文本，以及 Feedback 中传递 actual session 身份的挂载测试。

`node scripts/check-token-gates.mjs` 全 clean；`git diff --check` 通过。没有运行完整 typecheck/build、真实浏览器、DB、供应商长连接或真实租户测试；不能宣称 live 接收资格已通过。原 P3 后端资格仍以 `doc/connections/MIMOUSE-WECOM.md` 为准。

集成后纯测试命令：

```sh
NODE_OPTIONS=--max-old-space-size=512 pnpm --filter @paperclipai/ui exec vitest run src/api/wecom.test.ts src/components/MimouseWecomPanel.test.tsx src/pages/MimouseFeedback.test.tsx src/components/MimouseLangfusePanel.test.tsx --maxWorkers=1
node scripts/check-token-gates.mjs
```

## 用户拉取后人工验收

1. 使用 disposable 环境、全局 WeCom worker gate 关闭，**先不要连接真实租户**。用真人公司管理员打开 Feedback，确认已有反馈导入、证据审阅、Langfuse 面板原流程不变，旁边新增企业微信连接面板。
2. 切换 en/zh-CN/es/ja，确认边界/无重放/启用可能连接/instance-admin 注册说明均翻译完整。列表查看 id/product/state/enabled/imported/counts/gap；无 botId、group/sender 明细、secret 引用或 raw credential。
3. 准备 metadata fixtures：active company、user scoped、inactive、deleted、foreign company。点击“准备禁用状态注册”，仅第一类可选。网络仅有 GET 公司 secrets；无 reveal/versions/create secret。
4. 填 botId/product 和至少一行 group 或 direct sender。选凭据，检查显示具体数字版本；修改 pin 或任一字段后确认勾选应清除。无 scope、非法 ID、0/非整数 pin 不可提交。
5. 公司管理员但非 instance-admin 尝试注册，应由服务器 403；私密草稿/metadata/操作隐藏。以真正 instance-admin 登录，另行核实 ownership 后确认注册；请求没有 enabled，返回 disabled，网络没有紧跟 `/enabled` 或供应商连接。全局 gate 仍关闭。
6. 已有连接点击启用，独立确认前不可提交。检查明显 CAN CONNECT 警示；确认后只发 `{enabled:true,confirm:true}`。禁用同样需独立确认。此测试只验证管理请求，不是供应商送达证明。
7. disposable 环境注入 POST 服务端提交后响应丢失。不能再点原注册/启停，手动刷新只 GET，无隐式重试。独立核对实际持久状态/审计后点击“已独立核对，丢弃草稿”，确认 bot/scope/secret pin 已清空；不要用相同产品名推断 bot 已注册。
8. 在读取 secret metadata 或提交在途中切公司/用户/同用户重新登录 session；旧结果不能出现在新会话，草稿和确认清空。模拟 retained old observer，再从新 session 打开同 URL，网络必须是两次独立 fetch。
9. 撤销管理员权限/令读取失败，再刷新：私密内容与写操作隐藏；权限恢复后刷新不会恢复旧草稿。缺少真实 session 的页面不请求 WeCom/secret 数据。
10. 检查页面无编辑完整 config、测试发送、自动回复、重放历史或全局开关按钮；刷新不能将 gap 标记解释为已修复。只在另行授权真实租户资格验证时开启 worker gate，按后端文档测试连接，不把本 UI 验收当作该授权。
