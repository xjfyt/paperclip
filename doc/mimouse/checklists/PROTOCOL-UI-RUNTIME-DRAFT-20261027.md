# 协议界面四语补全与运行时问答草稿修复（2026-10-27）

本批以已发布的 `2d6d12c9` 为基线，补齐上一批明确保留的工具显示、活动摘要和协议卡文案，并单独修复真实组件复现的问答草稿问题。当前资源为每种5500键；这不是全站覆盖率。最终统一验证结果在本页末尾与 [VERIFICATION](../VERIFICATION.md) 记录，不把定向用例相加当作全量。

## 1. 本批实现边界

- **工具活动显示**：增加独立 copy descriptor / display API，复用原分类结果；原 `toolActivityPresentation` 返回对象、别名/分类、canonical英文、summaryGroup与去重判断不变。完整四状态模板只在显示层翻译；工具名、namespace、target和未知值按原规则保留。缺Name的本地兜底与provider真的命名为“Unnamed tool”严格区分。
- **活动聚合摘要**：保留canonical Map键、去重数量、通知严重级优先级、顺序、图标、已完成事实及超过3类时前2类+more的截断。raw通知与owned标签同文碰撞时保守保留raw归属；不按译文去重、不对拼接后的provider原文lowercase。失败read/edit不被写成已成功。
- **工作区/运行时协议卡**：workspace变更数量、预览、状态说明，运行时输入/权限、回执、提交/拒绝按钮与非Error失败文案已接四语。原事件、路径/diff、权限目标、选择key、请求参数与provider问题/选项保持原样。
- **问题表单**：校验、分页、ARIA、空答案、推荐/自定义项等本地默认、非Error提交/取消提示按来源保存描述符，显示后换语仍更新。数字/长度/安全正则算法和响应schema不变；provider header/prompt/help/options/custom label/placeholder/submitLabel及原Error.message不翻译。
- **富文本图片输入**：本地上传不可用/非Error失败及附件控件说明四语化，文件名、URL和原始Error不变。真实Form可见上传失败路径已测试；正常Form不打开showImageAttachControls，附件按钮/drop提示属于显式controls=true组件能力测试，不宣称生产入口可见。
- **运行检查器**：主任务timeline与Inspector不是同一展示路径。Inspector的 `AgentDetail → RunnerInspector → ProductionSurfacePreview → parser → adapter → Card` 可直接展示Provider/WorkspaceFile/Result/Terminal卡。本批追加13项确定本地文案，测试真实Preview入口解析/投影/渲染、切语/展开/预览状态与原文保持；Inspector挂载以源接线契约核对，不是完整浏览器验收。Group的Permission前缀另作防御性翻译，目前仅找到Lab fixture供decision，不冒称生产adapter供值。

## 2. 独立功能修复：问答提交与草稿生命周期

### 已复现的原问题

1. `RuntimeRequestCard.submit` 吞掉onDecision拒绝，QuestionForm把返回当成功并清除持久草稿；takeover直接返回Form，Card自身错误也不可见。
2. 真实Thread的runtime→durable问答投影共享同一issue/run/request草稿key，却更换组件树；旧请求稍后成功或失败可清除用户已经编辑的新durable草稿。dismiss/reopen同key也有类似问题。
3. 同一个事件批次内连续提交，structured/legacy/permission路径均可能调用两次，单靠React提交后的disabled不够。
4. legacy请求A→B可能沿用A的字段；父Card的legacy持久化effect还会把结构化Form初始schema覆盖成空对象。

基线日志保留在 `/tmp/task-runtime-draft-safety-20261027/`：重新运行的baseline有13失败/249通过，structured ownership另有单例红基线。不是所有失败都属于生产问题：早期Thread fixture因缺旧问题结构而被既有guard隐藏，已先修正fixture再验证真实handoff，未放开guard。

### 修复机制

- Form/Card采用同步attempt引用和layout清理，旧实例或旧attempt的晚到完成不得清草稿或写入新状态；不是把旧成功伪装成失败。
- 只让QuestionForm回调收到原始拒绝cause，保留其可见错误和草稿；直接按钮仍在Card内捕获，不制造未处理拒绝。
- Card使用稳定id/run/request/turn/draft身份，不按locale、回调函数或questionSet对象引用重挂；同语义对象刷新/切语不重置正在进行的尝试。
- structured草稿只由QuestionForm读取/保存/清理，legacy字段保留自己的原存储结构。
- **已有QuestionForm wrapper原本就按id/draftKey分实例**，本补丁不声称它不存在。跨turn同ID重用是防御组件用例，不宣称已观测到真实provider重用或权限漏洞。
- API、权限、request/run/turn/kind参数及后端均未改变；服务端仍为授权权威。

### 定向与独立审查

