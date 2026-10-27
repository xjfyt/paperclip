# 构建观测接线、持久回执与未知请求恢复验收

日期：2026-10-27。依据当前主线的服务端接线、浏览器journal及暂停恢复分支；这是待执行手测清单。已从早期未接线库推进到真实UI/API/数据库合同，但**所有准入仍blocked，不是发布或C3通过报告**。最终冻结与全量结果见 [VERIFICATION](../VERIFICATION.md)。

## 实际入口与启用前置条件

- 入口：Coding页面 → 指定delivery交付卡 → **“精确作业构建观测”**。默认折叠，折叠时该面板不发请求；展开只读本地上下文、历史及待决请求，不自动观测/轮询。界面须保留“观测不等于准入”和浏览器journal边界说明。
- 功能默认OFF；仅服务器运营方配置 `PAPERCLIP_BUILD_OBSERVATIONS_ENABLED=true` 和 `PAPERCLIP_BUILD_OBSERVATIONS_CONFIG_FILE` 才能启用。环境值不是请求参数；本清单不自动修改环境、创建配置或提供真实凭据。
- 配置必须是**工作区外、运营方控制且父目录也受控**的规范绝对路径regular file；最多128 KiB、32 profiles、每公司8 profiles。每次派发/落库边界重读；严格拒绝重复键、损失精度数字、非法UTF-8、未知字段等。末级 `O_NOFOLLOW` 不等于父目录安全或OS隔离，多实例须保持同源/规范路径约定。
- 顶层为 `schemaVersion:1` 与 `profiles`；每个profile显式含 `id/companyId/observer/manifestPath/subjectName/maxObservationAgeSeconds/provenancePolicy`。完整schema见源码，不复制含私钥或真实token的大段配置；`provenancePolicy:null` 只允许字节观测，不表示可信签名。
- 复用delivery现有公司级active `local_encrypted` vault secret的明确当前版本；完整secret内容摘要须匹配，内容仅接受单字段JSON token合同（夹具可用 `{"token":"fixture-token-not-real"}`）。不是裸token、不接受额外/重复字段或控制字符；外部secret provider本片不支持。配置、API、日志均不接收/暴露真实密钥材料。
- 必须是真实持久board session、当前active公司owner/admin及当前任务隐私许可；agent、implicit `local-board`、伪造缓存管理员或测试header不能代替。仅持有请求ID不授予权限。
- 必须已有精确delivery：company/issue/workspace/source branch、GitLab origin/project、pipeline、head SHA及完整当前artifact manifest一致；profile唯一选中服务器原先计算的产物大小/hash。用户只选profile与正安全十进制job ID；不能另填URL、策略、摘要或凭据覆盖绑定。
- 真实外部读取仅在明确授权指定实例/项目/job范围后执行。必须为白名单**公网HTTPS**；私网、CDN/其它重定向、响应download URL跳转当前不支持，凭据不转发；不能为完成验收绕过保护。

## READ：默认只读、展示不误导

1. 在中/英/西/日四语分别检查标题、禁用/无匹配、pending、恢复、关闭确认、历史及aria标签；ID、SHA、profile、诊断码保持原值。桌面/窄屏检查长ID换行，多个delivery展开时label互不冲突。
2. 未启用、缺profile、head不符、无pipeline/manifest或凭据合同不符时不能开始观测；implicit local-board不读面板私有数据。真实会话失效/角色或隐私撤销后，刷新必须隐藏旧证据，不保留看似可用的历史。
3. 展开、刷新历史、`requests/current`、精确`requests/:requestId` GET均不调用GitLab、不resolve secret、不补写关闭标记、不重试POST。历史分页仍限本公司/交付，current仅辅助发现当前actor最新请求。
4. 回执显示原始recordedAt/observedAt/verifiedAt及签名起止时间；刷新和重复读取不得“续新”。`local_current`仅表示本地绑定/时效仍匹配，**不证明远端产物仍存在或重新检查过**；配置/身份无法解析为unknown，变化/过期为stale。
5. 即使字节摘要和`verified_claim`都成功，回执admission、六目标matrix及旧runner/test/signature验证位仍不放行；签名声明不等于可信controller、实际平台/测试、代码签名或工作流闭包，不授予发布权限。

