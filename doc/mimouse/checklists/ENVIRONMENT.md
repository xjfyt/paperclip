# 联调输入与环境

- GitHub：xjfyt/paperclip，mimouse 基于固定上游；fork 为公开仓库，禁止提交内部凭据、客户内容或原始私有计划。
- Node：云环境 v24.22.1，满足 >=24.11.0；pnpm 使用 9.15.4，锁文件不随意升级。
- 本地 PostgreSQL：优先项目 embedded PostgreSQL，隔离 PAPERCLIP_HOME；不连接生产数据库。
- Casdoor：实际 discovery、issuer、应用权限、测试身份及秘密未提供，C3/C4 阻塞；继续本地测试 IdP。
- Qoder CN：官方 npm 兼容包 1.1.78 的真实版本、帮助和隐藏参数诊断通过；未登录、未调用模型。账号和额度仍待提供。
- WorkBuddy：应用审核、OAuth scopes、用户授权未提供，继续协议与恢复验证。
- 通知：测试收件人、Webhook、签名、公众号模板未提供，不发送真实消息。
- GitLab：版本、项目凭据和 Runner 未提供，先 fixture 与模拟 MR/CI。
- 发布：跨平台机器、签名与产物服务合同未提供，不声称全平台发布完成。
