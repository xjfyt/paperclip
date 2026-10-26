# P5 成本路由策略预览 — 集成清单（2026-10-26）

## 实际范围

这是 **策略与证据预览基础设施**，不是已完成的成本路由器。保存不可变策略版本，检查当前公司的候选 Agent/provider/model、固定评估报告和相同数据集。当前所有结果均为 blocked、selectedAgentId=null、comparableCost=null，绝不输出推荐。不调用 Agent/模型，不探测凭据，不改变执行、权限、预算或 `decision-models.ts`。不估算未来任务价格、不预留预算、不绕过执行时预算硬停。

既有报告保持原状且缺失 `routingEvidenceV1` 时阻断。未来比较在原事务内额外采集：候选版本的每个测试 case 必须对应唯一测试 run/issue、唯一已成功且已结算 heartbeat、唯一已报告的 metered API 账本行，以及该 heartbeat 明确引用的完整 `paperclip/accounting-receipt/v1` per-run USD 凭据。Agent、公司、provider、model、精确金额逐项相等；configHash 和执行上下文 hash 匹配；任何多次尝试/混合模型/订阅包含/credits/未知/估算/缺失/未结算均不资格化。receipt envelope.adapterType 必须等于测试创建快照与 heartbeat.runnerProfileJson.adapterDispatch.adapterType，不用当前配置猜实际模型/适配器。

新增采集只存允许字段、ID、hash 和明确 USD/cent 单位，不复制配置、密钥、receipt 自由文本或源 URL。比较在读账本前使用现有 accounting 的 company `NO KEY UPDATE` 锁顺序；查询上限 100 case/101 sentinel rows。旧比较结果、评分算法和 reportHash 不改。快照表示当时已记录成本，不自动吸收后来的账单校正。

`requiredCapabilities` 非空时，本片段不会把 C2 实现声明或 C3/C4 人工台账提升为机器验证，因此仍然阻断（unsupported/unverified）。这不是取消/工作区往返能力已经可用的声明。空能力列表明确表示本次预览不要求能力证明。执行上下文目前是 **测试创建时（wake/dispatch 之前）** 的配置/模板快照 hash。heartbeat.resultJson 中虽有 configFreshness.session.nextFingerprint，但没有可证明该实际调度指纹等于固定测试输入/提示词/上下文的可信绑定。创建后修改配置/指令再在预览前恢复，不能通过 hash 相等洗成真实执行证明。因此新 routingEvidenceV1 明确标为 unverified_test_creation_snapshot，始终追加 execution_context_unverified；保留 USD 链仅作后台诊断，删除了推荐选择路径。后续需独立设计 run-bound execution witness；本片段不修改 heartbeat/adapter/receipt 写入逻辑。

## 中央集成项（本工作树未改）

1. `packages/db/src/schema/index.ts` 导出 `costRoutingPolicies`、`costRoutingPreviews`。
2. 把同目录 `cost-routing-preview.sql` 分配为下一个正式 migration；更新 journal，按项目规则生成/核验快照。不直接执行此 staging SQL 到正式库。
3. `server/src/app.ts` 导入 `costRoutingPreviewRoutes` 并在现有认证 `/api` router 层挂载。不要公开无认证路由。
4. `ui/src/App.tsx` 挂载 `CostRoutingPreview`（建议公司设置下 `cost-routing-preview`），按现有导航规则提供入口。
5. 将 `ui/src/i18n/contributions/costRoutingPreview/{en,zh-CN,ja,es}.json` 合并生成词典。贡献目录不是最终运行词典，未合并前不能声称页面已完整上线。
6. 无 package/lockfile/dependency 改动。shared 与 db 的既有 wildcard exports 可解析新直接子路径。

## API

全部要求公司访问权 + board + 公司管理员（或现有 local implicit / instance admin）。Agent token 不可访问。

- `GET /api/companies/:companyId/cost-routing/policy`：当前版本或 null。
- `POST .../policy`：`{requestId, expectedRevision, policy}`；公司行锁 + CAS + 幂等 ID（包含 actor）；同 ID 同请求返回原版本，不同请求 409。
- `POST .../previews`：`{requestId, policyRevision}`；必须为当前版本；重试返回原不可变结果（不是重新测量）。需要新测量时用新 ID。
- `GET .../previews/:id`：公司范围内的不可变 receipt，含 receiptHash、policyRevision、evaluatedAt、逐候选原因、证据 hash、精确成本/单位。

