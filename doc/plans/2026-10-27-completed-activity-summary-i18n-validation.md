# 活动聚合摘要四语验证（2026-10-27）

## 本片范围与真实入口

- 仅修改 `completed-activity-summary.ts` 和 `TaskChatRunnerActivityGroup.tsx` 底部聚合摘要、计数、展开/收起完整 ARIA 及历史列表名称。
- helper 的唯一业务调用者是 Group；实际 `TaskChatThreadView`、`TaskChatRunnerTurn`、`TaskChatLiveTail` 都挂载 Group。`DesignGuide` 也展示该组件，不是另一套摘要算法。
- 新增 `completedActivityUi` 四语 contribution，共 69 键。没有修改生成后的语言文件；由主线统一 compose。
- 没有修改顶部工具 presentation、协议 wire、工具分类、执行/授权/重试逻辑、持久化展开状态或后端。

## 原文边界与不变量

- Map 仍以原 canonical 英文为键，保持类别数量、order 排序与原 icon 胜出规则；翻译只发生在最终展示阶段，不按译文去重。
- 只附加 owned key 元数据。单个 provider `summary` / `details` 中 `Summary` 仍是原文（沿用原有 trim），即便恰好为 `Ran commands`，也不根据其内容猜翻译 key。
- raw 与 owned 碰撞时，只将该类别的展示所有权保守降为 raw，不改变 key、数量、顺序或 icon。两个输入顺序均覆盖；任何 raw 来源都不会因后续较早 order 的 owned 类别替换而丢失原文属性。
- 续句使用 owned 的显式译文；provider 大小写、内部逗号不做 lowercase/拆分。ARIA 使用同一原文边界，不再对整个 fullLabel lowercase。
- `Read files` / `Edited files` 仍只由对应 family 的 completed 事实决定。失败/中断/等待中的 read/edit 保留中性的 Checked/Worked；命令执行不推断成功。
- notice 严重级优先级与顺序不变；大于 3 类才显示前 2 类 + 完整 “and more” 模板；tooltip/ARIA 仍保留完整有序类别。

## 自动验证与覆盖边界

- 单 worker、Node 640 MB，四个 focused Vitest 文件首轮 **72/72 通过**；补强 terminal 协议类别与 raw 的双向碰撞后，helper 文件再次 **48/48 通过**；token 四门及 `git diff --check` 通过。
- helper 四语测试覆盖全部工具/协议/工作区/资源/思考/停止/usage 类别、0/1/2 数量、成功重试与未成功事实、canonical 去重、译文碰撞、3/4 类截断、单/多 notice 优先级与 raw 碰撞。
- 三个真实 host 使用真实 Group、真实摘要/helper、真实 timeline adapter，验证 en→zh-CN→es→ja→en 热切。包含同文 raw、失败事实、notice 优先级、tooltip、完整 ARIA、活动数、history label。
- 热切保持 toggle/title/history/detail 的同一 DOM 节点、展开 memory、焦点、原始 items；无 runtime decision 回调、无 fetch。仅使用虚构本地数据。
- 原 Group 行为测试与既有 provider activity i18n 测试一并回归。新增 host 测试不是整 App、真实事件流或浏览器 E2E；没有运行 full typecheck/build、连接服务或执行工具。
- 本地外置日志：`/tmp/completed-activity-qa/`（保留测试/门禁日志；不触碰共享依赖缓存）。

## 待人工验证

1. 在四语真实任务线程中，分别观察已结束历史、runner live 和 legacy live；对比失败 read/edit 与成功重试，确认没有误导性的成功措辞。
2. 在窄屏和长 provider 文本下检查摘要截断、完整 tooltip、计数布局；确认原文大小写与标点完整。
3. 用键盘和屏幕阅读器展开/收起活动及详情，切语后确认焦点、history 名称和完整 ARIA 可理解；jsdom 不能证明真实读屏发音或视觉布局。
4. 多 notice 的 warning/error 应继续优先可见；只做已有安全测试记录的展示验证，不为本地化验证触发真实工具、授权或外部调用。
