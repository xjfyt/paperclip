# MiMouse 二开导航

固定基线：`v2026.1023.0` / `1b4c803816e82b0265c8422e1a804327a7ed8c54`。工作分支 `mimouse`。保留上游核心、公司授权、工作区与执行协议，新增能力默认保守关闭；当前不是全部需求已验收的生产版本。

- [本地验证记录](VERIFICATION.md)
- [部署与回退](deployment.md)
- [接口导航](api.md)
- [Casdoor 登录](casdoor.md)
- [通知中心](notifications.md)
- [WorkBuddy](workbuddy.md)
- [适配器能力证据](adapter-capabilities.md)
- [GitLab 编码交付](coding.md)
- [四语覆盖与未完成项](i18n_remaining.md)
- [实现缺口与后续验收](REMAINING.md)
- [逐项验收清单](checklists/ACCEPTANCE.csv)
- [联调输入](checklists/ENVIRONMENT.md)
- Qoder 包：`external-adapters/qoder-cn/README.md`
- WorkBuddy 包：`external-adapters/workbuddy/README.md`

## 验证分级

C1 是实现与本地检查；C2 是受控协议/故障夹具；C3 是真实租户连通；C4 是真实业务验收。真实本地 HTTP/PostgreSQL 测试不等于 C3 供应商测试。React/jsdom 回归不等于真实浏览器，APIRequestContext 测试不启动 Chromium。受阻、跳过和未知不计通过。

外部适配器包使用上游真实 loader 的测试通过；真实 Qoder CLI、WorkBuddy 账号执行仍需单独验收。新页面只在对应公司上下文展示，不在生产注册表注入测试供应商。除用户明确授权的工作分支发布外，不自动推送客户代码、发送外部群消息或上线生产环境。
