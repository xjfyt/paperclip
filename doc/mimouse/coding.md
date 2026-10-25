# GitLab 固定提交交付流程

入口：公司侧栏「编码交付」，或已绑定执行工作区的任务详情。此切片提供交付台账、GitLab API、明确确认的分支推送和草稿 MR、手动同步与默认关闭的自动 CI 轮询、固定 SHA 审阅门禁及本地产物清单。不是完整自动编码流水线，不自动合并或发布。

## 部署及边界

应用标准迁移 0336、0339。公司秘密值为 JSON `{ "token": "..." }`，界面仅填写秘密 ID。`PAPERCLIP_GITLAB_ALLOWED_ORIGINS` 为逗号分隔的管理员允许源，必须精确匹配，不跟随携带令牌的重定向。支持 GitLab CE 基础 API；高级审批与合成合并流水线不假定存在，版本查询受限则显示 unknown。

默认不允许推送。确需由服务执行时，由操作者设置 `PAPERCLIP_GITLAB_PUBLISH_ENABLED=true`，并确认运行身份可访问指定仓库。工作分支默认仅 `paperclip/` 前缀，可用 `PAPERCLIP_GITLAB_WORK_BRANCH_PREFIXES` 明确调整；不得将默认分支或受保护分支作为源分支。每次 UI 操作再次确认固定 SHA，禁止 force、merge、tag。

推送前核对公司所属 active local_fs 工作区、任务关联、仓库 URL、干净工作树、当前分支/HEAD、base 到 head 祖先关系；推送后读取远端分支确认。未知结果进入 publish_indeterminate，不盲目重推。MR 创建先按源/目标查询，零或一个匹配才可继续，多匹配需人工处理；未知创建持久化为 mr_indeterminate，后续仅在查到已创建 MR 时对账，不自动重复创建。

## 验收与产物

门禁同时要求：审阅 SHA、MR SHA、成功 pipeline SHA、全部成功测试证据 SHA 等于 headSha。旧提交成功不能用于新提交。上游 MR 发生新提交会使已有审阅失效。同步只保存必要的 MR/pipeline 字段，不存完整供应商响应、用户资料或变量。readyForReleaseCandidate 只是当次观测，生产发布始终未授权；发布前需重新同步，不能把缓存当作最新远端状态。

测试证据当前由可信 board 提交，并非平台已自动执行，logRef 不能替代真实日志审阅。本地 fixture 确实执行失败测试、修复、再次测试与新 Git 提交，生成 SHA256 产物清单并校验符号链接不逃逸工作区；GitLab CI 回执为模拟。产物元数据包含平台、架构、签名状态，不把 unsigned 标为 signed。新增 `POST .../coding/:id/artifacts` 在服务端核对工作区 HEAD 并读取实际文件生成清单；接口收到的构建标签不等于构建证明，因此 testStatus=not_run、signatureStatus=unknown，不允许客户端直接宣称签名已验证。清单写入和 artifact_ready 通知同事务；不上传文件。

repairDecision 提供最多两轮、预算、时间和重复错误熔断策略，但尚未接入自动修复调度器；自动只读 CI 轮询已接入，跨平台 Runner 和产物服务上传仍未实现。不得将纯策略测试描述成生产全自动交付。

## 运维与验证

真实本地 HTTP/PostgreSQL 测试覆盖未知 MR 创建不重复、查到既有 MR 对账、固定 SHA 的 CI/审阅门禁及新 SHA 失效。远端 GitLab、生产凭据、真实 Runner、Windows/macOS/ARM 构建及签名未验收。公司权限与任务私有性在 API 入口检查；Agent 不能直接调用 board 管理写接口。

回退先关闭推送开关并暂停人工触发，保留迁移 0336、operationState 和远端对象用于对账，不能删除记录后重建同一个未知操作。

参考：[Merge requests API](https://docs.gitlab.com/api/merge_requests/)、[Pipelines API](https://docs.gitlab.com/api/pipelines/)、[Version API](https://docs.gitlab.com/api/version/)。

## 可恢复的只读轮询

PAPERCLIP_GITLAB_POLL_ENABLED 默认关闭。操作者明确启用后，worker 仅扫描 active 公司的 mr_created 交付，按持久 nextSyncAt 游标读原 MR 与固定 headSha 的 pipeline。每五秒最多处理一个到期项；正常六十秒间隔，失败五分钟退避；MR closed/merged 后停止自动轮询。没有创建 MR、推送、合并、打 tag 或修复派发副作用。

手动同步与 worker 共用九十秒 CAS 租约，所有分页共享三十秒外部读取截止时间。崩溃后过期租约可重领，因为这里只做供应商 GET；迟到结果不能覆盖新租约。写回时重新读取实际审阅/测试证据计算门禁。失败清空最新可信 MR/pipeline 证据并保留脱敏错误码，不把缓存绿色当成当前成功；权限/暂停在新一轮读取前检查。进程内计时器不是唯一游标。

真实隔离 PostgreSQL 夹具验证双 worker 互斥、重启游标、旧租约迟到、失败退避与暂停；供应商为注入夹具，真实 GitLab 仍需联调。自动修复调度没有因此变成已完成。