## START：明确POST、绑定复核与不可变回执

1. 仅明确点击“观测此作业”才POST四字段 `{requestId,profileId,jobId,expectedBinding}`。`0/01/负数/小数/指数/超安全整数` job ID不得POST；快速重复点击不得产生新的替代请求。
2. 在每次POST前，检查journal已写入并回读相同四字段；模拟读取、写入、回读或清除异常，应显示存储错误并阻止后续POST，不能建议清浏览器存储绕过。
3. 成功路径只按固定job→pipeline→artifact→DSSE→job→pipeline六次GET观测；HTTP不持DB锁，不执行产物、CI命令、模型或通知。每次实际HTTP前及最终CAS落库前重验当前身份、delivery/head/pipeline/manifest/config/secret绑定。
4. 在派发前与HTTP期间分别变更head、manifest、pipeline、配置或secret版本/内容；旧绑定不得继续采集或提交有效证据。撤销session/角色/隐私后丢弃已收到内容，只允许按仍拥有的租约写空诊断，响应前再授权；不得泄露原始vendor响应、envelope、token或策略内容。
5. 相同actor/delivery/requestId及原body：执行中返回202，完成后返回原回执，不重跑远端、不添审计、不改时间；同ID不同body/actor/delivery应冲突。回执UPDATE必须被DB拒绝，每请求最多一条且admission受DB约束为blocked。

## JOURNAL：导航、身份变化和重挂载不遗忘未知请求

1. POST响应丢失后保留原requestId；折叠/重挂载、同用户换session/authEpoch/head只取消旧展示/请求，不能删除journal。重新展开优先精确GET原ID，而不是current/latest覆盖已知未决输入。
2. 切公司/delivery/user后不泄露或擦除另一scope的journal；返回原scope仍恢复其ID。迟到GET/POST结果不得写入新scope面板；浏览器abort不证明服务器从未收到请求。
3. 精确恢复遇403、404、null、不匹配旧terminal、expired/interrupted均不得清journal、生成新ID或自动POST。只有同ID/input/delivery的持久terminal回执校验成功才可清对应项；其它待决逐条保留。
4. 有多个未决时，一条terminal后使用“恢复下一条待确认请求”，不能跳成“准备新的观测”。公司paused、feature OFF或配置漂移时，已授权本地读取/关闭仍可用；**paused可恢复下一待决，不开放新观测外发**。
5. 只有精确GET返回retryable后，明确点击才可按原四字段重试。journal是浏览器恢复线索，不是跨标签原子锁；外部清除/丢失存储仍可能失去线索，不能宣称绝对exactly-once。

## CLOSE 与并发：本地关闭不等于远端取消

1. “在本地关闭未确认请求”须二步明确确认；只POST原四字段加`confirmClose:true`，path/body requestId一致。取消确认不POST；关闭结果未知仍保留journal并精确GET，不自动再关或新建ID。
2. 有效活动租约关闭返回409，不能提前终止；missing请求写空terminal负标记阻止迟到原POST派发；expired租约关闭清fence并写空回执，旧执行者迟到不能越过CAS追加/覆盖。已完成或重复关闭返回既有结果，不重复审计。
3. 负标记仅阻止**今后本地同ID派发**，不证明旧请求未发生，不撤销已发生的GET，也不取消CI/任何远端动作；界面和报告不得使用“旧请求从未发生/已取消CI”等说法。
4. 用隔离PG夹具核验DB clock：45秒租约、5分钟显式重试窗口、最多两次尝试；每公司最多一个有效执行、每小时十个新逻辑请求。跨actor抢ID、变更body、过额、超窗或旧租约token均不得绕过；missing关闭也受新请求额度约束。

## 0360迁移、备份与恢复

