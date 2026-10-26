# 调研 Routine 集成清单（2026-10-26）

本分支不修改集成者拥有的根 App、导出文件、生成 locale、迁移 journal。

## 必须接线

1. `packages/db/src/schema/index.ts` 增加 `export * from "./mimouse_research_routines.js"`，按照标准数据库生成流程分配迁移编号/journal。
2. server app 引入 `mimouseResearchRoutineRoutes` 并在既有认证后的 `/api` router 区域挂载，和 `mimouseResearchRoutes` 同级。
3. `server/src/middleware/http-log-policy.ts` 的私有公司集成路径 regex 增加 `research-routines`，确保验证错误/请求正文不进入普通 HTTP 日志。
4. 新共享契约使用既有 wildcard subpath `@paperclipai/shared/mimouse-research-routines`，无需根 export。DB 服务同样使用 wildcard schema subpath；必须导出表以纳入 Drizzle migration schema。
5. 调研页面已内嵌四语组件，不新增顶级导航或页面；旧手动路径仍在。四语文案在独立组件 copy.ts，未修改生成 locale。

## 新表参考 DDL（迁移生成时核对，不手工重复应用）

```sql
CREATE TABLE mimouse_research_routine_bindings (
  company_id uuid NOT NULL REFERENCES companies(id),
  routine_id uuid NOT NULL REFERENCES routines(id),
  product text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  configured_by_user_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, routine_id)
);
```

既有 evidence JSONB 接受新的已验证结构，无候选表列更改。身份检查在同一事务锁定并校验真实公司关系；不基于客户端传入 provenance。

## 需集成执行的验证

- 纯单测：`server/src/services/mimouse-research-routines/{policy,evidence}.test.ts`，原 `mimouse-research-evidence.test.ts`。
- UI：旧 `MimouseResearch.test.tsx` 将新增独立面板 mock，以继续隔离验证原人工导入；新增面板需要浏览器验证新建 paused、绑定/禁用、原 Routine 配置导航、公司切换、错误/重复点击。
- DB fixture：`tests/mimouse/research-routines.spec.ts`，独立 company/inert agent/run；无模型或调度器运行。该 fixture 不替代真实 JWT middleware（由现有 auth tests 验证签名/header mismatch）。
- HTTP：必须验证 agent-key+伪造 run header 拒绝、JWT run mismatch 拒绝、请求体不进日志。
- 人工晋级：原 promote fixture，再以 agent_report 候选确认完整私有 backlog/依赖/无派发路径。
- token-gates、共享/server/UI types、build、真实浏览器：父任务集成窗口运行，不与其他高内存检查并行。

本文件不宣称上述检查已通过；以父任务最后验证记录为准。

新增组件定向单测：`ui/src/components/mimouse-research/ResearchRoutinePanel.test.tsx`（暂停新建、绑定部分失败、切公司清草稿、拒绝读取、四语）。

## 子任务实际验证与复核

- 已执行：仅单进程 `maxWorkers: 1`、512MB heap 的定向纯单测；3 文件 / 44 测试通过，包含新 policy/evidence 与旧研究证据测试。没有启动数据库、服务器、调度器或模型。
- 已执行：`git diff --check` 无空白错误。
- 未执行：UI 单测/token-gates、完整类型/构建、DB fixture/迁移、浏览器；按父任务串行内存窗口安排，不标为通过。
- 复核修正：拒绝任何冲突的 checkoutRunId/executionRunId（不能只用 OR 接受旧 owner）；严格核对 issue.originRunId；普通 agent-key 即使伪造 run header 也不读取报告数据库；报告重放摘要不包含可变的绑定更新时间，相同产品绑定重存不会改写旧报告。
- 待集成重点：原人工页面新增面板的错误/请求缓存不应污染旧表单；新建与绑定为两次现有 API 调用，部分失败必须保留“可能已创建暂停任务”提示；现有任务描述不会被绑定动作自动改写。
