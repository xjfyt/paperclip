# 集成合同 v1

- 上游 AdapterExecutionContext/Result 是唯一执行合同，不扩展核心 run 状态枚举。
- API 使用公司权限检查；匿名能力查询仅返回登录方式，不返回秘密。
- 本地化仅注册 en、zh-CN、es、ja。领域资源是唯一编辑源，生成 JSON 键与占位符必须严格一致；原 app.noCompanies 保留。
- 业务内容、代码、日志、ID、货币、账期和时区不随界面语言改写。
- 通知与远端任务都使用 PostgreSQL 持久状态；未知副作用不自动重发或重复创建。
- 证据绑定公司、资源和受测 commit；CI head 与 reviewed head 不一致不能放行。
- 新功能协议未经验证不得默认启用。每个模块单独维护验收状态和已知限制。