- 使用正常迁移入口应用 [0360](../../../packages/db/src/migrations/0360_mimouse_build_observation_receipts.sql)，不手工改migration journal/伪造已应用。DDL显式5秒lock timeout、30秒statement timeout；锁/执行超时应记录失败并诊断，不跳过约束、删旧数据或无限等待。
- 迁移前按现有实例备份流程确认可恢复点；隔离恢复演练检查requests/receipts、复合FK/唯一索引、blocked约束和UPDATE guard都在，原时间/ID未重写。DB备份之外另保管运营配置、local encrypted master key及需要的实例文件；浏览器journal不是DB备份的一部分，恢复后不得自动POST未决请求。
- 两张新表允许合法company/delivery级联清理，没有DELETE trigger或观测删除API。旧company-deletion先删companySecrets而旧delivery secret FK仍在，是**既有独立清理债务**；本片不宣称整个coding公司删除/全实例恢复已闭环。

## 标准server隔离夹具复现（本清单未执行）

从仓库根目录进入server，使用已安装依赖和标准配置；先确认DB/shared workspace链接指向本checkout源码（测试内也检查），不要误用别的worktree构建产物：

```bash
cd server
CODEX_HOME='' PAPERCLIP_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 \
  NODE_OPTIONS='--max-old-space-size=1024' \
  node ../node_modules/vitest/vitest.mjs run --config ./vitest.config.ts --maxWorkers=1 --no-file-parallelism \
  src/__tests__/mimouse-build-observation-config.test.ts \
  src/__tests__/mimouse-build-observation-secret.test.ts \
  src/__tests__/mimouse-build-observation-receipts.test.ts
```

标准[配置](../../../server/vitest.config.ts)/[setup](../../../server/src/__tests__/setup-supertest.ts)会隔离测试home；空CODEX_HOME只建立虚构auth，不登录/调用Codex。PG[夹具](../../../server/src/__tests__/helpers/mimouse-build-observation-fixture.ts)创建独占`/tmp` owned PostgreSQL、仅回环监听、正常全迁移、真实持久session/会员，注入惰性假token resolver和HTTP响应，并禁止真实fetch。它不连接真实GitLab/模型；清理前验证目录/PID归属，不停止或删除未知实例。

## 源码与结果范围

- 设计：[接线与不可变历史](../../plans/2026-10-27-mimouse-build-observation-receipts.md)；后端：[配置](../../../server/src/services/mimouse-coding/build-observation-config.ts)、[绑定/授权](../../../server/src/services/mimouse-coding/build-observation-binding.ts)、[服务/CAS](../../../server/src/services/mimouse-coding/build-observation-service.ts)、[路由](../../../server/src/routes/mimouse-build-observations.ts)、[PG回归](../../../server/src/__tests__/mimouse-build-observation-receipts.test.ts)。
- UI：[Coding入口](../../../ui/src/pages/MimouseCoding.tsx)、[面板](../../../ui/src/components/MimouseBuildObservations.tsx)、[journal](../../../ui/src/lib/build-observation-journal.ts)、[面板回归](../../../ui/src/components/MimouseBuildObservations.test.tsx)、[journal回归](../../../ui/src/lib/build-observation-journal.test.ts)；合同：[shared](../../../packages/shared/src/mimouse-build-observations.ts)。
- 工作分支记录：PG29项、UI/journal62项、相关unit195项及隔离纯类型检查通过；PG是真实隔离数据库，HTTP/secret仍为夹具，UI不是实际浏览器。不要相加作为全站覆盖率或把报告视为本清单另跑的结果。
- 主线首轮server构建137终止已保留日志，资源调整后完整重跑通过，实际印章0cf14b87；准确输入、完整类型/构建/测试结果见VERIFICATION。**没有独立发布包all-dist、真实公网GitLab、真实签名controller、平台/C3或生产恢复通过声明。** 本次仅新增文档，未运行命令、迁移或外部请求。

中央更新（2026-10-27 13:53 UTC）：冻结0cf14b87的完整UI类型和server/DB/shared/UI构建、961项UI、272项后端、29项新库观测API及164项编译API已通过。838文件84批10792项完整UI严格聚合通过；准确结果与失败修复记录见[VERIFICATION](../VERIFICATION.md)。真实浏览器、供应商与all-dist安装仍须分别验收。
