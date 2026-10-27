# 本地集成验证记录

记录起始日期：2026-10-25 UTC。基线为 v2026.1023.0 / 1b4c803816e82b0265c8422e1a804327a7ed8c54。开发分支 mimouse。此记录是可审查候选版的本地证据，不是全部需求完成或生产上线证明。

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
