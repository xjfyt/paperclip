# P5 提示词不可变注册表：范围、集成与人工验收

## 本切片的实际能力

- 公司管理员使用**已登录真人 session** 保存提示词精确 UTF-8 内容，新增不可变 revision 与 SHA-256；不去除空白、不插值、不执行提示词。
- 通过显式 `confirmRegistryOnly: true`，手动选择 revision（`promote`）或撤销当前选择回执（`rollback`）。这是 **registry selection，不是 runtime activation**。
- 回滚只允许引用当前 head receipt，恢复该回执的 `beforeRevisionId`。首次选择可回滚为 `null`，撤销回滚也必须生成新回执。历史从不覆盖。
- head receipt CAS 防止版本 A→B→A 的 ABA；同公司同类 requestId 绑定操作参数与真人 userId。原请求重试返回原历史回执，不声称它仍是当前 head，也不重新选择。
- 所有 mutation 在一个 DB transaction 内写 revision/receipt、更新 head、插入最小审计；任一失败全部回滚。两种历史表由 SQL trigger 禁止 UPDATE/DELETE。
- 路由检查 session + 公司 owner/admin；服务再次查 `user` 和 active membership 并持有共享锁。全局 instance admin 不绕过公司成员资格。允许 active/paused 公司，拒绝 archived/未知状态。
- 列表、历史、回执与审计不返回提示词原文；管理员通过单独 revision detail 获取原文，响应 `no-store`。`prompt-registry` 全命名空间加入 HTTP 私密诊断策略；底层 SQL 错误不透传。

## 明确尚未完成 / 不应宣称

1. **无运行态应用**：不写 agent instructions、adapter/model config、managed files；不复用上游 legacy `agent_instruction_revisions`；不自动暂停/恢复 agent。
2. **无提示词实验比较**：既有 skill comparison 的模板+配置一致性要求保持原样。后续 prompt comparison 必须独立固定 dataset、skill version、model/config，并将原始 recorded template 精确匹配到 revision；不能放宽 skill comparison 来伪装完成，也不能生成虚构模型运行。
3. **无质量发布门禁**：本回执不是“评估已通过/生产发布已成功”的证据。无外部调用、模型执行、身份授权、凭据或权限扩大。
4. **四语言 UI 已补齐、中心挂载待集成**：`MimousePromptRegistry` 提供 en/zh-CN/es/ja 管理界面，纯文本展示；导航、路由与生成 locale 由父集成处理。仍无运行态应用。
5. 无历史删除/归档清理端点；restrict FK 和 append-only trigger 会阻止误删。公司销毁/数据保留策略需要单独授权设计，不偷偷级联删除历史。

## 集成清单（由集成者处理中心文件）

本分支不改根 app、schema/shared 聚合 export、package.json、迁移 journal/snapshot 或生成 locale：

1. 在 `packages/db/src/schema/index.ts` export `./mimouse_prompt_registry.js`（DB 根 export 已有 schema 链时无需另添）。
2. `packages/shared` 现有 wildcard subpath 支持 `@paperclipai/shared/mimouse-prompt-registry`；若需要根导出，再显式 export 共享契约。
3. 在服务端 API router 根挂载 `mimousePromptRegistryRoutes(db)`，使用既有 session authentication 与 CSRF 防护；本路由以 `/companies/:companyId/prompt-registry` 为相对路径。
4. 为 schema 分配下一个正式迁移编号，生成 snapshot/journal。`doc/integration/prompt-registry.sql` 是 SQL 审阅提案，不是已注册迁移。优先生成表、index、FK/check；合并提案末尾的 immutable function/trigger。**不要同时执行生成建表和提案建表。** 采用 Drizzle 所需 statement breakpoints；验证没有遗漏触发器。不得只把表建好就宣布“不可变”。
5. 保留 `server/src/middleware/http-log-policy.ts` 的 `prompt-registry` 私密命名空间改动，先于路由上线。
6. 部署前完成真实 DB suite、类型检查/构建、鉴权及日志验证。迁移仅创建空注册表，不从 legacy 指令导入，也不触碰运行状态。