功能片worker在7文件419项中通过，最终补齐callback类型夹具后该文件2项再过；包含真实Thread runtime→durable成功/失败交接、原cause identity、同act防重、pending A→B、同key重开、失败重试/取消、原草稿schema和locale/等价对象稳定性。独立只读审查未发现该限定修复的阻断，未冒充独立浏览器/供应商实测。最终主线统一回归另记，不沿用worker数字作全量证明。

## 3. 审计方法与证据精度

- schema 4在原78文件外增加四个精确TSX：Group/Card/QuestionForm/RichInput，共82个AST文件；原routine、公司、构建观测、quota和consumed组件范围保持。
- 四个helper `.ts` 与Row文件的真实named export `TaskChatProtocolActivityDetails` 作为五份独立manualSourceEvidence，有自己的摘要与调用边，不伪装成JSX候选扫描。Row组件本身仅被import不等于实际render。
- 新报告仍只给候选和来源，不把“AST没有英文”当全站完成；新增范围/方法不能与旧78文件直接计算完成率。Inspector是独立真实消费者，不能用主timeline过滤规则把它判为死代码。
- worker的额外测试曾受独立worktree未合成新Form资源、缺protocol schema及Pi源依赖阻断；主线拥有这些输入，已按实际文件重跑相应邻接用例。未删除失败日志或伪称首次全绿。
- 环境恢复中断了在途协作，但代码和日志保留；恢复后重新核对并接续测试，未把未结束进程当通过。

## 4. 用户手测（均默认未执行）

在独立可丢弃环境记录完整SHA、系统/浏览器、语言、缩放和provider版本。只用合成问题、文件和测试账户；不要用真实权限批准、收费模型或敏感答案代替受控测试。

1. 四语切换真实工具活动、进行中/完成/失败/中断状态与已结束摘要。失败不应显示成功；原工具名/路径/诊断/同文原始内容不能被翻译。展开与焦点保持，通知优先级不变。
2. 工作区变更卡预览/展开、数量、二进制与无预览提示；原diff、路径、资源ref不能变。运行检查器单独打开pipeline operation的生产预览，不将主聊天通过代替此入口。
3. 问答分页、必填、自定义、多选、数字上下界、长度和正则；换语不清答案、不自动提交、不改变validation。中文/日文IME、粘贴/拖放及数字输入法需真浏览器测试。
4. 使用受控失败回调或测试服务让提交/取消失败：错误应可见，持久草稿/内存答案均保留，重试只发一次原请求；相同英文的普通Error应仍显示原文。
5. 快速双击/连续快捷键提交，检查只有一次请求；pending时切换请求、关闭重开、切语，再让旧请求成功/失败。新草稿不能被旧回调清掉或被旧错误覆盖。
6. 复现runtime问题被投影为durable问题的同key交接，输入新答案后再让旧请求结束，验证新持久草稿、显示和提交payload均不变。正常当前请求成功仍按原规则清草稿。
7. legacy字段A/B草稿分别恢复，结构化初始答案schema不被父Card覆盖；不要把未复现的provider同ID跨turn重用列为真实故障。
8. 原始日志/模型输出、provider问题/按钮标签/未知协议字段应保持原文；真实CLI/网络拒绝、认证撤销、关闭标签页和重启恢复仍需实际环境验证，不能由jsdom模拟替代。

## 5. 最终集成记录

- 冻结122be536，5500键；schema4公开审计82 AST文件/5独立manual源，278 literal/1974 dynamic，missing/unmatched均为空。完整UI类型、串行标准构建4.12秒、18文件717项中央（5条scrollTo提示）和61项脚本/门禁通过；新868文件87批11830项完整UI严格聚合通过，详见VERIFICATION。
- 中间5486版本完整UI类型复验、17文件672项中央及61项Node脚本通过；首轮测试类型夹具错误已修并保留日志，不将其直接顺延为Inspector补项后的全量结果。
- 后端源码未变；164项编译API/既有后端构建仅为对应历史输入证据，本轮未声称重新运行后端。
- 真实Casdoor、CLI/模型、通知送达、跨平台Runner、上传/业务接口、独立安装包与灾备恢复仍依 [REMAINING](../REMAINING.md) 列出的条件验收。未覆盖的上游页面/动态原文不因5500键而推断为已完成，原85项需求状态统计不改。

最终聚合证据为 `test-results/mimouse-ui/aggregate-2026-10-27T18-32-00-887Z-PU6lQU/aggregate.json`，9个新分片覆盖868文件87批，11830项通过、零失败/跳过/todo，sourceUnchanged均为true。UI源码摘要 `ed1d79f336ff7e22fba9b81dc9886435cc5a371792066815aff0c9e377a5e0a8`，runtime-trees-v2摘要 `646bf37f2c708722b7f2d46cd9199021ec2ca2cea60d629350b91f208d081b6a`；不把该分片聚合称为真实浏览器/供应商验收。