所有输入 strict schema；不得提交分数、价格、证据对象、货币换算率或配置。policy 示例：

```json
{
  "datasetId": "<dataset UUID>", "datasetHash": "<64 lowercase hex>",
  "minimumPassRate": 1, "maxEvidenceAgeHours": 24, "requiredCapabilities": [],
  "candidates": [{"agentId": "<company agent UUID>", "provider": "<receipt provider>", "model": "<receipt model>",
    "reportId": "<comparison UUID>", "reportHash": "<report hash>", "executionContextHash": "<snapshot context hash>"}]
}
```

当前小 UI 面向管理员录入已审阅 JSON；不提供发现/展示原始 secret-bearing evidenceSnapshot 的接口。hash 应从受控后台审查材料提取，不要复制原始配置到页面。修改未保存时禁止预览，避免误以为正在预览草稿。

## 本地验证证据

- 单 worker / 512 MB 测试 44/44 通过：30 项纯证据、5 项 jsdom 身份隔离、7 项 HTTP 日志隐私、2 项真实 API client 传输隔离测试。合成完整 USD fixture 仍必须阻断上下文资格；见 `server/src/services/cost-routing-preview/preview.test.ts`。
- UI token gates 已通过。修改/新增 TS/TSX 文件 esbuild syntax transform 通过（不是语义类型检查）。
- 最初尝试 TypeScript transpile API 因仓库 TS 7 原生包不提供 `ScriptTarget` 失败；已改用 esbuild 做语法检查，不把失败算作 typecheck 成功。
- 为避免与总控全量构建竞争，未运行安装、完整 typecheck/build、DB migration/HTTP/真实浏览器或真实模型测试。集成与下列手工测试仍待执行，不能声称生产路由完成。

## 剩余工作（不得记为已完成路由）

- run-bound 实际 dispatch witness：证明固定提示词/输入/上下文与实际执行绑定，不能只比较预创建 hash 或当前 config；在建立该证明前保持全量阻断。
- 中央迁移/挂载/词典与 DB/HTTP 集成测试、完整类型检查/构建仍由集成阶段验证。
- UI 以 company + user + session 隔离，session/policy 重验期间卸载编辑器；403/401 清除草稿/结果，身份变化丢弃晚到 mutation。jsdom 不等于真实浏览器验收。

## 二次审查边界修复

- `cost-routing` 整个命名空间进入 HTTP 私密请求分类，包括 malformed/rejected/unknown 路由与 400/401/403/404/422/500；请求 body、headers、query、异常回显均不进入日志。
- 当前策略读取通过 `requestResponse` + `readApiJson` 发独立 GET，不使用 `api.get` 的仅 URL in-flight 合并。`cache:no-store` 只是浏览器缓存策略，不能作为身份隔离。真实 client 回归保留旧会话观察者的 pending request，新会话必须发起自己的请求并只获得新响应。

## 新增 PostgreSQL/API 回归（已编写，尚未执行）

`tests/mimouse/cost-routing.spec.ts` 包含 6 个受 `createFixtureDb` 数据目录身份保护的集成测试：跨连接 CAS/actor 幂等与审计、公司/agent/report 边界、版本/preview 重试、实际 UPDATE/DELETE 不可变 trigger、公司范围 audit 失败回滚、真实 evaluation.compare SQL 采集及评分/reportHash 保持、真实 router ACL 与本地受控服务器挂载。所有 heartbeat/receipt/输出均为直接入库的合成记录，不是实际执行证据；即使完整 USD 诊断仍要求 blocked/null selection。测试临时 audit trigger 仅匹配随机 fixture company，并在 finally 移除。

编写阶段仅做语法/差异检查，**未启动数据库、服务、构建或运行此集成测试**。待总控迁移 0354 与中央挂载完成后在有显式 fixture marker/独立目录的环境运行；不能在真实实例或没有 createFixtureDb 身份核验的数据库运行。
