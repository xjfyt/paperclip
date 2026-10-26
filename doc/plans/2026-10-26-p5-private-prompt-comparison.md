# P5：私有历史提示词双版本只读比较

状态：本片提供受限历史比较；P5 整体仍为 **partial**。不执行模型，不选择/提升版本，不应用运行时配置，不解锁成本路由。

## 边界与操作

入口位于提示词登记页，选择一个 prompt 后，填写固定 dataset UUID、两个不同 revision UUID，以及明确的历史 test UUID 全集，点击“只读比较历史”。接口为 `POST /api/companies/:companyId/prompt-registry/:promptId/comparison`；POST 仅承载 ID 和可选成本上限，不承载输出或分数。

- 同 company、当前有效 session、active owner/admin、active company；私有 test 另按 actorUserId + promptId 限定。其他管理员不能读取你的结果。
- 比较领域服务在 PostgreSQL `READ ONLY / repeatable read` 事务读取一致快照，不 reconcile、不写运行/报告/审批状态、不 wake、不通知。评分后再用 fresh 只读事务检查授权；这不是锁住并发撤权直到网络送达的保证。既有 HTTP 认证栈可能刷新 session/lastSeen，不能宣称整个请求栈绝无写入。
- 不调用会更新状态的私有 tests list/detail；不写普通 company evaluation comparison 表。继承 `prompt-registry` 私有 HTTP 日志分类，返回 `Cache-Control: no-store`，错误不返回 SQL、原文或底层 cause。
- 此独立只读合同比较合法 UUID 时先规范小写，再拒绝语义重复/相同 revision；不改 opaque actor/hash，也不改付费执行票据或持久请求摘要。预算阻断与本次请求双向绑定：仅已知 total 超过非空上限时出现 `candidate_cost_exceeds_limit`，unknown 不按已知小计假定最终成本。
- 固定完整数据集，每 case 每侧必须有一个明确 test；缺失仍保留分母并阻断，重复或额外 evidence 拒绝，不自动选最新成功运行。
- 重算 dataset、skill inventory、revision 完整性；严格校验批准 snapshot 和 prepared witness 的 test/attempt/run/agent/revision/prompt hash/bytes。仅已封存 completed、持久 spawn、succeeded 且绑定一致的 run 可以评分。
- 两侧必须有相同历史 agent、skill version/hash、dataset/hash、execution profile、批准 snapshot/configDigest、secretValueHash、implementation 和 runtimeConfigHash。**不拿当前 Agent 配置代替历史配置**。
- runtimeConfigHash 含实际 cwd：默认逐任务派生目录可能导致同一 Agent 的两次运行不可比。需要用户预先准备可比固定配置；不能删去 cwd 检查让样本过关。
- 仅比较 `privateResult.resultJson.result` 非空原始字符串，使用 `exact_text_v1`；不 trim、不用 summary、不把 structured-only 输出 JSON stringify 冒充原文。
- 输出仅聚合分数、case 阻断、历史 ID/hash；无原始 prompt/input/output。浏览器不持久化比较结果，身份/prompt/auth pending 切换、撤权及失序响应会清空或丢弃结果。

## 成本与资源限制

成本只读同公司、唯一 harness issue 对应账本，并核对 agent/run；无记录、未定价、归属不明均为 unknown，不当零。同一账本按 cost-event ID 排序后累计，保留小数分。报告是**本次读取的历史账本快照，不是最终结算，也不是完整执行成本保证**。任一侧费用未知即阻断审查资格，即使已有质量分。全部通过也只表示可供人审，不是发布审批。

加载前 SQL 预算：privateResult JSONB text 每项 160KB（给 JSONB 格式空格留余量）、private test 整行每项 192KB/总 2MB；dataset 1MB、skill inventory 256KB、每个 revision 128KB；这些正文累计至多 3MB。JSONB 预算保守，临界大型记录可能拒绝，绝不截断后伪评分。加载后仍按实际 JSON.stringify 对每项私有结果执行原 128KB 限制。run/issue 只投影必要绑定字段，不读普通 resultJson、description；账本最多 10,000 行，状态字段归一为有限枚举。超限拒绝，不能缩小数据集掩盖缺失。

`completeContextCaptured:false`、`runtimeApplied:false` 始终保持；历史一致性不等于完整模型上下文复现。报告 hash 不含瞬时生成时间，不能作为成本路由或受控运行时发布证明。

## 已验证与待验

- 纯评分/合同专项：37/37（包括原文空白、structured-only、缺 case、重复/跨域、历史配置与 witness、unknown cost、矩阵矛盾回执）。
- UI/API 相邻六文件：108/108；四语 en/zh-CN/es/ja，token gates、locale compose 和 diff 检查。
- 单 owned PostgreSQL fixture 目标用例：当前 session、角色/撤权/跨 actor/公司、真实 readonly/isolation、评分后 fresh 撤权拒绝、hash/缺 case/未知成本、单项及累计正文超限拒绝、多行小数账本不同物理插入顺序同 hash、领域表无写与无额外 provider-boundary 调用；loopback HTTP actor 注入验证，不等于真实 cookie/OIDC。
- DB fixture 直接构造合成已封存历史，不证明真实 CLI 或模型成功。正常迁移和 owned DB 清理沿既有夹具；immutable revision 触发器拒绝篡改，未禁用触发器。
- 大小写修补新增的实际 DB 大写 UUID 输入断言留中央全 private suite 重验；本工作区未与其并发启动 DB。
- 全量 typecheck/build、全量 API/UI 集成由中央执行，本工作区没有运行。真实 CLI、账户、费用产生均未验收。

人工验收：

1. 用真实 session 打开同 prompt 的两份明确历史集合；确认原始结果不出现在比较区、普通报告、日志或浏览器 storage。
2. 检查两个 case 的完整矩阵，缺一侧/未知费用必须 blocked；质量分不能被误读为发布通过。
3. 切换公司/user/session/prompt，刷新授权、撤销 admin 后再比较；旧结果必须清空，迟到响应不能恢复。
4. 快速重复点击、编辑/清空后等待旧请求、浏览器前进后退；不得自动执行/重试/提升。
5. 四语和窄屏检查长 UUID/hash 换行、表单标签、未知费用和只读提示。
6. 校验实际 cwd 不同的历史运行不能被比较为相同配置。另行完成真实 CLI 发现/版本/受限环境验收后，才能声称该运行入口可用。

复核命令（工作区已有依赖，禁止 install）：

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run \
  --config tests/mimouse/private-prompt-vitest.config.ts \
  server/src/services/mimouse-private-prompt-tests/compare.test.ts \
  server/src/services/mimouse-private-prompt-tests/comparison-contract.test.ts
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run \
  --config tests/mimouse/private-prompt-vitest.config.ts \
  server/src/services/mimouse-private-prompt-tests/integration.test.ts \
  -t 'private historical comparison'
```

第二条仅目标 1 项运行，其他 24 项跳过，不能称整个 suite 全过。
