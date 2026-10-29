# 本地集成验证记录

> **维护提示** — 追加实际执行记录与稳定证据引用，保留各自完整输入、失败和重跑范围，不覆盖历史事实。
> **最后验证** — 2026-10-30（记录入口和当前/历史范围核对；实际执行以各节为准）

## 2026-10-30 完善与复核

[最新记录](checklists/2026-10-30-project-closure.md)列出本次修复、当前输入的验证和未闭合项；[浏览器机器证据](checklists/2026-10-30-browser-closure-evidence.json)保存编译入口 API/四语、独立认证恢复及实际主页面、MDX 和 Mermaid 的结果与摘要。旧审计中曾出现的警告、失败和环境限制仍留在原日期记录，不作为本次结果。

## 2026-10-29 Windows 工作树审计

本轮代码基点为 `5ccd4ef014d1dc4101327985fde8cd6203b44dec` 加工作树补丁。[审计报告](checklists/2026-10-29-project-audit.md)保存问题、修复、根级命令与剩余项，[本机验证证据](checklists/2026-10-29-project-audit-verification.md)保存标准构建、真实 Edge、隔离 API 的失败与复验范围。根级 `pnpm -r typecheck`、`pnpm build` 已实际退出 0；这不等于完整 Vitest、全部供应商或发布验收通过。

以下“重建候选”及后续历史节描述各自环境/冻结输入，不覆盖本轮结果，也不因新检查自动升级原验证等级。

## 2026-10-29 重建候选：当前证据与未完成检查

记录截至 **2026-10-29 07:03 UTC**。本次从远端 `mimouse` 的 `e2bab5dcec32b09fa5aba852774a1039b12c9997` 重建，当前核对源码为 `0d1105e6069265a45431ef562861afa7e57ebedf`。前一环境的未推送 `c5af04fa690622ad5e51c230b24691c8edf25787` 源码/日志没有找回；本批是逐片重新实现与验证，**不是找回旧工作树**。旧环境852/914等历史数字/结果以及下方10月27日的类型、API、全UI和浏览器记录均为历史，不证明本批通过。

### 本批实际代码范围

- 四个真实失败运行入口（`Inbox`、`LegacyInbox`、`IssueDetail`、`AgentDetail`）及决策工作台/队列：同步预留防重、固定原目标、页面/公司/用户/会话变更后的晚到回执隔离。`AgentDetail.production` 的静态合同不冒充实际挂载证明。
- 默认文档、批注、成果/文件、任务互动、Agent配置、成本/指令历史、引导、审计及决策路径按实际宿主补四语；读取失败不再伪装空态，保留草稿、原始用户/供应商内容、技术ID与错误来源。具体覆盖仍是有界审计，不以键数宣称全站翻译完毕。
- 编码交付在分页 limit 之前执行原权限过滤，校验可读游标和项目筛选，仅汇总当前授权页；产物摘要通过同一文件描述符检查和读取，保留文件身份/替换竞态拒绝。
- 新增内部运行日志的**内容无关引用**预览/人工确认：只选元数据，不读取/复制日志正文；真实 session、原运行隐私、不可伪造内部命名空间和事务幂等均保留。引用不授予源访问，也不证明缺陷已复现。
- 新增调研例行**只读运行历史**：当前成员/session、完整来源公开边界、canonical run权限、可读游标和有界查询；暂停公司可读但不派发。历史入口不是新增调度器，不证明真实来源采集已完成。这两项是已有反馈/调研机制的增量，不应把原计划相关能力倒写为此前全部缺失。
- `/api/auth/get-session` 保留既有 JSON `session.id`、cookie和服务端授权；真实 session 附加域分离SHA-256 `X-Paperclip-Session-Scope`，响应及客户端读取为 `no-store`。标记没有认证能力，只作前端缓存/回执身份；`scopeKey`缺失按旧身份兼容，未知缓存与已知null本地会话分开。私有回调在认证缓存事件发生时同步失效，而非等React后续提交；没有把标记当成新访问权限。

### 首轮完整UI发现的问题与后续补齐

首轮`9e9b02e`的911文件/92批检查**没有取得完整严格聚合通过**。诊断继续执行了其余批次，未发现其它应用失败；第20/31批另因共享shell脚本在执行期间被修改而解析失败，重跑已通过，不能把该环境/调度失败隐藏，或将这些不同输入/补跑拼作新输入全量通过。

- `6929165`只修批注宿主fixture：原6项失败因未mock真实认证查询，相对URL在Node fetch解析失败导致缓存unknown；生产guard正确拒绝，未放宽身份栅栏。12文件78项复验通过（`/tmp/annotation-auth-all-green.log`）。
- `534854b`只修Markdown成果fixture：2项旧英文大小写/引号断言对齐实际资源，保留413/415/422不自动重试及错误/原始路径合同；3文件24项通过。
- `4eae310`只修Composer的`realmPlugin` mock：旧mock返回对象而非工厂造成187项空编辑器级联失败；原202项及邻接合计5文件347项通过（`/tmp/task-thread-composer-full-green.log`），没有修改生产或删除断言；该347项日志随后因缺少既有`plugin-sdk/ui`生成产物而类型失败，保留整体exit1；复用同源码既有ignored dist后`/tmp/task-thread-composer-types-green.log`于05:50:11 UTC类型复验exit0。
- `9d24e91`补近期任务侧栏/重命名和secret access四语，3文件68项通过；`238feb4`补TaskSkillPanel、RouteErrorBoundary与浏览器footer，保留原文、协议值及恢复时序。
- `42feae2`修正实际菜单同尺寸重选的双resize派发：鼠标/键盘12项基线红测，移除重复item回调后仍允许同值重选一次，67项邻接通过（`/tmp/browser-resize-baseline.log`、`/tmp/browser-resize-fixed.log`）。这是组件交互证明，不是本机Chromium已运行。
- `5ff27dc`补Panel/viewport本地错误四语、保留原始`browser.error`；语言切换不更换iframe/重启轮询或租约，撤权后旧请求不能恢复iframe。最终相关8文件102项通过（`/tmp/browser-panel-final.log`）。

### 普通适配器配置补译已合入

`1484a0d`已补普通Claude/Codex两份配置显示中的沙箱/搜索/fast、Chrome/权限/最大轮次及本地help；`7020665`合成7294键。仅改显示层，保留共享help常量、默认权限、安全警告语义、模型ID、配置payload；没有调用真实Agent。两文件176/176定向回归通过（原有132项＋新增44项，不是新增176项），覆盖组件与真实表单宿主（`/tmp/agent-runtime-fields-regression.log`），覆盖四语、热切/焦点/草稿、禁用、警告与原始诊断。此前明确的这两处本地代码缺口已补，不再列为待实现；真实CLI及浏览器环境仍另验。

`defa7eb`/`0d1105e`将审计扩至168个AST文件、21个manual helper、另5个协议source、56个host、132条边；[当前报告](checklists/2026-10-29-i18n-final-audit.json)为787个literal候选、3390个dynamic位置，780个eligible TSX中612个未扫描（其中5个仅作证据）。Claude为真实JSX消费，Codex为模块引用/注册表/动态分发的有界语法证据，不虚构直接JSX宿主或完整调用图。7294键、候选数与范围扩展都不是全仓翻译完成率；此前160/166文件等均为各自历史口径。

### 可核验检查表

