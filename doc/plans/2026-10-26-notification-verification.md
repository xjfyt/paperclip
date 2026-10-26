# 通知 endpoint/version 验证切片

基线：`45a234e289b14fd5a8177a61bc69f2be6368bcc3`。原 §7.4/§9.4；不新增供应商独立认证要求。

## 合同与失效

- 当前版本观察按公司、endpoint、configVersion独立查询；不是通知中心最近100条的客户端推断。最新pending/失败不被旧accepted覆盖。
- HTTP202只是测试入队；worker保存accepted只表示平台业务接口受理，不等于送达/已读/C3/C4。旧review accepted仍是管理员“报告受理”。
- configuration=`saved_not_revalidated`：GET不再次解析秘密或重做配置校验。原保存配置可能读取已配置AWS等秘密provider，本轮不改变该行为；保存不发送消息，新verification读/声明不新增任何外部调用。
- credentialStatus=`metadata_active`仅表示本地秘密/版本/provider元数据允许使用，不代表远端账号、token或权限仍有效。未固定远端VersionId的秘密不能提供精确账号/版本验证绑定；原发送合同不变。
- endpoint verificationEpoch仅被凭据安全变更递增；名称、resolve更新的updatedAt、普通token缓存刷新不递增。暂停endpoint/worker也不递增。
- 新delivery由DB触发器固定epoch，涵盖既有SQL run.failed生产者。旧行不回填；manual-retry不补上缺失epoch，不将旧观察变成当前证据。
- `doc/plans/sql/2026-10-26-notification-verification.sql` 是A0待分配迁移号的提案，不是已应用迁移；journal/snapshot集中维护。schema依赖其应用后才能部署。
- 凭据变更持有来源行然后更新endpoint；声明事务必须按company台账锁→providerConfig→secret→pinnedVersion→endpoint锁序，禁止endpoint→secret倒序。公司台账与既有adapter记录共用revision和幂等边界。

## 本地检查（不是供应商验收）

第一片：512MB/单worker，server只读query fixture7项、shared严格快照匹配6项通过。没有运行数据库或provider。

命令：

```sh
cd server
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run --config vitest.notification.config.ts src/services/mimouse-notifications/verification.test.ts --maxWorkers=1 --pool=forks
cd ../packages/shared
NODE_OPTIONS=--max-old-space-size=512 node ../../node_modules/vitest/vitest.mjs run src/notification-verification.test.ts --maxWorkers=1 --pool=forks
```

第一次命令误在server目录创建相对路径，已移回计划目录；未找到测试退出。下一次标准config因复用node_modules指向主树而找不到新shared文件，改用显式当前工作树shared alias的纯fixture config后通过。无安装、无服务/DB/网络。类型/构建、迁移、真实DB并发与浏览器留中央验证。

## 人工凭据切片

- 独立`appendNotificationEvidenceSchema`，现有adapter输入schema及其canonical hash原样保留。新增通知receipt的持久JSON类型并复用capability_evidence台账；旧adapter列表过滤通知receipt，返回全台账headRevision保持CAS正确。adapter写入口拒绝撤销通知receipt。
- 四类声明：protocol_report（人工录入协议报告，不带真实投递字段）、live_connection、recipient_observation、approval_scenario。所有类别固定manual=true/machineVerified=false，不从fixture或accepted自动生成。
- 非协议类必须明确confirmRealTarget且引用当前配置/epoch最新投递及最新人工核对，精确比较state/attempt。C4仅原始approval事件，拒绝manual.test或manual-retry冒充原始业务通知，并查询实际同公司approval资源。
- 保存/撤销/替代使用company级CAS、actor+endpoint+规范化body幂等摘要；相同key重放先返回原回执，即使此后配置变更，原回执也只能以旧scope历史展示。不同actor/body/endpoint复用key冲突。审计与台账同事务。
- supersede要求相同scope/category/runtimeVersion/environmentAlias/accountAlias/testedCommit；跨上下文应新建记录，不能移用旧证据。有效期沿现有能力台账，最多30天。暂停不撤销证据；最新失败/新投递/新核对会使旧声明不再显示为当前通过。
- 协议报告的testedCommit/runtime是人工记录，不是从源码文件存在推断测试通过；UI必须明确它是人工报告，非CI自动认证。凭据真实远端过期若未反映到本地元数据，不能由零probe路径发现；metadata_active绝不宣称远端仍可用。

检查：server/shared六文件83项（含旧adapter schema/服务）通过，旧adapter UI/API两文件7项通过；均512MB/单worker。shared原标准config因工作树复用依赖找不到zod曾失败，纯fixture config追加既有server zod别名后通过；未安装依赖。尚未执行真实SQL锁/触发器、API/浏览器、类型或构建。

## 验证界面切片

通知渠道卡片新增“配置验证”，不改变测试发送和旧人工受理评审。面板独立确认当前session（含现有local_trusted路径），公司/endpoint/用户/session/auth重验代次隔离；GET使用独立requestResponse+signal+no-store，不加入URL-only合并池。认证重验/403/读取失败时隐藏私有内容和登记操作；历史未读全不判当前通过。

四语呈现队列/平台受理、旧人工受理、C2协议报告、C3实连、收件端观察及C4审批场景。人工声明冻结当前configVersion/epoch/ledger revision，二次确认；最新数据变化清空旧确认。API支持同上下文supersede；本次UI提供显式新声明和撤销，不暗中替代旧记录。

未知POST将相同幂等键、冻结payload及scope保存在按公司/用户/session/endpoint隔离的sessionStorage，内容仅允许非敏感别名、代码/资源标识和声明时间。重开同一身份仅可显式重试同一请求，不自动POST、不另建key。存储不可用则阻止新请求；旧组件迟到响应不清标记，当前组件也只compare-and-remove自己完整冻结记录。403/409等明确拒绝后需重新读取；异常/5xx/不匹配回执维持unknown。浏览器清存储或新标签页不提供跨客户端 exactly-once 保证，必须先核对服务端台账。

UI纯fixture：新面板与原通知页2文件50项通过（512MB/单worker）。新面板使用真实API传输层+fetch fixture，包括保留旧api.get observer/新session独立GET、旧signal取消、认证重验、403隐藏、未知POST同key/payload、迟到回执、local_trusted及四语。没有浏览器/真实账号/网络实测。
