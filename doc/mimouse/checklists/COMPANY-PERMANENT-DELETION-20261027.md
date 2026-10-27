# 公司永久删除与不可变证据边界验收

日期：2026-10-27。基线 `48c9c1d0`（功能 `3cd1d2e5`、0361维护边界补强 `48c9c1d0`）。本清单用于隔离合成公司验收；**没有删除用户真实公司，没有执行真实提供商清理或外部调用。**

## 入口与授权不变

- 真实永久删除入口在 Companies公司卡片菜单 **Delete Organization**，随后明确确认“Delete this organization and all its data? This cannot be undone.”；取消不发送删除，确认后才调用原 `DELETE /companies/:companyId`。这是删除全部公司数据，不是archive。
- CompanySettings的 **Archive organization** 仍是隐藏/归档、可恢复的独立行为，不能用归档成功代替永久删除验收。本补丁没有修改UI、shared或Drizzle表定义TS，不宣称新增四语界面或新的确认机制。
- 原 `assertCompanyAccess`、`assertBoard` 仍是API前提；内部删除事务上下文不授予任何调用人权限。真实环境永久删除必须另有明确授权及不可撤销确认，本清单不授权操作现有公司。

## 0361安装与维护窗口

1. 先按既有实例备份流程取得并确认可恢复的数据库备份；另保管实例文件及local encrypted master key。停止应用/worker写入，等待在途事务结束，在停写维护窗口通过正常migrator应用0361。
2. 0361使用正常Drizzle custom migration生成的journal/新snapshot；0360不改，旧snapshot不重写，新snapshot的schema与0360保持一致，仅追加函数/触发器SQL及迁移元数据，不能手工标记已应用。
3. 本文件自身设置5秒lock timeout与30秒statement timeout；**30秒是每条语句而非整个文件上限**。遇锁等待/语句超时，按每文件事务回滚，不得把部分触发器视为安装完成。
4. 保留错误及锁竞争证据，确认备份和维护状态后由操作人从正常迁移入口重试；不自动循环、不取消其它会话、不调大超时、不扩大migration safety豁免。真实生产DDL锁竞争未演练，不能用正常迁移成功冒充。

## 安全合同：只允许完整公司删除的事务例外

- 服务先保留原公司 `FOR NO KEY UPDATE` 锁/存在性检查，再使用规范company UUID及当前事务xid建立**内部事务local上下文**；成功、失败和结束后均不得泄漏。大小写UUID归一化已覆盖。
- 八张不可变证据表的普通UPDATE/DELETE仍拒绝；内部删除上下文也不允许UPDATE。DELETE仅在公司与当前事务匹配时例外放行，随后deferred约束要求公司最终已不存在。
- 只删一条receipt或完整Mimouse participant、但保留company时必须回滚；清理中途强制立即检查约束会提前失败，不应在生产流程中绕过/禁用触发器或手工构造删除上下文。
- 这不是API授权，也不防御可修改触发器的SQL owner；约束在实际执行时检查，不是不可绕过的提交后钩子。不声称防止SQL owner检查后重建同ID公司。

## 隔离手测：只对两个可丢弃合成公司

1. 建立目标公司DEL与邻公司KEEP，记录夹具纳入的每张表完整行快照及实例级notification rate limits/auth revocations；包含已终止合成Agent、运行/任务、secret版本、私有prompt/result、coding delivery/repair、0360观测、runtime v2、通知及自引用证据关系。
2. 在UI选DEL，检查永久删除与Archive入口清楚区分；取消不可撤销确认后目标/邻公司/全局行均不变。授权负例必须被原API挡住，不能用直接调用service的PG测试当作浏览器鉴权证明。
3. 只在明确确认DEL可销毁后执行完整删除：依赖应先于runs/secrets/skills/routines/issues/agents清理，公司最后删除；原coding delivery→secret外键不再中断，0360 requests/receipts按delivery级联，私有内容不写入日志。
4. 验证DEL合成图为空，KEEP的夹具逐表完整快照及两类实例全局行不变；没有全局清表。mutable prompt head/selected指针可清空，immutable receipt/revision不被改写；自引用receipt/evidence闭包保持正确清理顺序。
5. 在仅隔离fixture中复验八表普通UPDATE/DELETE拒绝、上下文内UPDATE拒绝、错公司/陈旧xid拒绝、partial-delete提交失败、提前约束检查失败；每次失败后数据/指针及邻公司都应回到原快照。
6. 在最终agent lifecycle purge阶段注入失败，验证**SQL事务内**整图及mutable指针全部回滚，错误向上传播、不吞错、不降级删部分表；成功/失败后上下文均清空，邻公司的普通证据删除仍被拒绝。
7. 在隔离service/SQL夹具中分别验证大写UUID完整删除及partial-delete（不冒充API鉴权路径兼容性证明）；不存在公司仍按原锁后检查返回空，不把重复请求变成另一公司的清理。

