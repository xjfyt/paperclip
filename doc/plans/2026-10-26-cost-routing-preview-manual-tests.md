# P5 成本策略预览手工验收

> 依赖 `doc/integrations/cost-routing-preview.md` 中央挂载/词典/迁移。以下是待用户或集成环境执行的测试，不是已通过结果。禁止调用真实模型或为验证而扩大权限。正向证据使用本地合成 fixture/受控已有记录。

## 1. 基础隔离与输入

- 建两个公司 A/B、普通 board、A 管理员、A Agent token。普通 board/Agent 对四个端点均应 403；A 管理员对 B 应 403/404，不泄露 B 的 report/agent/receipt 是否存在。
- policy 使用 B 的 agent/report，保存应拒绝；加入 `price`、`score`、`routingEvidenceV1`、config、未知字段应 400；超过 20 candidate、重复 agent/capability、非法 UUID/hash、敏感 model/provider 标识应拒绝。
- 响应、日志、activity audit、receipt 表不含 adapterConfig、runtimeConfig、token、密码、完整 receipt JSON、source URL。审计只保留 digest/revision/权限为 false 标识。

## 2. CAS、幂等与不可变

- revision 0 首次保存得到 1；同 actor/ID/请求重试返回 1，不追加 audit。
- 并发两个不同 requestId/expectedRevision=1：仅一个得到 2，另一个 409；刷新后才能保存。
- 同 ID 修改内容或更换 actor 应 409。preview 同 ID 同版本重试返回完全相同 evaluatedAt/hash；不能刷新价格/证据。
- 发布策略新版本后用旧 policyRevision 创建新 preview 应 409。读取已存在旧 receipt 必须仍一致。
- 模拟 audit 插入失败：策略/receipt 同事务回滚。数据库 UPDATE/DELETE 两个历史表应被 trigger 拒绝。跨公司 FK 不可引用别公司的策略版本。

## 3. 正向历史证据与精确成本

- 本地 fixture：每个 candidate case 各一个成功测试 run/issue、一个已结算 heartbeat、一个 metered_api reported cost 行、一个 heartbeat 引用的完整 per_run provider_reported USD receipt；company/agent/provider/model/金额与 config/context 一致，使用同一 dataset。
- 新建比较应保存 `routingEvidenceV1`；读取数据库只含允许字段，不含原始配置/receipt 文本。
- 空 requiredCapabilities、质量全部通过、证据在 TTL 内：preview `recommended_for_review`，按精确字符串 cents 的整数货币算法选低价；同价按 UUID 稳定排序。显式零美元凭据可为零；无凭据绝不当零。
- 任意结果均 `executionStarted=false`, `budgetReserved=false`, `dispatchAuthority=false`。观察 heartbeat、issue assignee、预算 reservation/额度、provider 网络调用数完全不变。

## 4. 必须失败关闭

分别修改 fixture（每次新 report/new preview ID）：旧报告无 proof；漏 case；重复/多个 heartbeat；未结算/pending heartbeat；同 issue 的额外未入账 run；缺账本；两个账本行；receipt 不完整；session cumulative；多模型；provider/model 不一致；Agent/company 不一致；unknown/unpriced/estimated；credits/CNY 代替 USD；subscription included；USD/账本金额不等。全部不得推荐。

- reportHash/datasetHash/context pin 不匹配、当前 configHash 改变、当前配置模型改动、候选暂停/未 ready、公司不 active、质量未达阈值都阻断；不得暗中换 provider/model。
- fresh report 引用陈旧 heartbeat：按最老实际 finishedAt，而不是 report 创建时间，仍应 stale；未来时间应 future。
- 添加 required confirmedCancellation/workspaceRoundTrip，或在 capability ledger 录入 C3/C4 passed、过期、撤销、不同环境/版本记录：均不能把人工记录转为本策略的机器验证资格。
- 预算已耗尽也不能因 receipt 有推荐而执行：预览不授予执行权；实际执行路径仍保留原有预算硬停（本功能不调用该路径）。

## 5. UI 和四语言

- en/zh-CN/ja/es：标题、风险说明、按钮、错误消息完整；技术 receipt 字段/原因码保留稳定机器标识。
- 切公司/卸载期间晚到请求不能回填旧公司。加载失败不得把未知状态当 revision=0 保存。
- 连点保存/预览不重复创建；网络超时后重试复用 requestId；冲突明确提示刷新。
- 改动 JSON 未保存时禁用预览；保存规范化后可预览；失败清除旧结果，不展示旧推荐作为本次成功。
- Back/Forward、刷新、会话失效、非管理员、非法 JSON、超长输入；不泄露接口原始错误/敏感配置。

## 6. 集成检查

运行迁移编号/安全检查、针对性 server/shared/UI typecheck、纯测试、token gates、路由鉴权/幂等/事务 DB 测试，最后由总控执行全量 typecheck/test/build。保存精确 commit、命令、结果和未执行项；若受资源限制，请明确标记，不以源码检查替代运行验证。