## API 使用（均需真人管理员 session）

基址 `/api/companies/{companyId}/prompt-registry`：

- `GET /`：分页 registry heads，`runtimeApplied: false`。
- `POST /revisions`：`{requestId, promptKey, content}`；promptKey 形如 `reviewer_v1`，首次保存创建空 head。
- `GET /{promptId}/revisions?beforeId={uuid}`：revision 元信息；无 content。
- `GET /{promptId}/revisions/{revisionId}`：精确 content，标记 `contentDisposition: untrusted_inert_text`。
- `GET /{promptId}/receipts?beforeId={uuid}`：不可变选择回执。
- `POST /{promptId}/selections`：
  - 选择：`{requestId, action: "promote", revisionId, expectedHeadReceiptId: null或当前回执UUID, confirmRegistryOnly: true}`。
  - 撤销：`{requestId, action: "rollback", rollbackOfReceiptId: 当前回执UUID, expectedHeadReceiptId: 当前回执UUID, confirmRegistryOnly: true}`。

分页每页 50，按 UUID 倒序；不是按创建时间排序。回执的 `previousReceiptId` 是权威顺序链，不能把列表第一行当作 head。`headReceiptId` 才是 CAS token。新请求返回 201，精确重试返回 200。选中相同 revision、新请求使用旧 head 或更换 actor 重试返回 409。读其他公司/其他 prompt 的 revision 不泄露内容。

内容限制：1–64,000 JS 字符且 UTF-8 不超过 128,000 bytes；拒绝 NUL 和孤立 surrogate。不要把凭据放入提示词：此注册表是应用数据库文本，不是 secret vault。

## 自动化测试与当前验证状态

### 已运行

2026-10-26：单文件纯 Vitest suite `server/src/__tests__/mimouse-prompt-registry-routes.test.ts`，**11 tests passed / 1 file passed**；512 MB heap、1 fork worker、3.88 秒。
覆盖 non-session/instance-admin/member/suspended/foreign/agent 拒绝、确认字段、inert UTF-8 契约、未知字段拒绝、SQL 错误脱敏、no-store、所有方法/大小写/absolute URL 私密日志分类、无 execute/PATCH/DELETE。
初次加载因 worktree 缺少 shared/zod 依赖链接失败（0 tests），补只读依赖链接后重新通过。仅使用临时 Vitest alias 加载新共享子路径，未修改根 node_modules 或安装依赖。日志：执行环境 `/tmp/prompt-registry-vitest.log`。

### 已编写、**未运行**

`tests/mimouse/prompt-registry.spec.ts` 的 5 个真实 DB fixture：

1. 精确 Unicode/空白 hash、同 request 并发仅一条 revision、一条审计、不同 actor 重放拒绝；SQL UPDATE/DELETE 被 immutable trigger 拒绝。
2. 并发 promotion 只有一个成功、receipt-linked rollback、ABA stale head 拒绝、历史重放不改 head、无 heartbeat run。
3. 第一次选择回滚为 null，paused 公司正常使用 registry，仍未执行任何运行。
4. 不同公司/不同 prompt revision 拒绝、DB membership 撤销后拒绝、archived 公司拒绝。
5. **真实 audit INSERT trigger 故障**：receipt/head 原子回滚；测试 trigger 仅作用于本 fixture 公司，finally 清除。

未运行原因：父集成正在完整 build，要求禁止启动额外 DB/server/安装/重型测试。尚未跑此切片类型检查、迁移、完整 build、浏览器或生产冒烟，不把以上 fixture 描述成通过。

集成后窄纯测试：

```sh
NODE_OPTIONS=--max-old-space-size=512 pnpm --filter @paperclipai/server exec vitest run src/__tests__/mimouse-prompt-registry-routes.test.ts --maxWorkers=1
```

真实 fixture：先依 `tests/mimouse/playwright.config.ts` 建立**全新可丢弃 home**、`.mimouse-test-fixture` 标记（内容 `paperclip-mimouse-disposable-fixture-v1`），不得包含真实 config/.env；确认独立 fixture server 与 54329 DB 端口空闲。使用仓库既有 MiMouse fixture 启动说明与全部外部 provider 禁用环境，再运行：

