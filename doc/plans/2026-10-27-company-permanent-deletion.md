# 公司永久删除：公司级事务上下文与依赖清理

## 合同与范围

- 保持现有 `DELETE /companies/:companyId` 的 `assertCompanyAccess`、`assertBoard` 与 UI“删除公司及全部数据、不可撤销”确认；不把永久删除替换成 archive。
- 本片修复已确认的旧 coding delivery → secret 外键失败，以及同一删除路径缺失的 Mimouse/证据依赖图；不是其他功能审计或数据库重设计。
- 没有实际删除用户公司，没有调用模型、提供商或真实外部网络。夹具只创建隔离 PostgreSQL 与两个合成公司。
- 0360 不改；0361 由正常 Drizzle `generate --custom` 生成 SQL 占位、journal 与新快照，再补入自定义触发器 SQL。没有改旧快照或 Drizzle 表定义。

## 防护边界

`deleteCompany` 在原有公司 `FOR NO KEY UPDATE` 锁和存在性检查之后，以事务 local 设置锁查询返回的规范 company ID 与当前 xid；helper 还用 `uuid::text` 规范化直接调用的 UUID 大小写。它不是身份授权；API 原有权限检查仍是必需前提。

0352/0353/0354/0358 的四个不可变函数保留原有触发器、UPDATE 拒绝与错误码；DELETE 仅在目标公司和当前事务均匹配时放行。八张证据表新增 deferred AFTER DELETE 约束，检查时公司必须已不存在，否则回滚。

这保护普通 SQL 写入中的证据不可变性和“公司保留却单独删证据”的错误，不声称防御可改触发器的 SQL owner。`SET CONSTRAINTS ... IMMEDIATE` 在公司尚未删除时会提前失败；调用者不得在清理中途强制检查。检查是在约束实际执行时，不是不可绕过的提交后钩子，也不声称阻止 SQL owner 先检查、再重建同 ID 公司。

事务结束后 local 设置清除；xid 匹配额外拒绝陈旧 session context。任何失败均传播，不吞错、不降级为放宽约束、不执行全局表清理。

## 固定清理顺序

1. 保留 runtime v2：bindings → heads → receipts → policies。
2. 私有 prompt tests；application dispatches/heads → receipts → applications。
3. feedback verifications → coding repair attempts → deliveries；feedback promotions。0360 requests/receipts 随 delivery 级联。
4. evaluation restores → comparisons → datasets；research promotions → candidates/routine bindings；operation previews。
5. notification deliveries → subscriptions → endpoints（reviews/revisions 级联）；Workbuddy turns → jobs → connections。token cache 随 secret 级联。
6. cost routing previews → policies；capability evidence 全公司集合删除，保留自引用闭包。
7. 只清空可变 prompt head/selected 指针，再删 receipt 全公司集合 → revisions → prompts。
8. 继续原有 runs、secrets、skills、routines、issues、项目和 agent lifecycle purge，最后删 company。

所有显式 DELETE 与 prompt 指针 UPDATE 均限定 company ID。实例级 notification rate limits 和 auth revocations 保留。新 participant 只使用调用方事务，不调用外部系统、不复制私有 prompt/result/secret 内容到日志。

原有 lifecycle terminate/schedule 仍位于 SQL 删除事务之前；本片不承诺将这些既有外部生命周期影响回滚。集成夹具使用已终止合成 agent，仅 mock 这两个外部入口，真实执行最终 agent purge 和 SQL 事务。

## 验证记录

- 正常 custom migration 生成成功；journal 仅追加 0361，新快照与 0360 schema 深比较相同，仅 ID/prevId 与序列化键顺序变化；迁移编号、安全门禁与 `git diff --check` 通过（安全门禁保留历史 baseline，不新增豁免）。
- 独立静态 review 的唯一 UUID 规范化意见已修复；最终代码使用候选源码 aliases、独占临时目录、Node 1024 MiB、单 worker 顺序重跑：routing 单测 10/10（1.74 秒）；真实 PG 集成 7/7（5.09 秒）。完整正常迁移应用 0361，测试首先断言候选 table identity 和 0361 函数存在。
- 已过：八表普通 UPDATE/DELETE 拒绝；删除上下文内 UPDATE 仍拒绝；错公司/陈旧 xid 拒绝；只删 receipt 或整个 participant 而不删 company 在提交时失败；提前 SET CONSTRAINTS 失败；成功/失败后的 context 不泄漏。
- 已过：大写 UUID 调用真实完整删除及 partial-delete 两条路径；完整合成依赖图清理、0360 级联、runtime v2、私有结果、secret versions、自引用 receipt/evidence；第二公司的逐表完整快照和实例全局行不变；最终 lifecycle purge 注入失败后的全部数据库行/可变指针恢复。
- 首轮 PG 因 sandbox 禁止 `/tmp` Unix socket 启动失败，七项未进入；保留失败日志后使用已有 `PAPERCLIP_TEST_POSTGRES_TCP_ONLY=1` loopback 路径重跑通过。没有绕过权限、复用旧 PID 或改变依赖；成功实例已停止清理，失败初始化目录无 postmaster.pid。
- 本轮日志：`/tmp/company-delete-validation-pDsXos/{routing,pg-attempt-1,pg-attempt-2,final-routing,final-pg}.log`。尚未执行 full server types/build；不把本片测试说成全量发布检查。
- 既有 routing 单测仍只证明调用顺序、公司作用域和生命周期失败传播，不冒充 PostgreSQL 证明。

## 尚未证明

没有 live 公司、外部凭据销毁/提供商取消、并发真实工作负载或全站其他历史数据形状的实测。保留原有公司锁，不新增锁升级或自动重试；外键并发冲突仍失败并回滚 SQL 清理。
