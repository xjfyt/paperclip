# 运营数据预演与审核

当前实现是公司管理员的人工快照dry-run底座，不是在线数据采集或真实业务写入。导入值不代表来源已连接，目标版本/etag也只是声明。没有apply/write API，审核通过仍返回write_adapter_not_implemented。外部业务系统合同未提供，不能以模拟成功代替真实写入。

## 输入与差异

共享createOperationPreviewSchema固定请求：requestId、period（YYYY-MM）、timeZone（明确IANA时区）、sourceInstance、targetInstance、mapping、sourceRecords、targetRecords。companyId只来自已授权路径，不接受body覆盖。

每个来源记录有sourceId、targetId、含偏移时间occurredAt及扁平values；目标记录有targetId、声明version或null及values。字段只允许安全的文字/数字/下划线名称，拒绝原型和已知凭据字段，支持中文业务字段。值限字符串、安全整数、布尔或null；小数必须用字符串，精确保留，不进行金额计算、会计判断或浮点转换。限1 MB、来源和目标各1000条记录、每条50字段。

按指定时区计算月份，与界面语言和浏览器时区独立。期外条目返回原时间及observedPeriod，便于人工核对迟到和补跑；不会偷偷挪到账期内。一个来源ID重复、多个来源写同目标、重复目标字段、缺少映射字段均拒绝。仅insert/update/noop，没有删除动作；目标未映射字段保留。

预览包含before/after、原目标hash/声明版本、来源hash、afterHash、稳定operation key、counts和previewHash。操作键绑定公司/月份/来源实例/来源事件/目标实例/目标记录/upsert，不随导入排序或内容变化而另造身份；内容变化改previewHash，未来不能在相同操作键下静默覆盖已执行意图。当前操作键只是预演证据，尚无持久外部执行台账。

## 持久化与现有审批

0347保存不可变输入和预览。company/requestId唯一；同actor完全相同请求返回原记录，换内容或actor409。读取及分页游标都检查公司归属。所有数据接口请求体和错误上下文按敏感集成日志策略隐藏。

申请审核只允许真实浏览器用户，事务内再检查公司有效、owner/admin有效成员资格，锁预览行防止并发重复。复用上游request_board_approval和审批服务，不建立另一套审批状态。payload仅包含期间、时区、数量、预览ID/hash及管理员预览链接，不含业务行值。原审批完整payload hash绑定，修改payload或错误previewHash不能复用授权；决定人失去有效管理员角色也会提示。

审核目的明确是dry_run_only，只记录审核，不授予业务写入权限。未来接入实际写入适配器时必须单独明确执行合同/版本/目标/期限和操作范围，并取得新的执行审批；不能把本版审批静默升级为执行许可。标准审批通知沿现有订阅，externalWrites=0仅指目标业务数据写入计数，不表示关闭所有已有通知机制。

## API

- POST `/api/companies/:companyId/data-operations`：创建/重取不可变预览，201或幂等200。
- GET 同路径：limit 1–100、可选beforeId；只列摘要，不将大批行值放进列表。
- GET `/:id`：管理员读取完整预览。
- GET `/:id/readiness`：返回dry_run_only、writesSupported:false、externalWrites:0和当前审核诊断。
- POST `/:id/request-approval`：confirm:true、expectedPreviewHash、四语locale。并发只创建一次现有审批。

纯reconciliation helper只定义后续对账规则并有测试，尚未接外部执行器：目标值相同不足以证明本次操作成功，必须同时匹配原操作键/请求摘要的有效供应商回执和实际目标内容。not_found或未知不能触发自动写入/重试；回执或目标异常进入needs_review，不能生成绿色状态。

## 当前验证与剩余

核心、对账、路由与日志4文件59项；真实隔离DB/API4项（并发、账期、跨公司/游标、审批重用和篡改、权限撤销、NULL配对数据库约束、无apply端点）通过。shared/DB构建、迁移检查与server完整类型通过。0347首次应用前补齐CHECK中的IS NOT NULL，避免SQL NULL被错误当作通过；原迁移journal前缀未修改。

四语界面已接入公司导航及URL预览深链，显示不可变差异、期外记录、当前审核状态。超过20条差异必须逐页展开全部条目才允许确认送审；JSON草稿仅在内存，错误重试保留原请求身份，更换请求身份需显式点击。切换公司/用户隔离草稿，陈旧请求返回不能覆盖新公司页面。

原生浏览器已完成保存、送审及批准，验收发现并修复两类公共UI问题：原生同页链接会与待应用的Service Worker刷新争抢导航；审批成功横幅无条件宣称已通知Agent。前者仅保护未被SPA取消的HTTP(S)同页原生链接/表单，不干预新标签、修饰键、下载或锚点；BFCache恢复清除保护。后者改为仅确认审批决定已保存，不能由请求Agent ID推断消息送达。新增回归包含旧实现可复现失败，修复后8文件118项通过；最终UI类型、构建以及原生Chrome四语/审批返回深链复验通过；详见checklists/OPERATIONS-BROWSER-20261026.md。

P4还缺可追溯调研候选、真实数据拉取/写入适配、持久执行意图/租约/结果未知对账、与既有routines的月度触发接线。当前不宣称P4全部完成。
