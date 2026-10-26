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
4. **无四语言 UI**：本切片仅管理员 API/共享契约；页面、导航和 en/zh-CN/ja/ko 文案待独立可审阅切片。任何 UI 必须把内容按纯文本展示，不用 HTML/Markdown 执行能力，不展示“已激活”。
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