| 检查 | 当前结果 | 证据与边界 |
|---|---|---|
| 标准完整 server 构建 | **通过** | `/tmp/rebuild-server-final-20261029.log`，05:20:44 UTC退出0；实际`server/dist/build-info.json`印章为`8b590bf8f1e0c8752d98dd4c02fd32bab8214d12`。包含runner/eval准备、类型检查/emit和资源阶段；Rust既有7条warning保留。核对该印章到`0d1105e`的server/packages/cli/external-adapters差异为0。 |
| 首次 server 构建 | **失败后修复** | `/tmp/rebuild-server-standard-20261029.log`的7条research测试类型错误由`024c288`按真实任务归属字段修复，随后标准完整构建重新通过；不是删除断言或放宽产品类型。 |
| 当前完整 UI 类型 | **通过** | 普通配置补译/7294键整合后，`/tmp/paperclip-runtime-fields-final-checks-20261029.log`完整类型、构建、正确门禁串行整体exit0（06:33:23 UTC）；后续0d1105e仅调整审计脚本/报告，不更改UI产品源码。 |
| 当前标准 UI 构建 | **通过** | 同一日志标准Vite构建11.90秒，组合命令exit0；保留动态导入/大chunk/plugin timing等提示。本轮不是套用358bd7a的13.61秒结果。 |
| 当前i18n/资源/token门禁 | **53项审计与正确门禁通过** | 中央审计`/tmp/paperclip-final-adapter-audit-20261029.log`53/53，零失败/跳过/todo，06:40:43 UTC exit0；正确token/palette/cliplab门禁在06:33:23整链通过。上一阶段曾误写test:token-gates而整体254、随后正确补验通过，只保留为历史，不抹除也不转嫁当前命令。 |
| 当前7294键完整 UI 严格聚合 | **915文件/92批/12940项通过** | 06:59:42 UTC严格聚合passed，10个manifest均sourceUnchanged=true；逐个核验manifest/report哈希、92批唯一覆盖、915文件、12940断言全passed，失败/skip/todo为0。源码SHA-256 `fc75b878a0c6711453725723d576f4e4b6ec29febcfb66a3f262621148e22b23`，runtime-trees-v2输入`002e5e6141f4dce05b1561ee2d066823a3723ea50c4474e5967aa7bbe19077a4`。证据`test-results/mimouse-ui/aggregate-2026-10-29T06-59-42-686Z-t9Kb9o/aggregate.json`，监督`/tmp/ui-final-7294-supervisor-20261029.log`。这是新输入完整覆盖聚合，不是单次不中断运行；不沿用下行358bd7a结果。 |
| 上一358bd7a完整 UI 严格聚合 | **914文件/92批/12896项通过** | 06:26:23 UTC严格聚合passed，10个新manifest全部sourceUnchanged=true；源码SHA-256 `57f5d2a6accd9544f7749e0f0aa982ccd0ad8de8d227655fb177837db16d9aa7`，runtime-trees-v2输入`b58af7a122b0b8971ba1e6793a8e4d106e5bea5e6fff3dd2b585b17f447c3d84`。证据`test-results/mimouse-ui/aggregate-2026-10-29T06-26-23-061Z-9Tz21t/aggregate.json`，监督日志`/tmp/ui-final-rerun-supervisor-20261029.log`。这是同输入完整覆盖聚合，不是假称单次无中断运行；不复用首轮失败分片。 |
| 编译 server 入口完整164项 API | **164/164通过** | 新标记隔离库，`/tmp/mimouse-compiled-final-20261029.log`，1.3分钟，05:25:27 UTC退出0。这是05:25本次重建的实际运行；后端到`0d1105e`无差异，因此仅沿用后端证据，不冒称新UI复跑API；编译入口仍有workspace TS依赖与源码fixtures，不是all-dist安装。 |
| 新认证 recovery API smoke（4项） | **4/4通过** | `/tmp/recovery-compiled-final-20261029.log`，18秒，05:23:44 UTC退出0。独立新HOME、authenticated/private/static UI、真实BetterAuth cookie/session与编译注册路由；包含同用户两个真实session的header隔离。入口`pnpm test:mimouse:recovery-api`检查stamp/后端差异/UI产物。后端到`0d1105e`无差异，仅沿用后端证据；DB合成数据，workspace包仍TS，不是all-dist安装、新UI浏览器或真实Casdoor。 |
| 依赖安装与lockfile | **本地一次非冻结重试成功；锁文件未提交** | 冻结安装因server的`paperclip-eval-kernel` workspace声明缺少lock importer条目失败；依[仓库锁文件政策](../DEVELOPING.md#dependency-lockfile-policy)仅本地一次`--no-frozen-lockfile`重试成功。提交锁文件由bot负责；这不是独立安装包验证，不修改依赖/补丁或把网络/权限失败泛化重试。 |
| 根级全工作区检查/独立安装 | **未取得本批整体结果** | 分包server/UI类型构建与MiMouse API不等于根`pnpm -r typecheck`、`pnpm test:run`、`pnpm build`整体通过；本批独立all-dist安装与既有数据升级恢复尚待专门验收。 |
| 本批实际浏览器、OS输入法及跨平台 | **环境blocked；未完成浏览器验收** | Chromium在IPC socket阶段受限，独立浏览器不可达执行机回环，官方headless-shell下载不是有效ZIP；未打开应用页面、没有截图，不是page failure。合法兼容尝试结束且临时实例正常停止；详见[环境记录与复验](checklists/BROWSER-ENVIRONMENT-20261029.md)。OS输入法/六平台仍需用户环境。 |
| 阶段推送与远端 CI | **当前候选已推送；资源CI成功** | 06:42 UTC核对远端`mimouse`为`0d1105e6069265a45431ef562861afa7e57ebedf`（[提交](https://github.com/xjfyt/paperclip/commit/0d1105e6069265a45431ef562861afa7e57ebedf)）；[该SHA资源CI](https://github.com/xjfyt/paperclip/actions/runs/40830723132/job/123304070781)completed/success，仅resources，不是完整CI或浏览器验收。本次文档随后单独提交/推送。 |

上一358bd7a源码与其完整UI证据已持久保全；保全不替代远端SHA、CI或独立安装验证。

当前已确认的本地补译、三组fixture与双resize缺口已闭合，并取得当前新输入完整UI通过；四项外部合同的代码缺口、真实浏览器/供应商及根级全工作区/独立安装边界保持。日志路径是当前执行环境的证据定位，不是用户机器上保证存在的文件。用户复验步骤及尚需提供的合同见[用户验收](USER-ACCEPTANCE.md#2026-10-29-重建候选验收入口)与[剩余项](REMAINING.md#2026-10-29-当前阻塞与明确代码边界)。当前仅按上述实际输入和各阶段证据宣称通过，**不能宣称全计划完成、全仓全类检查通过或生产就绪**。

## 历史记录（以下均按原日期与冻结输入解读）

## 5500键协议显示与运行时问答草稿修复（2026-10-27，已本地验证）

- 本批冻结`122be536a9aa67d91ad57c514924c987f9795990`，范围和逐步手测见[协议界面与草稿清单](checklists/PROTOCOL-UI-RUNTIME-DRAFT-20261027.md)。补齐工具display API、活动摘要、workspace/runtime卡、QuestionForm/RichInput、本地Thread默认值，并追加Inspector独立可达卡片。canonical分类/去重/排序和原始provider内容保留；同文raw来源不由英语字符串反推翻译。
- 功能修复9fef7999独立于翻译：Form收到原始拒绝、不再把失败当成功清草稿；Form/Card同步attempt及layout清理隔离晚到结果，structured草稿由Form单独拥有，稳定request/run/turn/draft身份隔离legacy字段。同act防重、真实Thread runtime→durable同key交接、旧完成/失败、新草稿保持均有红→绿证据；独立只读复核无阻断。原QuestionForm已有id/draftKey wrapper，不夸大原问题；跨turn同ID重用仅属防御测试。
- [schema4审计](checklists/I18N-AUDIT-20261027-5500.json)把AST范围从78扩为82，另列5份manual源证据；原范围、候选行定义保持。最终278 literal/1974 dynamic不是漏翻总数；AST source SHA-256 `9d72c17c3f37a8e15618db93a8eadb7e3559fe355692347503efcabd5837d6c3`，manual SHA-256 `aa943fbcb0dfc86f83f16d9d0caedc4d49a9f49d3ae9c815d4c52772b5b7665f`，所有missing/unmatched为空。新增加的Card13项在Inspector条件可达，不能因主timeline不用这些卡就当死代码；已补并测试真实Preview解析/投影/Card，非完整浏览器Inspector。Group Permission只作fixture能力覆盖，不宣称生产供值。
- 最终完整UI类型通过（`/tmp/paperclip-5500-ui-types.log`），串行标准UI构建4.12秒通过（`/tmp/paperclip-5500-ui-build.log`）；保留既有大chunk/dynamic-import/CSS提示。中间5486类型首轮3个测试夹具问题已按真实类型修复（47cb687f），没有放宽生产类型或断言。18文件717项中央通过（`/tmp/paperclip-5500-central-ui.log`，5条既有scrollTo提示），61项脚本及compose/token/palette/cliplab/no-git-push门禁通过（`/tmp/paperclip-5500-scripts.log`）。
- 新完整UI为新inventory/9分片/2并行，**868文件、87批、11830项严格聚合通过**，零失败/跳过/todo，sourceUnchanged均为true；不沿用5142的11588项。环境恢复后核对改动与日志并重跑在途验证；worker缺新资源/协议schema/Pi源依赖的失败在主线相应邻接用例补验，未删失败记录。后端server/packages/cli对2d6d12c9无差异（`/tmp/paperclip-5500-backend-unchanged.log`为0），旧164项编译API/48c9c1d0构建保持历史范围，不冒称本批新跑。
- 最终聚合证据`test-results/mimouse-ui/aggregate-2026-10-27T18-32-00-887Z-PU6lQU/aggregate.json`，聚合日志`/tmp/paperclip-5500-ui-parallel-aggregate-cce5f7fb.log`，监督日志`/tmp/paperclip-5500-ui-parallel-supervisor.log`，分片清单`/tmp/paperclip-5500-ui-parallel-manifests.txt`。UI源码SHA-256 `ed1d79f336ff7e22fba9b81dc9886435cc5a371792066815aff0c9e377a5e0a8`，runtime-trees-v2摘要`646bf37f2c708722b7f2d46cd9199021ec2ca2cea60d629350b91f208d081b6a`。这是同输入严格覆盖聚合，不伪称一次不中断执行。
- 未执行真实账户/模型/通知、完整浏览器/IME、独立all-dist安装包或跨平台验收。部分按钮为明确hidden条件下的组件能力测试，不能当生产路径。原85项需求状态不因5500键或mock数量而变更；发布以远端mimouse完整SHA核对为准。

## 5142键动态来源补全（2026-10-27，已本地验证）

- 本批冻结 `91492969b2abfab58386851c861f636c7630f98e`。从前批1862个动态位置追踪实际宿主与本地来源，补齐权限/来源、审核策略、列表排序/分组/依赖、日期/账单、活动完整句、聊天本地错误/附件类别、引导与selector上游、类型化暂时不可用、角色/环境、责任人opt-in和实际时间线。逐片证据、已撤回误报及源契约/真实host差别见[动态文案清单](checklists/I18N-DYNAMIC-CLOSURE-20261027.md)。
- 同schema 3的[5142键审计](checklists/I18N-AUDIT-20261027-5142.json)仍是78文件，278 literal/1849 dynamic，source SHA-256 `6ca65c8c073890bead39965c1bf1603ff77a65a8b2df5e453f5845b3ad7e28bc`；缺失路径检查均为空。动态位置数量不是缺陷数量，递归caller跟踪也不代表全站已译；用户/供应商原文和技术值有意保留。
- UI完整类型复验通过（`/tmp/paperclip-5142-ui-types-final.log`）；首轮发现测试Object.entries扩宽语言类型及unknown错误未显式收窄，已用确定四语元组和真实instanceof分支修复，未修改生产或降低断言，首轮日志保留。34文件1493项中央定向通过（`/tmp/paperclip-5142-central-ui.log`）；52项Node脚本与compose/token/palette/cliplab/no-git-push门禁通过（`/tmp/paperclip-5142-scripts.log`）。这些不相加冒充全UI。
- 生产UI构建串行重跑通过4.15秒（`/tmp/paperclip-5142-ui-build-final.log`）。首次与34文件测试并行时在rendering chunks阶段被系统终止137（`/tmp/paperclip-5142-ui-build.log`），故等待测试退出后按原命令完整重跑；未跳过步骤或放宽检查。保留大于500KB chunk、无效dynamic import及既有CSS highlight处理提示。
- 新完整UI使用新inventory/9分片/2并行，**859文件、86批、11588项严格聚合通过**，零失败/跳过/todo，全部sourceUnchanged=true；不是沿用4762版本的11160项。server/packages/cli对0500d928无差异（`/tmp/paperclip-5142-backend-unchanged.log`为0），164项编译API和48c9c1d0构建是未变后端历史证据，不是本批重新执行。
- 完整UI证据：`test-results/mimouse-ui/aggregate-2026-10-27T17-27-12-372Z-XZ45Ps/aggregate.json`，聚合日志`/tmp/paperclip-dynamic-ui-parallel-aggregate-3210369e.log`，分片清单`/tmp/paperclip-dynamic-ui-parallel-manifests.txt`，监督日志`/tmp/paperclip-dynamic-ui-parallel-supervisor.log`。UI源码SHA-256 `6cb4a66c5e67e1879a20c449797540ebd14fdf4c4ce91dd8e33b64b903ff7d25`，runtime-trees-v2输入SHA-256 `ce8678974c70cfa6d124feed3aa5f17e6f7401f85de0484830af2ba09c441d88`。此为同输入严格覆盖聚合，不伪称一次不中断运行。
- 本轮未跑真实模型/CLI/供应商通知、全站浏览器/IME、独立all-dist安装包或跨平台Runner。任务聊天的本地标题来源只在明确投影边界继承；真实时间线另有三host Group测试，不能只用direct Card证明。tool taxonomy、活动聚合摘要、其它协议字段/称谓消费路径继续列为未扩改，原85需求统计不因词条数增加而改变。发布以远端mimouse完整SHA核对为准。

## 4762键四语界面补全（2026-10-27，已本地验证候选）

- 本轮补齐组织目录/通用设置、production导航、账户/项目壳、正常账号额度与旧订阅回退、Agent/Issue详情。旧有限372候选按源路径分类的98个UI缺口已抽取；另有45已有包装器、19保留标识、210不可达/测试候选（含经典Plan分支1个），不称全站全覆盖。
- schema 3范围扩大到78文件，[4762键报告](checklists/I18N-AUDIT-20261027-4762.json)为278个literal、1862个dynamic位置，source SHA-256 `db401e942b4a7589dc58c54cd7306bd53e9ff3c286cc31c56768800e3ae2ab9f`；不能与旧73文件schema 2直接比较完成率。最终冻结`8126fab167bc5cd3071eafa0d468bdff15683bd6`；4762键合成、token/palette/cliplab/no-git-push及52项Node脚本复验通过（`/tmp/paperclip-4762-scripts.log`）。
- 合并后类型首轮的3处插件夹具字段和1处act回调返回值已修正（08de28ef）；4735快照完整UI类型复验通过（`/tmp/paperclip-4735-ui-types-final.log`）、两文件359项类型修复邻接通过、16文件766项中央通过（`/tmp/paperclip-4735-central-ui.log`，7条既有canvas警告保留）。
- 扩围发现的21个ProviderQuotaCard可达标签及1个ApprovalDetail原生确认已由11be921b/659a5ab6补齐；分别80/80及39/39 focused通过，审批取消零调用/原ID单次确认/pending/error已覆盖，首轮复现失败保留。当前278 literal为213无生产消费者、45已有包装器、20保留标识；1862 dynamic尚未全面判定，不能称全站零漏翻。4762完整UI类型通过（`/tmp/paperclip-4762-ui-types.log`），生产构建4.12秒通过（`/tmp/paperclip-4762-ui-build.log`），保留既有大于500KB chunk及无效dynamic import警告。新inventory的**844文件、85批、11160项完整UI严格聚合通过**；9个新分片、2并行，全部sourceUnchanged=true，零失败/跳过/todo，不沿用4735或旧10792项替代新输入运行。
- 完整UI聚合证据：`test-results/mimouse-ui/aggregate-2026-10-27T16-31-41-086Z-kvwE3O/aggregate.json`；聚合日志`/tmp/paperclip-4762-ui-parallel-aggregate-843e99c7.log`，监督日志`/tmp/paperclip-4762-ui-parallel-supervisor.log`，分片清单`/tmp/paperclip-4762-ui-parallel-manifests.txt`。UI源码SHA-256为`cbdf704756ea97e2446d487e1b31e90efbc5783c17bc720e8a7bc60d1c007e09`；runtime-trees-v2输入SHA-256为`a23b1ba85c2ebb739192f94913599c118c7b48fa4d7131154797869383a70929`。这是同冻结输入完整覆盖的分片聚合，不伪称一次不中断运行或真实浏览器/供应商验收。
- 最终输入server/packages/cli与469e773f差异为0（`/tmp/paperclip-4762-backend-unchanged.log`），沿用48c9c1d0后端构建与164编译API历史证据；本轮未重跑后端，也未声称all-dist或真实外部验证。详见[本轮范围、分类和手测清单](checklists/I18N-CLOSURE-20261027.md)。未确认最终远端前，本段不作已推送声明。

记录起始日期：2026-10-25 UTC。基线为 v2026.1023.0 / 1b4c803816e82b0265c8422e1a804327a7ed8c54。开发分支 mimouse。此记录是可审查候选版的本地证据，不是全部需求完成或生产上线证明。

## 0361公司永久删除依赖修复（2026-10-27，后端限定补丁）

- 冻结实现及实际server构建印章 `48c9c1d0612e08b37c86e9266a18d8730bdcc2b9`。保留既有公司访问/board授权、不可撤销UI确认、公司锁和生命周期行为；不把archive当永久删除，也未删除真实公司。
- 0361在四组既有不可变函数中保持UPDATE拒绝，只为匹配公司ID＋当前xid的内部事务开启DELETE；八表deferred约束要求公司在约束检查时已不存在。仅设置上下文后删receipt/participant而保留公司不能提交。此上下文不是API授权，不是防SQL owner机制；新helper使用锁定后的规范UUID和uuid::text。
- 固定Mimouse/runtime v2/私有结果/审批与反馈/通知/WorkBuddy/evaluation/research依赖顺序；显式语句均限定目标公司，保留邻公司及实例全局行。0360观测回执随delivery级联；普通证据更新/删除保护不放开。既有terminate/schedule外部影响不承诺随SQL回滚。
- 标准server全步骤通过（`/tmp/paperclip-company-delete-server-build.log`），主tsc串行159.1秒、最大RSS4849544KiB。DB标准构建及迁移编号/安全检查通过（`/tmp/paperclip-company-db-build.log`）；已核对dist包含0361与当前journal。安全检查保留20条历史baseline/1条stale提示，未新增豁免。新snapshot与0360 schema完全一致，ID/prevId链正确。
- 标准server配置中央**17项删除专项通过**（routing10＋真实PG7，`/tmp/paperclip-company-central-tests.log`），另**29项观测邻接PG/API通过**（`/tmp/paperclip-company-observation-neighbor.log`）。覆盖完整两公司图、大写UUID、正常/上下文UPDATE拒绝、错公司/旧xid、partial/提前约束失败、晚失败全部SQL回滚、context不泄漏与global行保留。候选首次Unix socket受限未进入测试；保留日志后用既有TCP-only路径正常重跑，未放宽归属保护。
- 新标记隔离数据库的编译server入口完整API **164项通过（1.2分钟）**（`/tmp/paperclip-company-compiled-api.log`）；仍有workspace TS依赖与源码fixture，不是all-dist消费者或真实生产授权验收。
- **本补丁无UI、shared或Drizzle表定义TS变更**，`/tmp/paperclip-company-unchanged-surface.log`为0字节；本批未重跑完整UI或浏览器。上一冻结版本df1c12c2的838文件10792项UI、UI类型/构建属于其历史输入证据，不冒称本SHA重新聚合。后端与迁移已按当前输入独立验证。
- [永久删除验收清单](checklists/COMPANY-PERMANENT-DELETION-20261027.md)记录0361的5秒锁/30秒每语句上限、备份/停写维护、整文件回滚后人工重试，以及真实历史数据、并发、文件/object storage、外部凭据撤销与灾备恢复未证明范围。已修复所复现的旧数据库清理阻断，不代表删除了所有外部副本或穷尽所有历史形状。

## 4578键：评论身份保护、实际草稿恢复与持久构建观测（2026-10-27）

- 冻结实现及实际server构建印章 `0cf14b8716212920e4b6dd1b8d73b30edaad6be5`。本批接通受权精确job观测、0360请求/回执、持久pending journal及显式close-unknown；仍默认关闭，全部admission及既有六目标矩阵保持blocked。签名声明/产物字节观测不证明可信controller、工作流闭包、平台/测试/代码签名或C3。
- 修复两条评论路径在onMutate等待期间导航后误用新任务的问题，以及AgentChat跨公司/agent复用创建Promise的问题；目标/身份/正文/附件/nonce/运行设置在调用前冻结，成功/失败/settled与撤回await后均复核actor，失配不重种旧私有缓存、refetch或用新身份取消旧评论。真实host基线红测及修复后回归保留；实际代码和手测见[评论目标与恢复清单](checklists/COMMENT-TARGET-RECOVERY-20261027.md)。
- 接通真实TaskChatThread→TaskChatComposer恢复句柄，新旧restoreDraft统一boolean：仅安全空稿实际恢复才返回true；保留新正文、附件、忙碌/unknown/排队编辑，不自动发送或重建附件receipt。旧scope/卸载句柄拒绝；撤回反馈不再虚称已恢复。另补评论与Agent概览四语、8种运行状态及数量边界。
- run.failed仍逐条投递；API拒绝不生效的正数合并窗口，UI禁用并如实显示遗留值，须显式归零后按原CAS保存；不自动改历史策略或已有投递。严重程度及现有coding合并合同不变，不能称全事件摘要已实现。
- 主线完整UI类型及生产构建通过（`/tmp/paperclip-4578-ui-types-final.log`、`/tmp/paperclip-4578-ui-build.log`）。首轮类型检查发现测试act回调返回Promise<unknown>，修为显式void回调，不改变生产代码或断言。中央13文件**961项UI定向通过**（`/tmp/paperclip-4578-central-ui.log`），仅保留既有jsdom scrollTo未实现提示；这不是实际浏览器/OS输入法验收。
- shared与DB标准构建通过（`/tmp/paperclip-wired-shared-build.log`、`/tmp/paperclip-wired-db-build.log`），其backend源码与最终冻结一致。标准server全阶段最终通过（`/tmp/paperclip-4578-server-build-final.log`）：主tsc仅串行，141.06秒，最大RSS4838380KiB；未跳过类型/vendor/资源步骤。前次137终止日志`/tmp/paperclip-wired-server-build.log`保留。已停机无PID的临时库和生成缓存完整归档校验，备份从RAM盘迁至磁盘且旧路径保留可读引用；只退役无未提交内容的旧辅助checkout，Git分支/tree与忽略缓存备份均保留，不删除失败证据或PID文件。
- 标准server配置中央8文件**272项后端定向通过**，另独立新库/正常0360迁移的**29项观测数据库/API通过**（`/tmp/paperclip-4578-central-backend.log`、`/tmp/paperclip-4578-central-pg.log`）。覆盖真实持久session/管理员/隐私校验、精确secret版本、DB时钟租约/配额、同ID重放、旧worker fence及close先赢/活lease拒绝/过期关闭；HTTP与签名材料为fixture，没有真实供应商访问。
- 全新标记数据库上的编译server入口完整API **164项通过（1.2分钟）**（`/tmp/paperclip-4578-compiled-api.log`）。仍使用workspace TS依赖与源码fixture，不是独立all-dist包证明。0360由正常Drizzle生成快照、DDL逐项一致且无schema drift；5秒锁/30秒语句上限、升级备份及C3条件见[持久观测清单](checklists/BUILD-OBSERVATION-RECEIPTS-20261027.md)。
- UI pending journal在POST前保存安全selectors并回读；存储拒绝/损坏不降级发送，跨head/session/epoch重挂载优先精确GET原ID，403/404/null不解冻。只有匹配原输入的持久终态才能清理；close为显式本地关闭栅栏，不证明旧请求没发生、也不取消CI。paused可恢复下一待决，但不能新外发；外部清空存储和非跨tab原子性限制如实保留。
- 四语4578键一致，42项脚本及设计/同步/no-git-push/diff门禁通过。73文件审计372字面量候选、1843动态位置，源码摘要 `1e94623fe753b6ae4d8c5d5cad08cecc4148841f5ad8cbca51b65d4f957cc3c7`；不是全站未译数或覆盖率。**新输入完整UI严格聚合通过：838文件、84批、10792项，零失败/跳过/todo。** 9个完整native-v2 manifest恰好覆盖一次、sourceUnchanged=true，不复用4513旧分片。汇总`/tmp/paperclip-4578-ui-parallel-aggregate-361bea64.log`，证据`test-results/mimouse-ui/aggregate-2026-10-27T13-51-27-410Z-aro2gj/aggregate.json`；UI源码SHA-256 `72b880d55cb5175ca108c5c7c3f4b2fe8146dfb2d6e2dbe366fd36373865e93c`，runtime输入SHA-256 `5202a52e807a7a383924644f4bd8822197eb3124da4febd39e954163c0637331`。
- 既有组织永久删除仍有Mimouse旧FK/不可变历史清理债务；0360自身cascade通过不代表完整删除链已修复。该问题作为独立后续代码修复，不归咎于缺少账号，也不建议拿真实公司反复试删。原Git目录环境用例、真实浏览器/供应商、受控Runner与六平台验收继续独立保留。

## 4513键与构建来源观测基础（2026-10-27）

- 当前冻结实现及实际server构建印章 `a68db2c3690a9e79ae0a94cc90b4330396547346`。承接4437键详情反馈/属性/指令，另补实际Agent登录/会话/日志/密钥显隐、任务互动反馈、opt-in列表摘要、附件及排队编辑四语。范围和真实浏览器检查见[新界面清单](checklists/SESSION-COMPOSER-INTERACTIONS-I18N-20261027.md)及[详情清单](checklists/DETAIL-FEEDBACK-INSTRUCTIONS-I18N-20261027.md)。
- 完整UI类型检查及生产构建通过（`/tmp/paperclip-4513-ui-types-final.log`、`/tmp/paperclip-4513-ui-build-final.log`）；首轮类型检查发现测试Element.title类型不精确，改为HTMLSpanElement泛型，未修改生产类型。中央10文件784项定向通过（`/tmp/paperclip-4513-focused-ui.log`）。4437旧源码契约失败保留并修复，不沿用旧全量结果。
- 四语4513键一致；42项Node脚本、设计token、palette/cliplab、no-git-push与diff检查通过。73文件审计399字面量候选/1841动态位置，无缺失；这些不是剩余译文数或全站覆盖率。审计源码摘要 `7f92e5d36772954d5cd9938decf417cde0608113e53973c7e29277fb79b285da`。
- 标准server构建全部阶段通过（`/tmp/paperclip-4513-server-build-cleaned.log`），主TypeScript仅串行，133.36秒、最大RSS4832836KiB；未跳过类型、vendor或资源步骤。shared完整构建通过（`/tmp/paperclip-4513-shared-build.log`）。首次辅助调用缺本地tsc PATH以127退出，补同等本地bin后重跑；第二轮137终止。仅对10个官方pg_controldata确认shut down且无PID的旧probe做完整归档/逐文件校验后释放约335MiB，未删除任何PID/失败证据，最终整链重跑通过。失败日志均保留，不将137武断归因某个源码错误。
- 新独立标记数据库上的编译server入口完整API **163项通过（46.8秒）**（`/tmp/paperclip-4513-compiled-api.log`）。仍使用workspace TS依赖及源码fixture，不是all-dist安装证明，也未连接真实模型/通知/供应商。
- 新构建来源库按DSSE PAE/Ed25519验证in-toto Statement v1/SLSA v1原始字节及当前运维策略；精确GitLab job观测器固定六GET、实际产物哈希/大小、有界流/总期限、前后身份核验。首次独立审查发现JSON数字舍入可能模糊job ID，已在原始词法阶段拒绝并补回归。中央4文件128项通过，标准server配置同组128项也通过（`/tmp/paperclip-4513-build-provenance.log`、`/tmp/paperclip-4513-standard-provenance.log`）。
- 两模块均默认关闭且未接生产路由/DB/台账，测试HTTP与密钥均为隔离fixture。所有观测admission保持blocked；签名声明/字节观测不等于可信controller隔离、工作流闭包、平台/测试或产物代码签名。现有六目标矩阵全部blocked，真实GitLab/C3、当前凭据/运维信任根及持久接线仍未完成；见[构建来源清单](checklists/BUILD-PROVENANCE-OBSERVER-20261027.md)。
- **完整UI新输入严格聚合通过：834文件、84批、10570项，零失败/跳过/todo。** 9个完整native-v2 manifest恰好覆盖一次、sourceUnchanged=true；不复用4437失败轮或4376旧manifest。汇总`/tmp/paperclip-4513-ui-parallel-aggregate-f3d8ae75.log`，证据`test-results/mimouse-ui/aggregate-2026-10-27T12-04-30-516Z-xkKamo/aggregate.json`；UI源码SHA-256 `85304bf26f7db2a6c0b0500b7687c00d4192fd0d37e40d5177ffb09b70500f52`，runtime输入SHA-256 `c26b9b6130e7de89d19dcd525397679bd9054a1a15699dad47c7eac78e6877e9`。真实浏览器IME/剪贴板/窄屏与上一批额外Git目录环境限制仍独立保留。

## 4437键：任务详情反馈、属性状态与指令编辑器（2026-10-27，未单独发布）

- 冻结源 `fb68632df65b07458d6e46219d36e887c7eeb48f`。三片改动位于实际 IssueDetail、IssueProperties 和 AgentDetail PromptsTab；保留属性 canonical 标识、用户正文、路径、revision/hash 与原始服务端错误。恢复事件处理由未消费的 mutateAsync 改为 mutate，继续走既有 onError，不改恢复请求身份或重试政策。
- 完整UI类型检查和生产构建通过（`/tmp/paperclip-4437-ui-types.log`、`/tmp/paperclip-4437-ui-build.log`），保留正常bundle警告。中央5文件467项定向回归通过，未出现未处理拒绝（`/tmp/paperclip-4437-focused-ui-final.log`）。首次中央命令在错误cwd寻找vitest.setup.ts导致5套件零测试失败；改为UI目录使用原配置重跑通过，未改源码或放宽断言。
- 四语4437键一致；42项Node脚本、设计token、palette/cliplab同步、no-git-push与diff门禁通过。73文件审计为467字面量候选、1841动态位置，无缺失实际路径；候选不是未译数量，也不是全站覆盖率。
- 完整UI首轮未通过：74批已有完整通过manifest，第71–80分片在第79批遇到1项旧源码契约失败（该批54通过/1失败，第80批未执行）。`chat-ui-contract`仍要求IssueDetail源码硬编码英文Retry queued；修复7222d8f6同时核验实际翻译调用及原英文资源，保留重试身份断言。2文件186项定向复验通过。失败日志与manifest保留在`run-2026-10-27T11-27-52-945Z-raCu54`；该轮不声称完整通过，也不复用其分片到4513新输入。
- 本批后端源码与4377912b一致（`/tmp/paperclip-4437-backend-unchanged.log`为0字节）。沿用此前后端构建印章ba5b36a9与限定范围374后端/163API证据，不声称本Git SHA重新构建后端。并行的构建来源基础库未合入本批。
- [专项手测清单](checklists/DETAIL-FEEDBACK-INSTRUCTIONS-I18N-20261027.md)列出真实中/日IME、富文本选区、系统剪贴板、窄屏与响应丢失步骤；MDX textarea及剪贴板mock不证明真实浏览器通过。此前Git目录环境限制继续保留。

## 4376键：实际任务输入与运行记录国际化（2026-10-27）

- 冻结源 `c54a4aa9162c0418e0904af99029c5c98b32d832`。补实际模型/effort选择器、组合输入Enter保护、运行记录系统标签/空态、评论未知结果恢复提示；保留模型/品牌/用户原文、草稿、展开/流式身份和未知提交不重放语义。不是全站国际化完成。
- 中央合并后5文件230项定向UI回归通过；完整UI类型及生产构建通过（`/tmp/paperclip-4376-ui-types-final.log`、`/tmp/paperclip-4376-ui-build.log`）。首次类型检查发现两处不完整Agent测试对象强转，已补完整合法DTO而未放宽生产类型，失败日志保留。
- 四语4376键一致；42项Node脚本测试、设计token与diff检查通过。新增审计73文件/21例行精确路径/3实际子组件/5宿主关系，无缺失；522字面量候选、1850动态位置是人工清单，不是未译数量。报告及范围说明在[专项清单](checklists/TASK-CHAT-TRANSCRIPT-I18N-20261027.md)。
- **完整UI：831文件、84批、10301项全部通过**，无失败/跳过/todo；9个完整native-v2 manifest严格聚合、输入未变，没有复用上一批10225项分片。汇总 `/tmp/paperclip-4376-ui-parallel-aggregate-eb758af9.log`，证据 `test-results/mimouse-ui/aggregate-2026-10-27T10-00-59-253Z-5tl5zb/aggregate.json`；UI源码SHA-256 `c8ae97d2bc190a30a0095215da62ee4b4dbe205db32b90bf2aaa04d4a9d60cc9`，runtime输入SHA-256 `0f5e2f61e06ff57c4a6aa76706bf69a690e2f9b3a516d272ea5d0fa117c788fa`。
- 本批仅UI、审计脚本与文档；`/tmp/paperclip-4376-backend-unchanged.log`确认server/shared/DB/adapter/CLI等后端源码与已发布85c5e693完全一致。沿用其实际server印章ba5b36a9及对应374后端/163API证据，不声称在新Git SHA重新构建后端。
- 操作系统IME、真实浏览器窄屏/长日志布局、实际断网及存储权限行为待人工验收；单元夹具通过不等于C3。上一批额外Git工作区环境限制继续保留。

## 4286键与受控成本路由 v2 集成（2026-10-27）

- 冻结实现及实际 server 构建印章：`ba5b36a9e0057dd8f4b2605b27c8583b9c5d197c`。旧 v1 预览仍只读/blocked；新 v2 默认关闭，只支持当前已证明的 builtin Claude 本地、固定公司 API-key、全新无项目任务范围。不是所有 profile、普通工具质量、未来报价或真实供应商费用的证明。
- 候选资格来自每个 Agent 自己的固定集私有运行、实际模型与 CLI 费用出处、中央 usage receipt/cost event 结算及固定精度比较。C2 通过正常私有运行到中央记账生产证据，不手填候选成本行；模型边界只用无网络 Node 替身。未知、缺失、混合模型、版本/上下文漂移拒绝。
- 策略准备/批准、创建公司可见任务、单次运行分别确认。持久绑定、保留唤醒键、活跃运行身份与执行前复验阻止通用唤醒/评论/重试绕过；`start_requested` 只表示启动请求凭据，不是成功或供应商已消费。四语言状态标签和公司内任务详情入口已接入。
- 未知批准通过显式过期关闭恢复；只读回查不依赖浏览器时钟或普通错误猜测。0359 的不可变更新及批准插入锁、数据库时钟、历史回执、幂等审计均有真实 PG 探针；并发探针实际观察自有 backend 的锁阻塞，不只是比较最终报错。
- 成功/失败后的自动恢复被持久身份围栏拦在创建/调度前；旧匹配自动 action 仅取消并审计一次，人工/board 动作保留。普通任务先走无锁负向路径，避免改变原有恢复竞态。新 v2 公司清理依赖顺序已补，绑定 Agent 的物理删除返回明确冲突；旧 DELETE 触发器清理债务仍按专项清单保留。

### 当前验证

- shared/DB 及完整标准 server 构建所有阶段通过，未跳过主类型检查或 vendoring。最终日志 `/tmp/paperclip-routing-final-build-cleaned.log`，主编译 155.24 秒，峰值 4,734,000 KiB。早期多次 SIGKILL/退出137及一次实际 TS 错误记录保留；收窄派发身份、修正测试工厂类型后，串行且安全归档可恢复测试缓存再验证，没有关闭类型检查。
- 相关后端 **21 文件、374 项全部通过**（`/tmp/paperclip-routing-full-backend-final.log`），包括 26 项真实 PostgreSQL 私有/路由集成及独立应用/回退用例。实现源码与最终构建一致，后续差异只在文档。正式迁移从历史0357检查点进入0358/0359，完整目录358个迁移当前；旧 journal 项未改写。
- 编译入口完整 `test:mimouse:api` 清单 **163 项通过，1.1分钟**（`/tmp/paperclip-routing-final-compiled-api.log`）。入口是编译后的 server，但工作区包仍有 TS exports 和源码 fixtures；不是独立 all-dist 安装证明。
- UI 完整类型检查、生产构建通过（`/tmp/paperclip-routing-4286-ui-types-serial.log`、`/tmp/paperclip-routing-4286-ui-build.log`）；4286键四语一致，1308文件设计 token 门禁、palette/cliplab 同步、no-git-push 通过；37项 Node 脚本检查通过。没有把词条数当页面覆盖率。
- **完整 UI：829文件、83批、10225项全部通过**，无失败/跳过/todo。9个完整native-v2 manifest、两条串行通道严格聚合，全部sourceUnchanged=true；没有复用4198键旧分片，也不是一次不间断进程。汇总 `/tmp/paperclip-routing-v2-ui-parallel-aggregate-9c0a829d.log`；证据 `test-results/mimouse-ui/aggregate-2026-10-27T09-16-35-567Z-lVsYhY/aggregate.json`。UI源码 SHA-256 `0b5c1797b76b22bb4527ed0e2c3d08677517379639dbb7cc35c72b0fbbdd581e`，runtime输入 SHA-256 `51488419aedeef771eb17c0b4a8cffbcfcb8c409b918284ea01f2bd7b4f43ae7`。

### 失败记录与额外限制

- 首轮链路依次暴露：夹具缺显式 `agents:configure` 授权、原始 SQL Date 参数编码、合法启动前 checkout 阶段被过严拒绝、使用非权威缓存字段模拟预算。分别补真实授权夹具、ISO 参数、精确活跃运行阶段判断、正式预算策略及已结算支出/保留检查；没有放宽生产授权或虚构候选费用。
- C2 初次全通过后，独立复核发现成功运行的自动恢复 action 会在 attempt0 反复被队列拒绝；已修正创建/扫描入口，并补旧 action 一次取消、重复扫描不变及人工动作保留证明。
- 扩展相邻核心回归曾 **762通过/4失败（766项、17文件）**；两项时序症状在单独复验通过，一项普通恢复锁竞争经本次修复通过；最后四例定向复跑为 **3通过/1失败，另396项因筛选未运行**。剩余 local-path 分类用例受本机只读 Git 祖先标记和文件系统边界错误格式影响，详见[专项清单](checklists/CONTROLLED-COST-ROUTING-V2.md#额外兼容性回归本机-git-工作区限制)。未把不同快照/定向结果拼成当前766项全绿。
- 相邻测试早期两次启动配置不完整，已中断且不计通过；随后使用项目标准 setup、隔离虚构认证夹具运行，没有调用真实 Codex 或模型。一次并发 UI 类型检查受资源限制退出137，最终串行重跑通过。
- 本批真实浏览器布局、操作系统 IME、真实 CLI/模型/账号/费用及生产升级仍由手测清单验收；不沿用上一批浏览器结果作为本批已实测。没有真实通知、MR、发布、合并或部署操作。

## 4198键、例行界面与编码目标最终集成（2026-10-27 05:06 UTC）

- UI冻结源 `5ff8b0dc27985500cf8ea9382102233932368615`。补两套路由、触发器/活动/列表、共享文件夹/环境变量/关闭标签四语，及九项仅计划编码目标；保留原始用户数据、未知诊断、秘密/URL/命令和既有执行门禁。目标用既有版本化任务文档，无数据库迁移；当前成员/私有祖先权限、修订CAS与审计事务已有实际PG/HTTP验证。
- **完整UI：826文件、83批、10160项全部通过，零失败/跳过/todo，全部输入未变。** 两条串行测试通道并行，9个完整native-v2 manifest严格聚合，逐项核验文件/断言库存、精确排除、日志/报告哈希及唯一覆盖，不是一次不间断大进程。汇总 `/tmp/paperclip-4198-ui-parallel-aggregate-b18ab85a.log`；证据 `test-results/mimouse-ui/aggregate-2026-10-27T04-56-01-824Z-7k61sP/aggregate.json`。UI source SHA-256 `e4d6f4eef3461cdcd8423cf3a235b1d4c6b3110521c30524815661ffb771dc82`；runtime输入 SHA-256 `253cdcfb55f1f0dd873c587a528bce31e7cfd4221605b298136559cf7490b4ec`。
- 完整UI类型及生产构建通过（`/tmp/paperclip-4198-ui-types.log`、`/tmp/paperclip-4198-ui-build.log`）。先前新活动/环境草稿fixture有不完整DTO及字面量推宽，分别补完整字段和精确返回类型；没有扩大产品类型或跳过检查。资源4198键四语、1306文件token门禁、palette/cliplab同步、no-git-push及37项Node脚本测试通过。
- shared/DB构建及完整标准server构建通过，实际server印章 **b2380f074b06bb65f7b4e8accea2817c932f755e**。最后短词修复仅UI/审计/文档：git diff确认server、shared、DB、adapter/adapter-utils、external-adapters、CLI源码与该已验构建完全一致（`/tmp/paperclip-4198-backend-unchanged.log`），未伪造最新Git印章。后端完整API **163项通过（1.1分钟）**：`/tmp/paperclip-4197-compiled-api.log`，其中新增目标模板真实PG/HTTP事务用例；另35项目标shared/service测试通过。编译入口仍有workspace TS依赖及源码fixtures，不是独立all-dist安装。
- 首轮4197完整UI曾826文件10152项通过；随后真实浏览器发现两字母`in`漏译。新增回归先6失败/2通过，再修复，最终4198整套重新执行，**没有复用4197的分片充当新输入通过**。审计扩为70个明确文件、21个精确路由相关路径；501字面量候选/1664动态位置是人工审查清单，不是未译总数或覆盖率；共享dialog/sheet和非TSX诊断映射另有人工复核。
- IME/pending测试先红后绿：文件夹组合键误提交/保存中回车，以及环境变量组合键/同批重复创建被复现并修复。portaled创建按钮的翻译影响草稿flush也有红绿证明。RoutineSaveBar两语义标记则是契约加固：原默认submit路径在四语基线16项已经通过，未将被反证的“丢草稿”疑点写成修复成果。真实操作系统IME仍待手测。
- 浏览器实际四语目标草稿、一次保存、刷新/服务重启同版本读取、例行界面打开/取消及最终短词复核通过，范围和0执行回执见[浏览器记录](checklists/ROUTINES-GOAL-BROWSER-20261027.md)。不把该受控环境当真实Casdoor、模型/通知/Runner、全站或全平台验收。
- 后端编译初次因内存被杀，逐阶段日志保留；可恢复生成缓存/公共registry元数据/Node头文件先归档逐字节验证后释放tmpfs，再完成全部标准构建阶段。未删旧PG锁/数据或MiWork恢复文件。Rust/Vite既有警告保留，非通过失败检查改绿。

## 自动重试截止与令牌缓存复验（2026-10-27 03:04 UTC）

- 应用/server构建印章 `c6ba2b4ea82b749771de1bc278745977b37215ca`。支持初始专用运行和逐边核验的 bounded/missing-comment 自动重试共享原截止时间；持久精确停止目标，准入与完成/到期对账互斥。人工/异公司/合流/伪造后继不取得停止权限；未支持的自动恢复通道保守拒绝。仍不声称严格墙钟、全部进程后代或远端供应商已停止。
- 中央定向8文件151项全部通过、无跳过（`/tmp/paperclip-retry-lineage-final-focused.log`），含真实PostgreSQL runtime-selection/retries。此前6文件132项通过、17项因默认夹具支持探测被跳过，保留初次记录；新增显式 `PAPERCLIP_TEST_POSTGRES_TCP_ONLY=1` 仅配置测试进程回环TCP/关闭Unix套接字并绕过模板缓存，默认/认证/生产配置不变，后续17项实际运行通过。DB类型检查及14项夹具单测通过；6项正常socket模板缓存集成未在TCP-only模式执行。
- 标准server构建所有阶段通过（`/tmp/paperclip-retry-token-tcp-final-build.log`）：runner/eval准备、依赖检查、完整TypeScript检查与emit、资源复制及构建印章。仅主编译串行；未跳过类型或校验步骤。主编译峰值RSS约4.50GiB。之前内存不足的SIGKILL记录保留；逐阶段记录证明并非eval构建失败。生成型tsx/Playwright/Vite缓存先归档逐文件校验，再释放tmpfs内存；未删除失败测试库、锁文件或项目恢复文件。
- 新独立标记数据库上编译入口完整API **162项通过（1.1分钟）**，日志 `/tmp/paperclip-retry-token-final-api.log`。含14项编码修复测试：真实两级重试、到期拒绝、未知停止重启、伪造/合流隔离及与完成/到期对账竞争的数据库锁证明。仍有workspace TS依赖和源服务fixtures，不是独立all-dist安装；未执行真实供应商、模型、收费或通知。
- 首轮完整API160通过/1失败（`/tmp/paperclip-retry-lineage-compiled-api.log`）：新通知令牌的数据库微秒默认时间与JS毫秒比较导致误报token_refresh_busy。冻结时钟用例先红后绿；仅新行设置立即可刷新时间，既有冷却/租约/身份/秘密版本均不变。29项令牌单测通过；新增数据库回归在应用时钟落后5秒时验证新/轮换行及已有冷却，纳入最终162项。
- 本轮无UI源码变化；前一轮814文件9848项只证明其原冻结输入，未重新跑本轮全UI或浏览器。供应商C3/C4及其它原计划缺口仍按追踪矩阵；推送/CI另以远端实际SHA核对，不由本地通过推断。

## 3815键待发布候选复验（2026-10-27 01:59 UTC，完整UI聚合通过）

- 当前HEAD为 `2a85e074b10dc19e83a5dd84f33cb22f4b9b1075`；业务代码及server构建印章冻结于 `491a6b2c36cd373bed179c8cf64ef2b99e96d01b`。后续提交修复UI分批runner的精确文件选择与排除证据核验，不改变应用代码。最后已核实远端为 `5c11913a78635f4683034627b8d026bc2943c2eb`；本候选尚未推送，不称远端CI已通过。
- server标准构建（包含类型检查、runner/eval vendor校验与资源复制）、UI完整类型及3815键生产构建通过，日志分别为 `/tmp/paperclip-3815-server-build-final.log`、`/tmp/paperclip-3815-ui-types-final.log`、`/tmp/paperclip-3815-ui-build-final.log`。Rust既有7项警告、Vite大chunk/动态导入提示保留；不是根命令一次全工作区通过或本版本all-dist安装验收。
- 提示词专项10文件153项通过（`/tmp/paperclip-final-prompt-suite-paused.log`），包括公司暂停后的应用元数据读取/未来绑定撤回与运行拒绝；受控运行使用无网络Node替身，不证明真实Claude CLI、工具效果或账单。编译server入口完整API158项通过（44.9秒，`/tmp/paperclip-3815-compiled-final.log`）；仍有workspace TS依赖及源码fixtures，不是独立npm全dist验收。此前23:42的source API158项保留为其历史快照，不直接迁移为此业务SHA的完整源码API结果。
- **完整UI严格聚合通过：814文件、82批、9848项，零失败/跳过/todo，sourceUnchanged=true。** 初次runner因Vitest子串选择多跑同名前缀文件而被严格库存拒绝，修复选集后重跑；环境恢复中断的21–30整片全部重跑，未完成分片及旧runner结果不计入聚合。9个完整manifest覆盖恰好一次，验证报告/日志哈希与全部输入不变。汇总 `/tmp/paperclip-3815-exact-ui-aggregate.log`；证据 `test-results/mimouse-ui/aggregate-2026-10-27T01-58-53-021Z-WjPCGC/aggregate.json`；UI source SHA-256 `2e9ccd85a409667215ed568946a5356f0d442b13808ce861c8a89b2be0c2791f`，verificationInputs SHA-256 `52f9abe5a0f3ff94d0304bcd451a2fe11842e0f579d2e63b3924d90a24a1de06`。这不是全站浏览器或真实供应商通过。
- 3815键真实Chrome只读检查验证受控应用四语说明、禁用准备及刷新、既有未分配任务监控属性的打开/取消；11类业务表前后规范快照一致，应用提案/head/审批/派发均0。仅对应[只读浏览器记录](checklists/APPLICATION-READONLY-BROWSER-20261027.md)，不覆盖批准/回退、真实输入法、移动端或供应商。已核实的本次API进程SIGTERM后HTTP关闭、调度器与embedded PostgreSQL停止，postmaster.pid消失；不外推为任意SIGINT进程组隔离已解决。

下文均为各自时间点的历史结果；“未实现/待集成”等描述只代表当时状态，当前实现范围以本节、[追踪矩阵](PLAN-TRACEABILITY.md)和[剩余项](REMAINING.md)为准，不改写历史通过/失败证据。

## 3488键任务恢复界面窄补齐（2026-10-26 21:24 UTC）

实际任务卡片及RunWorkspaceRecoverySurface的状态、标题、重试说明、元数据、空负责人、安全确认、ARIA与本地toast已四语化。保留真实Agent/用户/分支/SHA/路径、服务端诊断、用户nextAction和操作理由；reissue持久化title/description与API payload不随locale改变。动态标题跟随语言重新计算，已有toast保持创建时语言，日期显示不改变重试时序判定。

中央实际locale合成3488键，通过一致性检查；卡片/运行宿主/IssueChatThread等6文件249项通过，完整UI类型和生产构建通过。独立审计与149项工作区轻测仅作补充，不替代中央证据。未为本小片重新执行全UI或真实恢复操作；下文3312阶段801文件9396项只代表其冻结源码。手测清单见[恢复卡片核验](../plans/2026-10-26-issue-recovery-card-i18n-verification.md)。普通提示词运行态应用的语义/可见范围尚待确定，见[边界说明](../plans/2026-10-26-p5-runtime-application-boundaries.md)，没有自动激活普通Agent。

## 3312键恢复与只读比较集成（2026-10-26 21:04 UTC）

代码/server印章 `0cd351c41f760a56ee8f1b2b2e63b630b9f6c634`。已合入UUID语义绑定与仅元数据准备显式放弃、私有历史双版本只读比较、13种阻断码四语说明。保持未知收费journal、当前权限、固定历史上下文和未知成本失败关闭；普通runtime应用/回退、成本路由仍未完成。

完整私有suite5文件80项通过，无跳过（`/tmp/paperclip-comparison-private-frozen.log`）；相邻UI7文件168项通过（`/tmp/paperclip-3312-ui-focused.log`）。shared、adapter-utils、Claude标准构建通过；完整UI类型/生产构建、server标准构建（包含完整类型）通过。server首次noEmit发现测试写了不存在的api_key actor来源，已修为与agent角色匹配的agent_key，未放宽生产类型/权限；之后标准build覆盖通过。初失败日志保留。

source API145项（50.9秒）及编译server入口同套145项（1.0分钟）通过，日志 `/tmp/paperclip-3312-source-api.log`、`/tmp/paperclip-3312-compiled-api.log`；编译入口仍有workspace TS依赖及source fixtures，不是全dist安装验收。

实际Chrome验证错误引用422→显式本地放弃→大写UUID新准备→取消，无真实执行；另以明确合成历史验证未知费用阻断、合成已知费用/预算上下限、四语、真实请求撤权403清空与恢复、比较领域数据不变，见[浏览器记录](checklists/PRIVATE-COMPARISON-BROWSER-20261026.md)。合成run/账本不算真实模型或计费证据。

21:05 UTC当前冻结源码的严格分片聚合已通过：801文件、81批、9396项，0失败/跳过/todo；9个完整分片恰好覆盖库存。证据 `test-results/mimouse-ui/aggregate-2026-10-26T21-05-27-177Z-JM49j4/aggregate.json`；verificationInputs SHA-256 `79fcacfa45dbb05e693d88eba165a74c4b3f8138e2e416d84e0b6db42d6a4a35`，UI source SHA-256 `755dbdb2022524010d9cc2b097273ddab173142df23569bccdc48e5e3c0b4cc5`。这是同输入分片聚合，不是单次无中断全跑。下方799/9317项保留为旧94c7c51版本历史。

## 3260键私有试运行中央进展（2026-10-26 19:58 UTC）

代码及server标准构建印章 `94c7c51ad65579480ed8da1a3d42acf25444b700`。shared/DB构建、迁移安全检查、schema snapshot drift通过；server完整类型及标准构建、UI完整类型/生产构建通过。0357正式迁移下42项（含真实重复键整文件/journal回滚、原数据保留、重迁移成功）、adapter与既有registry路由20项通过。UI最终定向5文件89项通过。

初轮UI类型检查发现witness必需runtimeConfigHash被当可选，已收紧解析并增加7个坏摘要负例；复验又发现测试把严格record强转任意索引对象，改为独立对象副本而不放宽生产类型。最终完整类型/构建通过，初次失败日志保留。正式迁移安全gate最初阻止大表非并发索引，现保留原子事务并按明确维护窗口/5秒锁等待/每语句120秒限制处理，精确例外经独立审核，不是静默忽略。

source API145项（50.6秒）与编译server入口同套145项（48.1秒）通过；编译入口仍为workspace TS依赖且部分fixture直接导入源码，不是all-dist安装证明。日志 `/tmp/paperclip-private-source-api.log`、`/tmp/paperclip-private-compiled-api.log`。

实际Chrome完成准备→整页刷新恢复同票据→四语切换→原子取消→刷新历史；无真实模型调用，前后DB运行/唤醒/执行授权均0，详见[浏览器记录](checklists/PRIVATE-PROMPT-BROWSER-20261026.md)。20:15 UTC新版分段UI严格聚合通过：799文件、80批、9317项，无失败/skip/todo，8个完整分片覆盖库存恰好一次。证据 `test-results/mimouse-ui/aggregate-2026-10-26T20-15-38-055Z-7Imr4z/aggregate.json`；verificationInputs SHA-256 `ec602e0ed6a536644a532fe4b4c9fec7413059b63ab1b41dddbcdc6f211dc5b1`，UI source SHA-256 `91d21e56184affd2e4b6619f4008695e5c40789b540dd964431f18be9fcbbc25`。这是同输入分片聚合，不是一次无中断调用；后续UUID恢复及私有比较改动须重新验证，不能外推该结果。私有试运行不解锁普通运行时应用、提示词双版本评分或成本路由。

## 3197键 self 与无负责人占位语（2026-10-26 19:33 UTC）

实际IssueDetail以currentUserId构造的系统self选项已四语化并保留Me搜索别名；真正无负责人按空身份选择通顺通用占位语，standard/ask/planning与mobile/desktop均覆盖。真实名为Me、Unassigned、未分配的用户/Agent不按字符串替换，原ID与提交payload不变。

中央专项3文件115项通过，3197键四语合成检查、完整UI类型和生产构建通过。初轮类型检查发现新测试把null直接传给string|undefined prop，已按真实合同映射undefined后完整重跑通过，未放宽生产类型或删除断言。日志 `/tmp/paperclip-3197-central-tests.log`、`/tmp/paperclip-3197-types.log`（原失败）、`/tmp/paperclip-3197-types-recheck.log`、`/tmp/paperclip-3197-build.log`。本轮未做新的真实Chrome/IME/窄屏验证，未重跑全UI，不沿用3186全量结果。

## UI 分段验证工具 v2（2026-10-26 19:27 UTC）

新增显式批次范围与严格聚合，解决长测试会话中断后无法可靠续验的问题。说明及命令见 [分段验证指南](../mimouse-ui-verification.md)。原生 v2 记录相关源码/配置/依赖清单摘要及每批实际 Vitest JSON 报告；缺批、重复、漂移、跳过、未完成或失败均拒绝全量通过。历史 v1 记录不自动转换，不覆盖旧日志。

工具自身 Node 测试14项通过（中央复跑 `/tmp/paperclip-ui-runner-central.log`）；真实批次80:80为5文件36断言通过，输入摘要前后一致，证据 `test-results/mimouse-ui/run-2026-10-26T19-26-04-534Z-geZhRY/manifest.json`。仅提供这一分片的聚合正确返回非零、提示缺少79批。本次库存795文件，不是全量复跑；下述794文件9222项仍只属于3186键冻结版本。

## 3193键聊天输入栏窄修（2026-10-26 18:21 UTC）

真实截图发现的默认“No assignee”可见英文已由8414ce7修复，两实际composer分支使用四语系统标签；InlineEntitySelector可选noneSearchText只为该空项补原英文搜索兼容，未传时保留原行为，不翻译用户名称或修改模型/发送键/回调。

中央完整UI类型、生产构建、3193键合成检查通过；6文件347项相关回归通过。首轮346通过1失败为新测试仅等待一个零延时tick，React Query目录尚未通知，读到了模型ID回退；8b650fd改为有界等待实际可见目录标签，保持全部原断言与生产代码，之后完整6文件重跑通过。原失败日志保留。

真实Chrome在同一MIM-1无Agent夹具中确认输入栏实际显示“无负责人”（不仅aria），中文/原英文“No assignee”查询均找到同一中文空项，Escape正常关闭；未发送消息、未分配Agent。其它语种/另一分支由定向测试覆盖，真实IME/窄屏未验。本小片不沿用3186的9222项为新SHA完整回归；后端未变，上一轮server/API证据仅按其原SHA保留。

## 3186键完整文件集的分批聚合结果（2026-10-26 17:31 UTC）

应用 `e39d0d4bdb300b10c1d75b20a03db538a8bd8eca` 的794个UI测试文件、80批合计9222项通过，无失败/跳过/todo。固定源码摘要 `75de3624cd17497badc235b23b921bfca27cc314575f6d3fca83dbd5dcb02e4c`，初始/补跑文件清单完全一致且无遗漏/重复，补跑前后源码摘要未变。

必须保留的执行区别：原会话在前75批通过后中断，初始manifest仍是未完成，不能称原命令正常完成。第76批只留启动日志、没有可推断的退出结果。原记录 `test-results/mimouse-ui/2026-10-26T16-56-24-695Z-1045` 未覆盖；剩余44文件在同一冻结源码下按原5批使用Node直接启动同一Vitest CLI（单worker/forks/512MB）全部通过，记录在 `test-results/mimouse-ui/2026-10-26T17-29-03-369Z-continuation`，aggregate.json核对全794文件覆盖。因此本节是完整文件集的分批聚合通过，不是假造单次无中断运行。

## 3186键与根关停协调集成（2026-10-26 17:18 UTC）

OAuth明确本地拒绝、远程MCP状态/表单/管理确认、任务属性关系选择器及侧栏文案已整合；系统“无项目”增加当前译文搜索并保留原英文，ID/写入语义不变。四语3186键、完整UI类型/生产构建、17文件582项中央定向通过。根关停共享工作/重复信号与失败最终清理2文件38项通过，含真实单Node子进程POSIX信号，不等同真实PG信号隔离。

server完整类型、标准构建通过，stamp `e39d0d4bdb300b10c1d75b20a03db538a8bd8eca`；source API145项（46.8秒）、编译server启动下同套145项（44.4秒）通过。编译入口边界仍为workspace TS依赖且部分fixture源码导入，不是all-dist安装证明。完整UI文件集随后分批聚合9222项通过，执行中断与补跑边界见上节。

真实Chrome任务属性四语搜索、清空字段及零执行DB核对已通过，见 [局部记录](checklists/ISSUE-PROPERTIES-BROWSER-20261026.md)。连续两次原生Ctrl+C后最终清理只有一轮，但PG先退出导致的drain错误保留；没有把本片写成完整优雅退出修复。

## 3048键最终冻结验收（2026-10-26 16:28 UTC）

应用代码 `90797308fd29e253f207b011eb89ed5a203614cf`：789文件、79批、9137项完整UI全部通过，无失败/跳过/todo，sourceUnchanged=true。源码摘要 `e997b18ee1bfadf244db87d3e066d878f060858e8411966edf41cf48cc57b0da`，清单 `test-results/mimouse-ui/2026-10-26T16-05-25-453Z-26/manifest.json`。

server/UI完整类型、shared/DB/server标准构建、UI生产构建、迁移安全和资源门禁通过；source API145项及编译server启动下同套145项通过。实际覆盖边界、首次失败与串行修复见下文。真实Chrome局部验证与数据库回执也已完成，不代替外部供应商或全部页面/平台验收；原计划仍有REMAINING所列缺口。

## 3048键真实浏览器局部验收（2026-10-26 16:22 UTC）

同一9079730应用通过云端真实Chrome+隔离OIDC会话验证：新组织无需Agent直接进入Dashboard，反馈预览四语切换、精确审核/加入草稿/冻结、刷新恢复，通知验证四语、取消零写、明确blocked声明保存及刷新恢复。独立DB核对数据集及其审计各一条、声明及其审计各一条；Agent/heartbeat/通知投递/订阅均为零，来源仍隔离/未复现，通知仍非机器认证。详情与限制见 [浏览器记录](checklists/NOTIFICATION-LINEAGE-BROWSER-20261026.md)。随后完整UI9137项通过，仍不将局部浏览器结果当全站验收。

## 3048键及通知/反馈来源链集成检查（2026-10-26 15:49 UTC）

中央集成通知验证、反馈来源链、连接完成页和OAuth本地错误显示，合成3048键。shared标准构建、迁移生成/安全检查通过；0356仅新增验证列/check/index及四组函数/触发器，journal原354条前缀逐项保持，未删除历史snapshot。

全新隔离PostgreSQL应用全部迁移后，通知验证10项与evaluation10项合计20项通过（18.9秒），覆盖真实并发CAS、两FK锁环、凭据代次ABA、审计回滚、反馈输入变更409、公司隔离和旧数据集哈希兼容。首次为19通过1失败：直接挂载router的匿名断言错误预期401，按既有assertBoard403修正，且补GET/POST拒绝及零新增断言后新空库重跑通过。失败日志保留，不改变生产权限迎合测试。

中央通知server/shared最终6文件85项及UI10文件340项通过；缺失review另有422且零写断言。UI完整类型与生产构建通过。source API全集145项在新空库通过（1.6分钟），对应应用32833c2。UI类型首轮发现测试计时器Node/DOM签名混用，窄化测试Window后通过；server类型首轮发现review可空，改为显式拒绝，未使用非空断言。随后server类型与完整API并行导致类型进程SIGKILL，保留日志并改为串行复验，不把资源失败当通过。server完整类型已串行复验通过；DB与server标准构建通过，build stamp为90797308fd29e253f207b011eb89ed5a203614cf；编译server入口启动下同套API145项通过（45.4秒），仍用workspace TS依赖，部分fixture直接导入服务源码，不是all-dist全链路145项。新全UI随后9137项通过；本节不沿用前一2924键9065项结果，也不把隔离fixture当真实供应商证明。

## 2924键最终完整回归（2026-10-26 15:44 UTC）

应用代码 `0346fee6c88c97382c000ca30981759dca620cec`：785文件、79批、9065项全部通过，无失败/跳过/todo，sourceUnchanged=true。源码摘要 `c95867fefc205096d8942ec80a8dceec1a154ae3bec569d9d583c984301e8b46`，清单 `test-results/mimouse-ui/2026-10-26T15-20-47-936Z-56/manifest.json`。首轮失败与修复经过保留在下节；第67批由1失败/117通过变为126通过，含新增8项修复设置回归。

完整UI类型、生产构建、2924键四语合成检查也通过。本段不覆盖随后通知验证、反馈来源链或OAuth新切片，不等于真实供应商、浏览器布局或全部原计划已验收。

## 2924键完整回归首轮及夹具修正（2026-10-26 14:36 UTC）

高级连接身份/范围摘要已合入，2924键完整UI类型、生产构建、7文件275项定向及资源门禁通过；身份/授权值、URL和请求未改变，原生权限/越权及布局仍待用户实测。

应用 `45a234e289b14fd5a8177a61bc69f2be6368bcc3` 的全UI首轮：785文件79批，9056项通过、1项失败（包含失败批次内117项通过；早期汇总漏计该部分，已按逐批日志更正）；sourceUnchanged=true，摘要 `b6bd6991cc3c97fafbe2acc6f1c435708546b65d2b03751497c6001d4f1aad04`。失败为第67批 MimouseCodingRepair.test 的父页owner切换用例，旧夹具只mock api.get，未跟上父页独立requestResponse读取，导致未找到修复按钮。原日志保留在 `test-results/mimouse-ui/2026-10-26T13-49-54-773Z-82`，不计整套通过。

`0a5bba8` 修正夹具为真实客户端+fetch响应，使用明确session及独立no-store/AbortSignal断言，保留清草稿/不提交约束；该文件8项、原失败整批10文件118项及完整UI类型复验通过。未跳过或删除用例，仍需最终完整复跑。

邻接审查发现 Repair 子面板的重查/拒绝后旧确认状态需要收口，已由 `0346fee` 修复：按 session/auth epoch 隔离私有读取，重查、错误和离线暂停均隐藏旧候选并清除确认，重新打开也需重新确认。6文件74项定向、完整UI类型和生产构建通过；最终全UI正在重新执行。父页与后端已有admin及issue ACL，不把此状态问题错误称作已证实跨owner授权绕过。

## 2875键与业务入口补齐（2026-10-26 13:33 UTC）

应用界面 `28dd14182e0c3aed1fa653eb404de638070623d0`：完整UI类型、生产构建、32文件717项中央定向回归及资源/token门禁通过。新增管理/费用/审批、Agent详情与共享连接登录、两套例行任务的四语显示，保持名称、ID、协议、金额、时区及权限/请求值。已显示的本地错误按描述符随语言切换，外部诊断原样保留；已弹toast仍按触发时语言。2875键不是覆盖率，仍有权限摘要和其他深层文案残余。

§5.4退出提示已实现：仅明确本地success:true后保存非秘密状态，保留可信IdP顶层跳转和Cloud路径；独立fresh-session epoch阻止暖缓存/迟到响应误清提示。IdP浏览器错误页不能显示本站内容，返回本站后显示全局未确认；不把回跳参数当成功，URL/token不入存储。真实Casdoor手测另列。

本地产物清单创建UI已实现，明确固定SHA、相对路径、替换manifest/审阅失效/可能排队已配置通知。现有API没有请求幂等键或manifest版本CAS，仍有SHA检查；UI按身份/SHA隔离，用操作token保守保留未知结果，不自动重发。列表和Diff私有读取不进入URL合并池，失权/重查隐藏旧数据。不新增构建/签名/上传能力。

此前2354键全UI8665项仅对应历史冻结源码；本段新界面的全量回归还未完成，不能沿用。类型检查曾发现新测试全局属性缺声明，作者补类型后中央通过，原失败日志保留。PG/server构建与132项接口证据仍对应6bee5bc，本段无后端变更。

## 原计划复核与2504键补漏批次（2026-10-26 12:50 UTC）

原计划逐项追踪已整理为 [PLAN-TRACEABILITY](PLAN-TRACEABILITY.md)：85个稳定需求ID、13组后续手测，明确实现缺口、实际账号/环境条件及原文不要求的扩展；旧CSV重复编号和过期入口已校正。并未宣称原计划全部完成。

前一2354键界面完整回归已结束：770文件、77批、8665项全过，零失败/跳过/todo，源码未变，摘要 `979d17c84647f5bd050bc5f8695334623d0e09d96c10b0aeff93214026530db5`，清单 `test-results/mimouse-ui/2026-10-26T11-43-11-012Z-19/manifest.json`。该结果覆盖初始化改动，不覆盖随后本段补漏。

本批应用界面 `2f1b0a7` 合成2504键：双侧栏、任务创建/属性选择器与Agent创建四文件首片接入四语；MarkdownEditor和InlineEntitySelector补组合输入/229保护，未改变普通按键语义。中央完整UI类型、生产构建、资源/token门禁通过；核心任务四文件235项、Agent设置三文件113项、IME两文件69项通过。原类型检查先后发现测试act返回Promise<unknown>与登录intent fixture类型不符，修正测试合同后复验通过，没有放宽生产类型；原失败日志保留。真实OS输入法和全路径四语布局仍待用户验收，当前新全UI尚未重复。

服务端 `6bee5bcc150c74f2eabfc67cbc42c5064c827d6a` 的完整类型及标准构建通过，编译server入口132项通过（44.1秒）；supervisor/shutdown两文件27项通过。原生Ctrl-C复验不再触发恢复，最终PG pid消失且终端返回shell，但DB先受终端信号退出仍导致best-effort清理错误、5秒HTTP drain和约18秒总退出，不能宣称完整优雅关停。详见 [退出限制](../security/embedded-shutdown-recovery.md)。编译入口仍使用workspace TS依赖loader，不是新全dist安装证明。

退出提示、产物manifest入口及更深共享Agent/管理控件仍在独立切片推进，未完成部分继续见总表；供应商C3/C4和真实Runner/上传/业务写入合同并未由本次测试补齐。

## 主界面优先初始化增量（2026-10-26 11:42 UTC）

应用 `02aa56f1f9af8db26854678cb24031a371ea2864` 已移除无组织/零智能体自动引导，组织创建后直接进入主界面，显式配置可稍后退出；不自动创建Agent、项目、初始任务或运行。两套shell均处理，认证/邀请/Cloud创建边界保留。

中央13文件234项定向复验、UI完整类型/生产构建、2354键四语和token门禁通过。保留原始旧断言/夹具失败及jsdom scrollTo/canvas警告；独立审查修复新组织缓存导航竞态、同公司重开晚到任务结果、旧草稿干扰新组织及身份切换/后台刷新重试问题。

原生Chrome全新隔离实例已通过欢迎页、取消、首个组织直接Dashboard、零智能体刷新不强制配置、主动配置后跳过、任务浏览、直接onboarding启动卡及第二个组织正确导航。真实DB核对只新增两个人工测试组织，agents/issues/heartbeat_runs均0。详见 [浏览器记录](checklists/OPTIONAL-ONBOARDING-BROWSER-20261026.md)。退出时出现PG短暂恢复和HTTP drain警告，保留并单独排查，不虚报无警告关闭。

2354键完整UI随后已通过，详见本文件12:50 UTC记录；此前2341键8637项仍只对应其历史快照。此增量仅改变前端及文档，server编译/132项接口证据仍对应前述server源码快照，未连接真实供应商。

## 2341键完整UI回归结束（2026-10-26 11:22 UTC）

已发布远端 `16be872f2cd87cde0d37a260a1335722e0300ec2`，应用界面提交 `64127d174dba40744af62a1b2b3e3894959f8008`：2341键冻结快照的 **766文件、77批、8637项全部通过**，零失败/跳过/todo，sourceUnchanged=true。源码摘要 `17b9345764999c19568dbb9d4f7658afefc79b02013bf4cd03f4089abdd9dd9a`；清单 `test-results/mimouse-ui/2026-10-26T10-59-41-661Z-18/manifest.json`。精确远端资源CI40311713019成功。

该结果包含企微管理界面、422明确拒绝/状态四语以及反馈同用户新会话隔离，不是仅定向用例。初始化流程“先进入主界面、稍后配置智能体”的新改动仍在独立分支开发/审查，尚未包含在本快照；不能把8637项套用于随后引导改动。真实企微租户、真实供应商及新全dist安装仍未执行。

## 2286键全量UI与后续管理界面（2026-10-26 10:57 UTC）

远端 `ce180cfd20c045aca9cd219865e23685af22e6a5` 对应的2286键冻结快照：**763文件、77批、8606项通过**，零失败/跳过/todo，源码未变。源码摘要 `4c0257fcfcd3db838d3f1908f3273750f491ae62106b8695d5027051618f462e`；清单 `test-results/mimouse-ui/2026-10-26T10-36-36-662Z-18/manifest.json`。该远端资源CI40309103635成功。

随后集成2341键企微管理面板：仅禁用注册、公司凭据固定数字版本、独立确认启停、未知结果人工核对；后台启用可真实连接，保存本身不连接。界面显示已知状态的四语标签和未知安全回退，422凭据拒绝不再误称未知结果。补齐旧反馈页面同用户新会话缓存隔离、独立传输、认证重验时隐藏及401/403回执失权处理。

**8606项不覆盖这次随后新增的2341键界面或反馈修复**；应用 `64127d174dba40744af62a1b2b3e3894959f8008` 的最新UI完整类型、生产构建、五文件55项定向测试及资源/token门禁均通过；2341键完整UI随后已通过，见本文件11:22 UTC记录。真实企微租户、真实浏览器新表单、全dist新版本仍未执行。

## 企微接收与提示词管理集成（2026-10-26 10:31 UTC）

应用快照 `c3840243f37b730f80146bb7bbd673e2b2ab37c7`：新的隔离 PostgreSQL 从空库应用0355后，完整源码 API **132项通过**（40.6秒），包含企业微信7项真实事务用例；这不使用真实企业微信连接。既有 migration journal 前缀逐项未变，仅追加0355。

- 完整server和UI类型检查通过。首次server检查发现Zod record缺少键类型，显式声明string键后重新通过；原失败日志保留。
- 企微六文件83项纯测试通过；随后新增JSON对象消息体解析/非对象拒绝用例，该协议文件18项再次通过。不是83+18项互不重叠测试。另有task-drain既有20项通过。
- 提示词页面/session包装/API及反馈界面四文件35项通过；2286键四语契约、设计token/禁止token/runtime git-push门禁通过。没有把旧2246键8575项当成本轮全UI结果。
- 修复续租期间取消仍拨号和CONNECTING终止后的异步未监听错误；全局开关关闭仍无worker定时器/DB查询/socket。启动/启用不等于C3，断线缺口不自动补齐。
- HTTP私有集成路径日志仅保留静态命名空间，不再复制误贴在动态路径段的秘密；响应只保留状态码，避免反射响应头泄漏。包含实际pino序列化链的5文件67项通过，正文/异常等既有脱敏仍保留；详见安全测试清单。
- 提示词管理仅保存不可变版本及人工选择/回退，不应用运行配置；成本预览仍全部阻断，无推荐、预算预留或派发。

本轮UI生产构建已通过（保留既有大chunk和动态导入警告）；server标准构建完整执行并写入 `c21a6ebcc4666a97397631594e811c2474b1a70f` build stamp，编译server入口API **132项通过**（41.8秒），包含后补响应日志投影修复。编译入口仍使用workspace TS依赖loader，不是新全dist安装证明。真实浏览器新增表单、真实租户及全dist新版本未执行。历史离线安装与浏览器结果仅对应各自明确源码快照。

## P5 API与策略预览增量（2026-10-26 09:40 UTC）

应用构建 `feb4a5863e285576d753beff4e7c21246fa09b3e`：完整server/UI类型与生产构建通过；源码API125项、编译server入口API125项通过。新增提示词注册表/暂停调研读取、成本策略/既有比较兼容性及跨身份传输均纳入检查；0353/0354迁移在全新隔离数据库成功应用，历史表UPDATE/DELETE、审计故障回滚和CAS负例已通过。

2256键属于本增量。已运行定向UI14项、服务端纯测试48项；本增量尚未重复完整UI及独立全dist安装验收，不能继承133快照的8575项或129构建的安装结论。保留大chunk和Rust警告。提示词当前仅注册表API，不应用运行配置；成本预览全部阻断，缺实际执行上下文witness，不推荐/预留预算/派发。

## 133已推送快照全UI结束（2026-10-26 08:47 UTC）

远端 `eec55194d566341b798cc6904a5f467dd14e0d41` 对应2246键界面：757测试文件、76批、8575项通过，零失败/跳过/todo，运行期间源码未变。源码摘要 `252ec1888ae3299adc2b6b5642db2b608ddfa73aba04cb5168f404f4d16f8723`；清单 `test-results/mimouse-ui/2026-10-26T08-23-28-343Z-18/manifest.json`。资源CI运行40293667606成功。后续跨会话传输修复及2256键成本策略界面属于新快照，不套用本次全量结果。

后续集成阶段：提示词注册表5项和调研只读4项真实DB测试通过，成本策略/既有评估13项真实DB测试通过，完整源码API125项通过；提示词迁移生成顺序曾将复合FK置于唯一索引前导致42830，已在未发布迁移中调整顺序并用全新隔离数据库重跑。新成本预览全部blocked，仍没有实际路由推荐、预算预留或派发。当前完整类型/构建及最新全UI另行记录。

## 129应用构建收口（2026-10-26 08:34 UTC）

- 构建提交 `107e06d4a5c88b407f7083dee261f5f3f41be9bd`：完整server/UI构建通过，最新源码API113项、编译server入口API113项通过。128构建暴露两处类型/ESM后缀问题，已修正并保留原失败日志。
- 真正离线全dist安装通过：17个一方tarball、430个依赖，普通Node运行且拒绝TS/源码shim/工作区回退，内嵌runner/eval校验、真实PostgreSQL初始化与打包迁移、实际data_directory边界、health/UI/GET `/api/companies` 均通过；完整命令退出0。
- 关闭范围：显式shutdown返回、HTTP监听为false、数据库pid不存在；仍观察到PipeWrap/ProcessWrap/Timeout资源，测试工具按导出API的调用方拥有进程语义显式退出。自然退出未验证，不能用exit0掩盖该限制。此前未显式退出的尝试超时，原记录保留。
- 原生Chrome人工提升与回滚通过，独立文件/DB校验分别1/2条收据、整树字节/执行位/删除、保留备份、人工审计、Agent运行0；四语/刷新同一收据。详见 `checklists/RESTORE-BROWSER-20261026.md`。
- 新增用户验收入口 `USER-ACCEPTANCE.md`，列出环境、步骤、预期结果与待验收边界。2246键全UI正在执行，不把此前2199键8555项结果套用到新快照。

## 发布状态与后续验收（2026-10-26 08:08 UTC）

- 98个提交的已验收快照 `98dadacf951ed82a65be37c97ffb3cf20505d9da` 已推送 `xjfyt/paperclip:mimouse`，2026-10-26 07:51 UTC独立远端ref核对一致，作者邮箱与联合署名保留。
- 该提交的 GitHub `MiMouse resource contracts` 工作流成功：<https://github.com/xjfyt/paperclip/actions/runs/40288359386>。仅资源契约及生成一致性，不等于远端全量应用测试。
- 后续2199键快照：755文件/76批/8555项全UI通过，零失败/跳过，源码摘要 `62e59d4564a7c2c9ae6c36aee92256a04cd692e237566374bec3cd278aa943fd` 且执行期间未变；源API108、编译入口API108通过，完整构建stamp为 `d84c1f46cb735a9151f1c9387f67a395ba8de65c`。
- 原生浏览器发现恢复 staging 在umask0077下创建0700目录并被严格验证拒绝。没有将失败算通过；新增仅规范化独占新建目录的修复，旧源/孤儿目录仍拒绝/保留，11项纯FS回归通过，实际浏览器重验待续。
- 独立离线npm消费者已安装430个包，但初次启动暴露原生库提升布局及未修补wrapper选择问题。已增加DB作用域loader和平台库解析修复、5项布局测试；须重新打包启动才可判定完整安装通过。此前源码/编译入口通过不覆盖此独立安装问题。
- 2246键增量继续接入能力凭据台账、只读反馈错误证据及例行任务外壳四语。5项真实DB/API验证覆盖能力CAS/不可变触发器/审计回滚/ACL和反馈微秒分页；定向UI37、安全服务45、发布/布局14通过。最新全量类型/接口/构建/浏览器检查正在进行，不能把2199键全量结果套用于此快照。

## 最新集成快照（2026-10-26 07:10 UTC）

应用提交 `2c9d8db8db1bab1b7aa30b64329770cf3cc9dd00`，97个本地增量提交。下面旧表为历史快照，不代表当前统计。

- 四语2146键，仍不是完整覆盖率。
- 全量UI：753文件、76批、8542项通过，0失败/跳过，运行期间源码未变；源码摘要 `80c2a55ff50d79e21dfa4b31073f38a3831ef008311d0969d3734195159d2e60`。清单 `test-results/mimouse-ui/2026-10-26T06-17-12-364Z-48/manifest.json`。
- 源码API 92/92、编译server入口API 92/92通过，分别35.3秒、32.5秒；独立一次性PostgreSQL实例，包含0349/0350迁移。编译入口仍使用workspace TS依赖loader，不能当作全dist安装验证。
- 完整server/UI类型检查、shared/DB构建、server标准资源/内核构建和UI生产构建通过；server build-info正是上述应用提交。大chunk与Rust警告保留。
- 原始低内存SIGKILL与一次shell PATH导致的127失败保留，采用受限内存串行编译及pnpm exec后通过，没有跳过检查。
- 原生云Chrome：固定数据集、历史版本比较、未知费用阻断、四语报告和刷新恢复通过；Viewer读取403，Agent运行0。详见 `checklists/EVALUATION-BROWSER-20261026.md`。
- 独立全dist安装冒烟脚本已完成初稿与5项纯测试，但真实离线安装卡在npm acpx缓存缺失；补齐缓存时官方registry DNS失败，未进入运行验收，不计通过。
- 研究例行任务接线和受控文件恢复仍在独立本地分支，静态审查不替代数据库/UI验收，此快照不包含这些功能。
- 远端mimouse于07:08 UTC核对仍为原始基线；实现未推送。用户已要求推送，保留作者邮箱的CLI登录授权待完成。

## 已通过的检查

| 检查 | 实际结果 | 范围与限制 |
| --- | --- | --- |
| 四语合成 | 976 键，en / zh-CN / es / ja 键和占位符一致 | 词条数不是全应用覆盖率 |
| 全部 UI 测试文件 | 976键快照734文件/74批/8248项通过，零跳过失败 | React/jsdom，不是真实浏览器，不能跨快照套用结果 |
| UI 类型与生产构建 | tsc --noEmit、tsc -b --singleThreaded及Vite生产构建通过 | 大chunk与部分动态导入警告仍保留 |
| 完整服务端类型 | tsc --noEmit --singleThreaded 通过 | 不等于完整根目录 typecheck 脚本全部通过 |
| 服务端编译与资源打包 | 串行 tsc 生成 JS/声明，复制标准资源及 runner，写入 build-info 成功 | 与 package build 的步骤一致，但为云资源约束增加 singleThreaded；默认并行构建曾被 SIGKILL |
| 服务端定向安全/协议回归 | 16文件145项通过；另有10文件223项既有核心回归通过 | 后者覆盖真实数据库例行任务、路由授权、脱敏和外部loader；不是全仓所有server测试 |
| 外部适配器 | Qoder 17 项、WorkBuddy 5 项通过 | 真实子进程与假 CLI；非供应商收费任务 |
| 实际 HTTP/PostgreSQL | 最新源码入口40项通过；编译server入口配合976键UI共40项通过（含10项有限修复、10项应用令牌缓存） | 包括真实核心任务到已注册假 CLI 的运行记录、持久队列、OAuth 台账、CI 轮询与生产静态资源；workspace依赖仍使用TS loader |
| 迁移 | 0334–0341 已应用到专用隔离数据库 | 安全检查通过，20 项历史发现由既有 baseline 覆盖；生产升级演练未做 |
| 代码门禁 | no-git-push、设计 token gates、forbidden tokens 和 diff 检查通过 | 设计 token 检查不是安全凭据扫描 |
| 启发式凭据扫描 | 本次变更未发现所检查的私钥、GitHub/AWS/OpenAI 密钥格式 | 不能证明不存在所有种类的秘密 |

604键历史 UI 测试源码摘要：6e66d7f2260b14d702176b8d5c23ee6aca56533b6a6ae08177a986b56028b4a0。执行期间 UI 源码未变；每批退出码、文件列表和日志由 test:mimouse:ui 保存。此前 577 键阶段发现过一项空格回归及一个被终止批次，已修复/整批重跑；没有把原失败结果改写为通过。

先前服务端串行构建的build-info对应43ff050a37a62834188014851d00fc053db89b2e，已包含0340修复功能。21:49 UTC配合959键UI编译入口29项通过，后补跨公司修复负例后22:04 UTC完整30项通过。其后提交仅改变UI/文档，不把它们误称为此server二进制的源码提交。

## 环境问题处理

Node 24.22.1、pnpm 9.15.4、Rust 1.97.1；不升级项目依赖来掩盖问题。上游 Rust runner 构建成功，保留 7 条警告。依赖缓存原在 /tmp 内存盘，占用数 GB，导致类型/构建被回收；移到磁盘后，完整类型检查得以完成，暴露的一处会计事务类型错误已修正。串行编译完成服务端产物。

tsx CLI 的进程间 Unix socket 在此云环境受限，源码启动采用 node --import tsx；隔离 embedded PostgreSQL 使用回环 TCP，不改生产数据库设置。测试显式清除继承的数据库 URL、配置、加密主密钥和外部执行开关，每次直接数据库写入前核验 data_directory。遇到隔离进程 PID 重用触发实例保护时，未删除 PID 文件或绕过校验，独立会话重跑通过。

## 尚未通过的检查

- 命令执行会话直接启动 Chromium 仍受 socket() EPERM 限制。通过助手云桌面原生终端启动独立本地实例后，现有 Chrome 已完成四语首次引导/任务详情、审批及暂停通知界面的实际检查，详见 checklists/BROWSER-20261025.md。实际输入法、完整视觉/无障碍及所有路径仍未全量验收；没有关闭安全限制。
- 官方 Qoder CLI 1.1.78 的实际版本、帮助和隐藏参数校验通过，但没有登录、调用真实模型或消耗额度。
- Casdoor、WorkBuddy、真实通知接收目标及 GitLab/Runner 缺少实连输入。所有模拟成功保持 C2；不标为 C3/C4。
- 已按包覆盖全部35个非根工作区包的构建与类型检查：34包标准串行build加server等价串行编译；32包标准typecheck，加CLI/UI/server单独串行检查。原始根命令的一次默认执行曾因资源/环境失败，不把分批结果说成默认命令一次通过。具体复验命令见下节。
- 发布后全dist/npm安装包仍未验收。直接运行workspace中的cli/dist/index.js缺少zod等由发布清单生成器补齐的依赖；源码CLI经Node+tsx入口--help通过。未为掩盖该发布边界随意加依赖或改锁文件。
- 有限修复已接入并通过10项真实数据库测试，但真实供应商闭环未验收。七项能力面板已实现且区分夹具/未实现/未知；部分高频动态文案、配置修订与供应商对账仍有实现缺口，见 REMAINING.md。

## 复验入口

先按照部署文档准备独立测试目录与标记，确认不是生产实例。

- pnpm test:mimouse:ui：发现并分批执行全部 UI 测试；任何失败批次或源码变化都会返回非零。
- PAPERCLIP_MIMOUSE_TEST_HOME=<absolute-disposable-home> pnpm test:mimouse:api：启动源码服务并验证实际数据库/HTTP 链路，不启动浏览器。
- PAPERCLIP_MIMOUSE_TEST_COMPILED=true：上述 API 入口改用 node --import tsx dist/index.js；须先完成服务端和 UI 构建。server 入口使用编译 JS，但 workspace 依赖仍按上游 exports 指向 TS，因此保留 loader；这不是发布后全 dist 包的安装验收。
- node --test external-adapters/qoder-cn/test/*.test.mjs external-adapters/workbuddy/test/*.test.mjs。
- node scripts/compose-mimouse-locales.mjs --check。

外部适配器的实际 model hello probe 默认关闭；不得为复验此候选版自动开启收费探针或向真实收件人发送测试消息。

21:31 UTC 更新：816键资源校验通过；29项源码入口 API/PostgreSQL 通过；15文件118项服务端定向测试通过；Qoder/WorkBuddy外部适配器共22项通过。当时完整类型通过而编译入口待复验；现已完成后续43ff050构建与29项编译入口复验，见上文。

816键完整回归：732文件、74批、8224项全部通过，零跳过失败；源码摘要d399b9c77f09916d7fc710a8c8b08bb5f44436321083dfb555eda2c2e7c05c3b，执行期间未变。之后915键定向12文件243项通过，959键定向10文件142项通过，959键类型与生产构建通过；后续959键整套结果见下文，不混用旧快照结论。

服务端新编译曾与UI回归并发时再次SIGKILL；待整套回归完成后单独运行，GOMEMLIMIT=2500MiB、GOGC=20、GOMAXPROCS=2、tsc --singleThreaded完成编译。该资源调度调整不跳过类型错误或编译步骤。

22:05 UTC阶段UI快照：734文件、74批、8247项通过，零失败/跳过；摘要8c0d7849959fe0fb50976aeb68d71022a34ef8bb3a1556a0d4eb03c98c681428，执行期间源码未变。测试清单与全部批次日志保留用于交付。编译入口API/PostgreSQL30项通过，新增服务层公司过滤及数据库复合外键23503负例。


## 22:20 UTC 集成检查收敛

- 该阶段服务端构建基于e8a7f4aa8521eb8dfe5a82ca95a92c46c7c4d4c5，后续仅修改重复测试夹具与文档；编译入口30项连续两轮通过。曾有一轮新增负例使用默认公司前缀撞到保留夹具，改为正式公司创建API分配前缀后重复复验通过，没有放宽跨公司拒绝断言。
- 全工作区34包标准串行build通过，server额外执行串行tsc、供应商依赖核验、标准资源/runner复制及build-stamp通过。32包标准typecheck通过，CLI tsc --noEmit --singleThreaded、UI tsc -b --singleThreaded以及server类型/编译分别通过，共覆盖35个非根包。
- 云桌面独立终端补跑既有核心测试，10文件223项全部通过、无跳过；包括routines-service、routines-e2e、routines-routes、例行任务批注和遥测、适配器权限/注册表、日志脱敏与新增包实际loader。专用数据库、HOME和供应商开关隔离，没有调用真实模型。
- 三项JSON解析测试、959键资源一致性及工作树diff检查通过；新增分支CI使用只读权限、固定上游Actions版本，YAML已解析检查。远端工作流尚未执行，不能算CI绿灯。

资源受限时的实际检查方式（先准备正确Node/pnpm/Rust环境及独立测试目录）：

```sh
export GOMEMLIMIT=2500MiB GOGC=20 GOMAXPROCS=2 CARGO_BUILD_JOBS=2
pnpm preflight:workspace-links
pnpm --workspace-concurrency=1 --filter '!@paperclipai/server' -r build
pnpm --workspace-concurrency=1 --filter '!@paperclipai/server' --filter '!paperclipai' --filter '!@paperclipai/ui' -r typecheck
pnpm --filter paperclipai exec tsc --noEmit --singleThreaded
pnpm --filter @paperclipai/ui exec tsc -b --singleThreaded
pnpm --filter @paperclipai/server exec tsc --noEmit --singleThreaded
```

server编译除tsc --singleThreaded之外仍执行package.json中的所有资源复制和供应商核验步骤；不要把只生成JavaScript误当完整打包。大型类型检查不要与完整UI回归争用内存。Unix socket受限的执行会话与云桌面终端不共享/tmp；使用各自独立HOME/测试数据库，证据输出到共享工作区。


## 23:27 UTC 令牌刷新与最终候选复验

- 当前四语976键；UI完整734文件、74批、8248项通过，零失败/跳过，执行期间源码不变。摘要9a58bd8325a04556082f9c6f292af5e4e4f1b363c2d17ca678be7daf4407c4d1。独立定向10文件146项也通过，包含中文移动侧面板焦点恢复；不等于真实移动设备验收。
- 服务端定向16文件145项通过，含27项应用凭据/刷新协议单元测试；原核心10文件223项在云桌面隔离数据库重跑通过，无跳过。
- 源码及编译server入口各40项数据库/API测试通过。最新server build-info精确对应02d1d35f9532e07c232a2a399be02b4b01ce41d3；后续文档提交不改变该二进制来源。编译入口继续使用workspace TS依赖loader，并非npm发布安装验收。
- 0341加入公司/密钥版本隔离的加密token缓存、数据库刷新租约、修订CAS和退避；覆盖竞争、重启复用、撤销/轮换、迟到写回和结果未知不重发。钉钉应用及公众号支持app凭据自动按TTL刷新，也保留固定accessToken。供应商提前拒绝token时保守拒绝并交由管理员检查，不盲目刷新后重发可能已送达的消息。
- 新增测试初次使用相同假收件目标触发正确的跨公司全局限流；改为独立夹具收件目标后全部通过，没有关闭限流。编译复验曾被旧实例PID保护挡住，改用新建且带明确标记的隔离实例；其初次启动受Unix socket权限限制，确认无运行进程后只将该新测试集群设为回环TCP，随后40项通过，未删除PID或绕过实例保护。
- 最新UI类型/生产构建、CLI串行类型、32个其他工作区包类型、DB构建与迁移检查均通过。34包标准build的先前完整结果仍有效；此后代码变化集中于已重建的DB/server/UI，不宣称默认根命令单次全过。
- 真浏览器复核976键版本：中文侧栏宽度/反馈/Agent动作、侧面板属性/关闭/最大化、命令面板标签切换正确，英文任务内容保持原样。自定义新建标签控件仍显示Open a new tab，编辑器aria仍为editable markdown，列入剩余项，不宣称全应用本地化。

## 23:37 UTC 后续实现：配置修订

0342迁移已在专用旧数据夹具上应用，回填v1历史并给run.failed触发快照增加配置版本。4项新增DB测试通过，完整源码入口44项通过；通知UI17项及路由授权12项通过，server/UI类型、DB构建、UI生产构建和代码门禁通过。四语资源980键；尚未对980键快照跑整套UI，976键8248项只作为上一候选证据。最初新增快照属性未同步TypeScript接口导致类型检查失败，补齐后整套server类型复验通过。浏览器名称修改及历史已复核，详见浏览器清单。

## 23:42 UTC 后续实现：投递人工核对

0343按生成结果校正新增唯一索引先于复合外键的顺序后，首次应用到测试库成功；没有重写已应用迁移。完整源码API/DB48项通过，含4项核对、幂等、并发、跨公司FK23503和状态变化拒绝；通知UI19项、路由授权15项通过。server/UI类型、DB构建、四语990键及代码门禁通过。人工依据不改原state/receipt或发送消息；不把人工观察提升为供应商C3。真实浏览器核对表单将在下一集成轮复验；本切片不沿用先前浏览器结论冒充完成。

## 2026-10-26 00:26 UTC 完整集成快照

1331键UI源码摘要37ff8682c13f75bed1a3e2678b97ba1ddfd43cc7184dd98f5b195a338384f66e：736文件、74批、8289项全部通过，零失败/跳过，执行期间源码未变。server标准资源串行构建及UI生产构建通过；server build-info对应064da700af3cf6ef5760825e995e50f79461eab3，编译入口48项HTTP/DB通过（仍使用workspace TS依赖loader）。

随后独立authenticated/private实例的真实Chrome测试已完成本地测试IdP的签名回调、首位管理员认领、未受邀拒绝、Viewer邀请及读写隔离、旧密码账号显式绑定并以SSO回到同一userId。详见OIDC-BROWSER-20261026.md。真实流程发现三项UI缺口，正修复；以上整套快照不是这些修复后的结论。所有供应商C3仍未验收。

## 2026-10-26 01:40 UTC 1396键集成快照

- UI源码摘要`3139e17325711bd029b9662892f20553c4f9a8c0259759e3ecbb03cfbce693bd`，739文件、74批、8315项全部通过，零失败/跳过，执行期间UI源码未变。词典1396键一致不等于四语全覆盖；37个高频文件另有500条待人工复核语法候选清单。
- 当前16个服务端定向文件149项通过；Qoder17、WorkBuddy5及本地IdP HTTP协议2项通过；既有核心10文件223项在助手云桌面隔离数据库复验通过，无跳过。定向集合不是全服务端测试全集。
- source入口54项API/DB与compiled server入口54项分别通过；编译产物build-info为4f14b427fa04af98c1647d86ab0468148455e5ee。编译入口仍使用workspace TS依赖loader，不是完整npm all-dist安装证明。后续审计工具/文档提交不改变该应用代码快照。
- server标准构建步骤按资源限制串行执行，runner校验、Rust二进制、资源复制与build stamp完成；shared/DB标准构建、server完整类型和UI类型/构建通过。Rust7条既有警告、Vite大chunk及配置兼容提示保留。之前35个工作区包检查是历史基线；本次重建受影响shared/db/server/UI，不把历史结果说成本次根命令单次全过。
- 0344增量迁移在既有测试库及独立SSO实例均通过；迁移编号与安全门禁通过，所有既有journal项保持不变。
- 真实Chrome增加本地IdP首次管理员、未邀请隔离、Viewer邀请/读写、旧账号显式绑定、logout、中文/西语SSO-only邀请和管理员撤销。真实OAuth旧session及Board key撤销后401、Owner200；实际Casdoor租户仍未连接。详细失败/修复/复验见OIDC-BROWSER-20261026.md。
- 此快照是增量候选，不是原v2全部要求完成。P1余项及P2-P5实现范围见REMAINING与验收CSV，真实外部账号/目标授权另列blocked。仍未推送实现到GitHub，也未合并/tag/生产部署。

## 2026-10-26 03:13 UTC 反馈入站底座定向检查

0345为增量新表，原journal前缀逐项保持一致，未改已应用迁移；编号/安全门禁、DB编译及shared标准构建通过。服务端脱敏/权限/日志3文件43项通过；全新隔离PostgreSQL从空库迁移后，真实API3项覆盖并发200/201去重、改内容409、跨公司详情/候选/游标404、产品/版本候选隔离、稳定分页、拒绝权限声明和原始秘密不入库。

首次尝试复用历史夹具时命中PostgreSQL所有权安全检查而拒绝启动，没有删除PID或关闭身份检查。新独立夹具初始化成功后因此执行环境禁止Unix socket而启动失败；仅给该一次性测试库配置unix_socket_directories为空、沿原回环TCP连接复验通过，未改变数据库鉴权。相关失败日志保留。没有连接真实Langfuse/企微或导入客户资料。

此时1666键完整UI回归仍在进行，UI源码保持冻结。新反馈入站尚无UI/人工转任务，server完整类型与标准构建将在UI大回归后串行检查；定向通过不代表原计划P3完成。

03:20 UTC反馈人审转任务增量：0346新增同公司复合外键与不可重复确认表；生成器把被引用unique index放在FK后，未应用前调至前置，实际空库迁移通过。3文件44项定向测试、6项真实数据库/API覆盖同request并发返回同一private/backlog任务、原始秘密脱敏、quarantined来源、无Agent指派、不同确认冲突、暂停成员拒绝、跨公司候选拒绝、两条反馈并发各建一任务。尚不包含真实供应商或浏览器UI。

运行复用夹具再次遇到独立PID命名空间中的旧PID号冲突，被安全检查拒绝；新增prepare-disposable-db.mjs仅初始化全新带标记测试库并配置既有回环TCP，不启动数据库、不删除PID、不复用进程、不修改鉴权。其后全新实例完成两项迁移及六项测试。完整server类型/构建仍排在UI全量之后，失败日志与测试范围分别保留。

03:26 UTC阶段复验：1666键UI固定源码摘要8217c6fbbf8410e4b2c6b984fe1d71f67c3e2895b2fd55085b84147f0080ae44，741文件/75批/8375项全部通过，无失败/跳过，sourceUnchanged=true。之后增加的构建矩阵UI另行测试，不套用该全量结果。矩阵/反馈入站/人审转任务的server完整类型检查串行通过；shared构建通过。新隔离库重新迁移并运行矩阵、反馈、转任务7项通过，包含引用任务删除被上游保护拒绝、随后幂等回执不变。标准server编译及资源打包继续进行，尚不声明编译入口复验通过。

## 2026-10-26 03:47 UTC 四语反馈/矩阵界面

新增确认状态读取成功路径已在真实回环SSO会话验证，刷新不重放创建。source API全集60项在新空库通过；服务端定向5文件62项通过，UI定向5文件78项通过，UI类型、构建和设计门禁通过。并行资源竞争导致一次server类型SIGKILL/Vite137，串行复验均通过。详情见FEEDBACK-BROWSER-20261026.md。

标准server构建（runner合同/资源/Rust/编译/复制/印章）此前完成，stamp=063df7e10e5ae4f281a9e66c20caa78fca247729，Rust7项既有警告保留；该产物尚不含随后新增GET确认状态接口，不能当作当前界面的编译入口验收。DB标准构建与迁移检查通过，未改既有迁移。最新UI1730键全量回归与新server编译入口复验安排下一冻结点，不沿用8375项历史快照。

## 2026-10-26 04:15 UTC 1730键候选复验

冻结应用代码bd5af65f702458d1fab44be646daacd1d6e25acc：UI743文件/75批/8394项全部通过，无失败/跳过，sourceUnchanged=true，源码摘要`dc616ecbc525ddac91a00b1d84c07c6729c3fa1df376d6eea05b508cb9fbf756`。本次覆盖新增反馈/矩阵及任务入口，不沿用旧1396/1666键结果。

同一应用代码标准server构建完成，stamp=bd5af65f702458d1fab44be646daacd1d6e25acc；新的独立空库上compiled server入口API60项通过，source API60项也已通过。编译入口仍使用workspace TS依赖loader，不是npm all-dist安装验收。适配器和回环IdP协议24项重新通过；server定向5文件62项、UI定向5文件78项、shared/DB构建及server/UI完整类型/生产构建通过。Rust7项与Vite既有警告保留；资源失败与串行修复记录不删除。

75个应用提交的补丁已在独立临时验证克隆重放，tree=ae812dfc2319034d430a848756359595115ebf67与原分支一致，bundle保留精确SHA，全部作者/联合署名校验通过。随后的文档提交不改变受测应用代码。该验证克隆只用于本地重放，没有创建独立Codex任务。

真实供应商、Runner、上传及P4/P5等剩余范围仍按REMAINING列出，不称原计划完成。实现代码尚未推送GitHub，提交身份授权待选择；MiWork剩余恢复文件未获永久删除确认，未删除。

## 2026-10-26 23:28 UTC：3506键与调研合同

- watchdog 18键四语中央合成与--check通过；3文件142项、完整UI类型/生产构建通过（/tmp/paperclip-3506-{focused,ui-types,ui-build}.log）。本片没有新增全UI/浏览器验收。
- 收益/验收/依赖合同：9项单测与新隔离库4项API通过。首次--project server无匹配，改server/vitest.config.ts后通过，未掩盖启动失败。
- 新research-scheduled-loop独立集成在新隔离库1项通过：真实routine调度、来源关系、JWT/HTTP报告与人审私有待办和真实依赖边；仅heartbeat执行替换为惰性回执，不是实际模型、联网检索或真实业务收益。日志/tmp/paperclip-scheduled-research-api.log。
- API启动为源码入口，工作区依赖亦为源码；尚未运行本片编译入口完整API。测试目录保留且postmaster.pid存在，不删除锁、不宣称整个PG优雅退出。

## 2026-10-26 23:42 UTC：0358源码API集成

在新隔离PostgreSQL通过完整正常迁移链到0358，source API 158项全部通过（45.8s，/tmp/paperclip-0358-source-api.log）。包括通知策略14项、编码修复11项、反馈验证6项和真实调度到人审链1项；其余沿既有完整清单。无真实供应商/模型，执行边界使用标记fixture。

通知首次新库定向3失败/16通过，根因0356 BEFORE INSERT补verificationEpoch使分组前后hash不同；修复为计算key前冻结安全代次，未删校验。修复后定向30项及本次完整158项均通过。反馈并发使用独立DB客户端，所有三元FK/请求唯一、等待期间撤权、audit写失败回滚均通过。0358新增普通提示词应用表仅数据库创建通过，普通运行态应用专属实现仍在集成。

本次为源码入口，不是编译入口或独立all-dist验收。初步server完整类型检查发现新P5 target环境类型错误，修复仍由对应后续代码片完成，不把API通过当类型通过。
