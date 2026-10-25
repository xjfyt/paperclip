# 集成合同 v1

- 上游 AdapterExecutionContext/Result 是唯一执行合同，不扩展核心 run 状态枚举。
- API 使用公司权限检查；匿名能力查询仅返回登录方式，不返回秘密。
- 本地化仅注册 en、zh-CN、es、ja。领域资源是唯一编辑源，生成 JSON 键与占位符必须严格一致；原 app.noCompanies 保留。
- 业务内容、代码、日志、ID、货币、账期和时区不随界面语言改写。
- 通知与远端任务都使用 PostgreSQL 持久状态；未知副作用不自动重发或重复创建。
- 证据绑定公司、资源和受测 commit；CI head 与 reviewed head 不一致不能放行。
- 新功能协议未经验证不得默认启用。每个模块单独维护验收状态和已知限制。

## 通知配置修订增量合同（0342）

渠道configVersion从1开始，配置编辑以expectedVersion作CAS并自动暂停；历史仅含非秘密配置、秘密引用/版本和操作者。启用及测试同样核对expectedVersion，省略仅兼容v1。旧投递冻结快照永不被新配置改写。shared DTO、API客户端、迁移与四语界面同时更新；渠道kind变更须新建。

## 投递核对增量合同（0343）

人工观察与供应商传输结果分离。review绑定公司/投递/操作者/原state+attempt和requestId；同键不同内容或操作者拒绝。仅terminal或unknown状态允许记录，禁止改写发送状态、回执、快照或触发外部请求。UI明确显示“报告”，不提升C3/C4。