## 回滚与未证明范围

- 既有 `terminateAgent` / `scheduleAgentLifecycle` 在SQL删除事务之前；它们的生命周期/外部影响**不承诺随SQL回滚**。集成测试只mock这两个入口，使用已终止合成Agent，最终purge及SQL事务是真实执行。
- 当前证据只覆盖合成的两公司依赖图；未穷尽其它public schema表、历史数据形状、额外外键或真实并发写入。并发FK冲突仍可失败并回滚SQL，不应误报全部删除成功。
- 未验证真实外部凭据销毁、供应商取消、文件/object storage物理清理、真实公司删除或生产灾备恢复；数据库删除不自动证明所有外部副本已消失。

## 可复现定向命令（本清单未执行）

从仓库根目录进入server，用标准配置、当前checkout的DB源码链接及已安装依赖；仅运行以下两套隔离fixture，不连接现有数据库：

```bash
cd server
CODEX_HOME='' PAPERCLIP_TEST_POSTGRES_TCP_ONLY=1 \
  PAPERCLIP_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 NODE_OPTIONS='--max-old-space-size=1024' \
  node ../node_modules/vitest/vitest.mjs run --config ./vitest.config.ts --maxWorkers=1 --no-file-parallelism \
  src/__tests__/company-deletion-routing.test.ts \
  src/__tests__/company-deletion-mimouse.integration.test.ts
```

标准[setup](../../../server/src/__tests__/setup-supertest.ts)仅在空CODEX_HOME下创建临时虚构auth，不调用真实Codex。PG[测试支持](../../../packages/db/src/test-embedded-postgres.ts)使用自有临时实例及TCP回环路径；测试禁止真实fetch，正常应用完整迁移并断言候选表身份/0361函数存在。首次Unix socket受限导致7项未进入，之后用已有TCP-only路径通过，未复用旧PID或绕过权限。

## 源码与验证证据

- 设计：[永久删除计划](../../plans/2026-10-27-company-permanent-deletion.md)；[0361 SQL](../../../packages/db/src/migrations/0361_company_permanent_deletion_context.sql)、[内部上下文](../../../server/src/services/company-deletion-context.ts)、[总删除服务](../../../server/src/services/company-deletion.ts)、[Mimouse依赖清理](../../../server/src/services/mimouse-company-deletion.ts)。
- 原授权/入口：[companies路由](../../../server/src/routes/companies.ts)、[Companies UI](../../../ui/src/pages/Companies.tsx)、[独立Archive入口](../../../ui/src/pages/CompanySettings.tsx)；测试：[routing](../../../server/src/__tests__/company-deletion-routing.test.ts)、[真实PG集成](../../../server/src/__tests__/company-deletion-mimouse.integration.test.ts)、[两公司图夹具](../../../server/src/__tests__/helpers/company-deletion-fixture.ts)。
- 最终维护补强后17/17通过：routing10、真实PG7，日志 `/tmp/company-delete-validation-pDsXos/maintenance-routing.log` 与 `maintenance-pg.log`。routing仅证明调用顺序/作用域/失败传播，不冒充PG结果；正常迁移、编号/安全门禁及diff检查亦有通过记录。
- 中央完整server构建与DB构建已通过，实际印章48c9c1d0；标准配置17项专项、29项观测邻接PG及164项编译API通过。UI/shared/表定义TS无差异，本补丁没有重跑全UI；旧10792项只保留历史输入范围。真实公司/外部资源未操作，详见[VERIFICATION](../VERIFICATION.md)。