```sh
PAPERCLIP_MIMOUSE_TEST_HOME=/absolute/disposable-home pnpm exec playwright test --config tests/mimouse/playwright.config.ts prompt-registry.spec.ts --workers=1
```

fixture helper 会再次校验 DB `data_directory`，不允许连接到真实实例。测试通过真实数据库但创建的是 **人工构造的 registry 内容**，不是模型输出/性能证明。

## 人工验收步骤（用户拉取后）

1. 完成上述 export/挂载/迁移。使用 disposable DB 检查两张历史表 trigger 已安装。启动服务，登录该公司管理员（不能用 local implicit）。
2. 保存包含中文、emoji、前后空白和 `<script>` 的 A；详情按纯文本展示且字节保留；列表、receipt、activity、错误/HTTP 日志不包含原文。
3. 再保存 B；head 仍为 null。明确确认 registry-only 后选 A，再带 A 的 receipt 选 B；检查 head=B、旧 A/B 内容不变、审计仅 id/actor/action/runtimeApplied。
4. 两个请求同时带 B receipt 分别选不同 revision，只有一个成功；失败为 409，刷新 head 后重新决定，不能自动重试覆盖。
5. 显式 rollback 当前 receipt，验证恢复 beforeRevision；旧内容与历史仍存在。第一次选择的 rollback 应回到 null，而不是删除 revision。
6. 原请求重复发送返回同一回执且不新增审计；同 request 改内容/换 actor 返回 409。A→B→A 后用第一次 A 的 head 仍返回 409。
7. 尝试其他公司/其他 prompt ID、member、agent、API key、implicit、suspended、已撤销 DB membership；必须拒绝，不能读取提示词。
8. paused 公司可以管理 registry；archived 拒绝。验证 agent 文件/config/模型参数、heartbeat 数量始终没有因为 registry 操作改变。
9. 按 fixture 注入 audit 写失败，确认 revision/receipt/head 不留下半成品。只在 disposable DB 做 SQL 故障试验。
10. 删除临时 fixture；本切片在正式库中无清除历史端点，不通过直接 SQL/禁用 trigger 绕过留存。


## 追加切片：管理员 UI（2026-10-26）

### 精确集成 hooks

- 新组件：`ui/src/pages/MimousePromptRegistry.tsx` 的 `MimousePromptRegistry({ companyId, userId, sessionId })`。建议公司路由 `prompt-registry`，导航名使用 `promptRegistryUi.title`。
- 父级页从 `useCompany().selectedCompanyId` 和**当前已验证的真人 session** 传入 `user.id` 与 `session.id`；无 session/loading/error 或权限撤销时必须卸载组件，不能沿用前一用户缓存、使用 `local-board`、把 userId 当 sessionId，或给新 session 复用旧 token。组件三维 key 会丢弃草稿/确认/待处理请求并忽略旧响应。
- 页面读取的 session identity 必须遵守现有登出/重新登录失效流程；如果在刷新验证期间无法确定当前 identity，应先卸载，不保留旧授权画面。
- 组件没有 React Query/global/localStorage/sessionStorage 数据缓存。每个 session 的 HTTP controller 与所有状态都在 keyed 子组件内；敏感读取全部经 `promptRegistryApi` 的非合并 `requestResponse` + `readApiJson`、`signal` 与 `cache: no-store`。
- 新 locale contribution 位于 `ui/src/i18n/contributions/promptRegistryUi/{en,zh-CN,es,ja}.json`。父集成运行 `node scripts/compose-mimouse-locales.mjs`，再挂载路由/导航；本提交不修改生成 locale、根 App/sidebar/index。
- 创建 revision 是新增不可变意图；保存成功清空正文，再次填写属于新意图并生成新 requestId。未知响应冻结正文/操作/原 requestId，只开放“恢复同一请求”，重试相同 POST 获取已有 revision/receipt。收到旧回执后再读取 heads，不把历史回执当当前状态。401/403 清空敏感草稿，所有读取错误隐藏内容/写控件，409 清除确认并刷新，绝不自动覆盖。
- 未知请求期间禁止新意图，页面注册 beforeunload 提醒避免误关闭；**不把原文/请求持久化到浏览器存储**。离开页面或更换 identity 会丢弃本地恢复状态，不能声称支持跨重载自动恢复。发生此情形先由管理员查看已保存 revision/receipt 与服务器审计，再决定新的操作，切勿假设请求失败。
- UUID 分页明确不代表时间；headReceiptId/selectedRevisionId 始终为准。当前回执不在首屏时必须继续加载回执后才能确认 rollback；已选 revision 可直接读取，不要求在第一页。

