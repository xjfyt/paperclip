# P5 受控技能文件恢复（窄范围）

## 支持与权限

本切片只支持真正的 `local_path` + `metadata.sourceKind=managed_local`，且源目录是公司 managed-skills 根目录的非保留直接子目录。**公司须由人提前暂停，技能不得挂接代理，公司不得有 queued/running heartbeat 或 running 代理。** 不会自动暂停公司、解除代理绑定或启动测试/模型。目录须为0755，普通文件0644或0755；版本清单只记录可执行位，因此非标准模式拒绝而不放宽权限。仅支持规范化POSIX路径；Windows、根目录别名、符号链接/硬链接/特殊文件、远程/catalog/project/bundled/skillSource管理技能均显式拒绝。

必须是真实session来源的公司owner/admin；local_implicit、Board key、cloud_tenant、MCP OAuth和Agent均不提供此文件写入权限。服务再次检查真实用户和当前活动公司成员关系，并复用公司 `skills.edit` 策略。通过的评测报告仅是证据，不是权限；报告哈希、两个固定版本及文件清单哈希必须吻合。提升要求当前版本为报告基线；回滚须引用当前最近一次已应用提升收据，恢复该次提升前的版本和名称/描述。

暂停公司仍可访问：CompanyContext只隐藏archived公司；认证membership加载不按公司active过滤。heartbeat queue/scheduling要求active公司，不会因本恢复自动运行代理。

## 文件与数据库协议

1. 复用上游slug advisory lock和技能row lock，重新检查身份、来源及expected-current-version。
2. 校验当前**实际全目录**（非仅DB文件列表）与基线版本快照相等；对目标版本执行已有snapshot audit。校验文件路径、重复与前缀冲突、base64、文件总量/大小。最多1000文件、16MiB。
3. 在同一managed根内的保留操作目录写入完整target目录，保留binary字节和可执行位，fsync文件/目录。此阶段不修改live文件。
4. 在同一DB事务持久写入prepared操作日志、审计事件、技能 `mimouseRestorePending` marker；提交后才移动live目录。
5. 新事务锁定同一技能并重新检查当前权限、公司暂停和并发状态。`live -> before`、`target -> live` 两次同文件系统rename后逐树重新验证。然后原子提交技能markdown/名称/描述/清单/trust/currentVersionId、操作applied状态和审计。**不是只改currentVersionId**。中间目录间隙由pending marker封锁读取、普通编辑/导入、运行时解析与库存自动清理。
6. 如进程/数据库在rename后失败，prepared日志和marker保留；重启后的显式人工恢复根据live/before/target三个完整hash判断精确布局。允许继续apply，或者先持久锁定compensate方向再恢复原树。选择compensate后不得切回apply。未知字节/布局不猜测、不删除，要求操作员调查。
7. before备份保留在操作目录，便于检查和失败恢复；当前不做自动保留期清理。完整目标staging在DB提交前失败可复用；不完整孤儿staging明确要求人工检查，不覆盖不明文件。

普通本地文件系统/数据库并非单一跨资源事务。此实现是**静默期、失败关闭、可恢复的整清单替换**，不是活跃代理无停机切换。以数据库已提交receipt为完成依据；HTTP202/prepared不是成功。文件权限/目录形状不在支持集内不会“尽量恢复”。

## API 与集成

新增独立 `mimouseEvaluationRestoreRoutes(db)`，根路径 `/api/companies/:companyId/skill-evaluations/restores`：
- GET根目录：当前人类管理员的最近100条操作收据。
- GET `/readiness/:reportId`：来源/暂停/使用状态与pending/last收据ID；不声称已完成文件系统验证。
- GET `/:id`：公司内操作收据；不经过被pending阻塞的普通getById。
- POST根目录：`requestId, reportId, expectedReportHash, expectedCurrentVersionId, action, rollbackOf?, confirm:true`。
- POST `/:id/recover`：`expectedOperationHash, resolution:apply|compensate, confirm:true`。

父工作树集成：
1. shared index导出 `mimouse-evaluation-restore.js`；db schema index导出 `mimouse_evaluation_restores.js`。
2. app.ts导入并挂载新restore路由。此路由与普通评测路由互不替代。
3. 生成新增restore表迁移（依赖companies/company_skills/company_skill_versions/mimouse_evaluation_comparisons），含公司request唯一和每技能prepared唯一约束；本分支不修改migration journal。
4. 合并后续 `evaluationRestoreUi` 四语贡献，并挂接页内受控操作面板，无新导航项。
5. `skill-evaluations` 敏感日志策略继续覆盖这些端点；审计只记操作哈希、版本和报告ID，不记文件正文/本地路径。
6. 单独运行数据库/真实文件夹具、route/UI测试和全量类型/构建；失败时不得由纯FS单测推断完成。

## 当前验证

10项纯FS测试通过，单worker、512MB heap，日志 `/tmp/mimouse-evaluation-restore-fs.log`：二进制/可执行位/删除、两个rename中断点、幂等继续与补偿、补偿中断、链接/模式/文件变化拒绝、路径冲突。未运行本切片数据库、route/UI、全量类型/构建，遵循父工作树共享内存冻结；这些仍是集成前条件。

## 并发边界补强

恢复、技能文件变更及清理采用 **company accounting row → slug advisory → skill row** 顺序；先拿公司锁，再查实际代理引用。恢复每次 apply/compensate 都重复此检查。代理生命周期的普通配置、直接 adapterConfig、revision rollback、hire/approval 在事务内拒绝任何 proposed pending 技能引用；解除引用不受阻。运行时读取的 missing 状态不是持久配置权限，提交检查不能省略。

少数内部配置事务可能先持有 agent row；提交 guard 对 company 使用 NOWAIT，遇到相反锁顺序立即409并回滚，而非等待形成死锁；上游标准生命周期已先持有公司 accounting lock，不受此快速失败影响。

长时间 audit/inventory 不能拿旧 metadata 全量替换新状态：audit 使用当前 JSON 原子 merge，并以 updatedAt/currentVersion/source CAS 拒绝过期结果；inventory 使用 revision CAS，包括 missing-source 删除路径。createVersion 在 row-lock 后重读 pending 和原 currentVersion/source/slug，旧快照不能覆盖刚恢复的版本。target 全嵌套目录和原 live 树均在 prepared 提交前自底向上 fsync；原树即后续补偿备份。

新增 `tests/mimouse/evaluation-restore.spec.ts` 是隔离真实文件/DB fixture：先确认服务器 DB data_directory 和实例根属于 PAPERCLIP_MIMOUSE_TEST_HOME，再创建公司/文件。覆盖真实整树激活/回滚、rename/数据库提交中断、audit/version/inventory 跨 pending 与 completed 竞态、attachment 公司锁交错、direct/revision pending attach 拒绝和 detach/recover，以及 paused-company 路由/当前成员资格。路由认证使用明确注入测试 session actor，不声称测试真实 SSO 登录；不执行任何模型/Agent。夹具未在本工作树运行，交父工作树统一执行。
