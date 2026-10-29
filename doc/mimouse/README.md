# MiMouse 二开导航

> **维护提示** — 功能入口、当前缺口或最新验证索引变化时更新；下方日期快照不顺延为新输入证据。
> **最后验证** — 2026-10-30（导航与当前/历史边界核对，不代表全部功能验收）

> **最新复核（2026-10-30）** — [完善与验证记录](checklists/2026-10-30-project-closure.md)及[浏览器机器证据](checklists/2026-10-30-browser-closure-evidence.json)补充 Windows 真实 API、四语 Edge、认证恢复、主页面/编辑器/图表与生命周期修复；下方各日期记录保留原范围。

> **本机复核入口（2026-10-29）** — 先看[项目审计与修复](checklists/2026-10-29-project-audit.md)及[Windows 验证证据](checklists/2026-10-29-project-audit-verification.md)。中文文档统一从[编号文档导航](../../docs/README.md)进入，遵循[文档规范](../../docs/00-doc-rules.md)。下方重建段落是先前环境快照；本机已有新的类型、构建与 Edge 局部证据，不能沿用旧浏览器 blocked 或旧通过总数。

> **2026-10-29重建状态**：从远端`e2bab5dc`重新整合，前一环境未推送`c5af04fa`未找回；旧测试不作为当前通过证据。先读[当前验证/待完成项](VERIFICATION.md#2026-10-29-重建候选当前证据与未完成检查)、[四项合同代码边界](REMAINING.md#2026-10-29-当前阻塞与明确代码边界)及[本批用户测试入口](USER-ACCEPTANCE.md#2026-10-29-重建候选验收入口)。当前0d1105e已合普通Claude/Codex配置补译，7294键；176项定向、类型/构建/正确门禁与53项审计通过，06:42 UTC已核对0d1105e阶段推送，该SHA资源CI成功（仅resources），新915文件/92批/12940项全UI严格聚合通过（零失败/skip/todo）。上一358bd7a的914文件/12896项通过不迁移。浏览器为[环境blocked、无页面截图](checklists/BROWSER-ENVIRONMENT-20261029.md)，不是全计划完成。

固定基线：`v2026.1023.0` / `1b4c803816e82b0265c8422e1a804327a7ed8c54`。工作分支 `mimouse`。保留上游核心、公司授权、工作区与执行协议，新增能力默认保守关闭；当前不是全部需求已验收的生产版本。

- [原 v2 逐项追踪与可执行手测](PLAN-TRACEABILITY.md)
- [用户验收操作指南](USER-ACCEPTANCE.md)
- [本地验证记录](VERIFICATION.md)
- [部署与回退](deployment.md)
- [接口导航](api.md)
- [Casdoor 登录](casdoor.md)
- [通知中心](notifications.md)
- [通知配置验证与人工依据](../plans/2026-10-26-notification-verification.md)
- [WorkBuddy](workbuddy.md)
- [适配器能力证据](adapter-capabilities.md)
- [GitLab 编码交付](coding.md)
- [运营数据预演与审核](operations.md)
- [调研候选与人工确认](research.md)
- [固定技能评估与受控提升/回滚](evaluation.md)
- [Langfuse只读反馈接入](langfuse.md)
- [反馈到固定回归集来源链](FEEDBACK-EVALUATION-LINEAGE.md)
- [通知/来源链真实浏览器局部验收](checklists/NOTIFICATION-LINEAGE-BROWSER-20261026.md)
- [四语覆盖与未完成项](i18n_remaining.md)
- [任务属性真实浏览器验收](checklists/ISSUE-PROPERTIES-BROWSER-20261026.md)
- [实现缺口与后续验收](REMAINING.md)
- [逐项验收清单](checklists/ACCEPTANCE.csv)
- [联调输入](checklists/ENVIRONMENT.md)
- Qoder 包：`external-adapters/qoder-cn/README.md`
- WorkBuddy 包：`external-adapters/workbuddy/README.md`

## 验证分级

C1 是实现与本地检查；C2 是受控协议/故障夹具；C3 是真实租户连通；C4 是真实业务验收。真实本地 HTTP/PostgreSQL 测试不等于 C3 供应商测试。React/jsdom 回归不等于真实浏览器，APIRequestContext 测试不启动 Chromium。受阻、跳过和未知不计通过。

外部适配器包使用上游真实 loader 的测试通过；真实 Qoder CLI、WorkBuddy 账号执行仍需单独验收。新页面只在对应公司上下文展示，不在生产注册表注入测试供应商。除用户明确授权的工作分支发布外，不自动推送客户代码、发送外部群消息或上线生产环境。

后续入口：[企微管理界面](../plans/2026-10-26-wecom-admin-ui.md)、[提示词注册表](../plans/2026-10-26-p5-prompt-registry.md)。注册表选择不应用运行态，成本预览不执行路由。原计划、后续扩展和真实账号阻塞请以逐项追踪表区分。