### UI 人工测试（集成后）

1. 用公司管理员真人 session 打开“提示词注册表”，切换 en/zh-CN/es/ja，确认四语言都明确“仅注册表，不应用运行态”。无 session 或 member/agent/API-key 不应显示可用写控件。
2. 填 reviewer 和包含中文/emoji/空格/换行/`<script>` 的正文，保存 revision；保存成功正文清空。点击 reviewer，再点 revision UUID，正文以 `<pre>` 原文显示，无 script 元素或 Markdown/HTML 执行，hash/UUID 可检查。
3. 打开 revision 详情，选择“选择版本”；勾选独立确认前按钮不可用。确认后检查请求携带当前 headReceiptId 与 registry-only flag；页面仅显示保存回执，不显示 runtime applied。
4. 打开两个窗口，窗口 A 完成选择，窗口 B 用旧 head 提交；B 应收到冲突说明、刷新状态并清除确认。重新查看版本并勾选才可再次提交。
5. 选择“撤销当前回执”，核对显示的 head 与 beforeRevision 目标。若当前 receipt 不在 UUID 第一页，未加载到该 receipt 前 checkbox 应禁用；逐页加载后仍需主动确认。
6. 在 disposable 环境模拟 POST 已提交但响应断线：原正文/操作被冻结；点“恢复同一请求”，检查两次 POST 的 requestId、正文与 CAS 完全相同，只生成一条历史/审计；恢复后页面重新读当前 head。恢复前不能修改成新意图。此场景不要关闭页面。
7. 打开旧内容或提交后立即更换公司、用户或同用户重新登录的新 session；草稿/确认清空，旧响应迟到不能显示旧正文/回执。以网络面板核对相同 URL 的两个 session 读取分别发送 HTTP，而不是共享旧 inflight response。
8. 撤销当前管理员 DB membership，再刷新/读详情；即使有旧数据，任何 403 或读取失败都隐藏内容/写控件。恢复权限并刷新后，403 清除的草稿不会恢复。
9. 刷新状态（包括 500/离线）时不根据缓存继续允许写入。确认 agent/model/files/heartbeat 完全未因以上操作变更。

### UI 验证记录

- 纯测试：`ui/src/api/prompt-registry.test.ts` 与 `ui/src/pages/MimousePromptRegistry.test.tsx`，**16 tests passed / 2 files passed**，512 MB 单 worker，最终重跑 3.95 秒；使用实际 requestResponse/fetch 边界验证同 URL 的旧 observer + 新 session 不合并、abort 后迟到正文丢弃、no-store/signal。UI 测试覆盖四语言、inert script、三维身份切换、403/离线 fail-closed、CAS、显式确认、UUID receipt 分页与相同 request 恢复。
- `node scripts/check-token-gates.mjs`：所有 gates clean（1265 文件）。
- 未运行：浏览器真实交互、该 UI 的全量类型检查/build。没有启动 DB/server、安装依赖或更改父工作树的根依赖。父集成此前 DB 通过不等于本 UI 浏览器验收通过。
- 集成后执行：`NODE_OPTIONS=--max-old-space-size=512 pnpm --filter @paperclipai/ui exec vitest run src/api/prompt-registry.test.ts src/pages/MimousePromptRegistry.test.tsx --maxWorkers=1`，再执行上述浏览器步骤。
