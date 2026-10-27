# Exact-job 观测接线与不可变历史（2026-10-27）

## 范围
- 把现有 exact-job observer 接到已认证 delivery；本地保存最小历史，不上传/执行归档，不调用模型或通知。
- `admission` 永远 `blocked`。不改旧 matrix、`signatureVerified`、交付 gate；GitLab job 成功不代表平台/测试通过。
- 真实 GitLab 联调、可信 controller 采集、有效工作流闭包、代码签名、平台/测试与 C3 仍未闭环。

## 运维入口（默认关闭）
- 只有服务器 `PAPERCLIP_BUILD_OBSERVATIONS_ENABLED=true` 与 `PAPERCLIP_BUILD_OBSERVATIONS_CONFIG_FILE` 指定配置；API 不接收文件、URL、策略、凭据或产物摘要。
- 配置是规范绝对路径的 regular file，最多 128 KiB、32 profiles、每公司最多 8 profiles；严格 UTF-8/JSON/重复键/整数词法/深度/未知字段校验。每次边界重读，不缓存旧策略。
- JSON 顶层为 `{schemaVersion:1,profiles:[...]}`。每个 profile 显式包含 `id,companyId,observer,manifestPath,subjectName,maxObservationAgeSeconds,provenancePolicy`；observer 沿用 exact-job 合同，`provenancePolicy:null` 允许仅字节观测，不意味着可信签名。
- 运维必须控制配置文件及父目录、放在工作区之外；`O_NOFOLLOW` 仅限制最后路径分量，**不证明 OS 隔离**。多实例须使用相同来源和规范路径约定。私有 digest 覆盖规范路径 SHA 与配置内容；不返回原路径。重复读文件并非文件更换与 DB 提交的原子撤销协议。
- 复用 delivery 的公司级 active `local_encrypted` secret 当前明确版本。完整 secret 内容 SHA 匹配后，仅接受现有格式单字段 `{"token":"..."}`；最多 32 KiB，token 为 1–4096 可见 ASCII。额外/重复字段、非字符串或非法字符拒绝。外部 secret provider 首片不支持。

## 身份与时间
- 当前持久 session、active 公司 owner/admin 与任务隐私许可均从 DB 重验；不采用缓存角色、不支持 agent/local-implicit 或测试 header。
- 绑定 delivery 的 company/issue/workspace/project/origin/pipeline/head/sourceBranch、完整当前 manifest、唯一选定产物、config digest 与 secret 版本/内容摘要。不比较 secret `updatedAt`，因为正常 resolve 会写访问时间。
- exact job ID 由用户选择；pipeline 来自 delivery，文件路径来自 profile，预期大小/hash 来自服务器原先计算的 manifest。每次实际 HTTP 前和落库前复核，HTTP 不持有 DB 锁。
- 保留原始 observedAt、verifiedAt、signed startedOn/finishedOn；新请求时间不是新构建时间。buildNotBefore 从运维允许年龄窗口计算，不使用 delivery 创建时间。历史年龄沿用 verifier 的 **startedOn**，不是 finishedOn。
- currentness 只比较本地当前绑定/时间，不证明远端仍可用。策略任一 key 到期/撤销会保守标 stale，即使不是当时使用的 key。配置或当前身份无法解析时标 unknown，不自动刷新旧签名。

## API、持久化与恢复
- delivery 下 `GET build-observations/context` 返回可选 profile/expectedBinding；`POST build-observations` 仅收 `{requestId,profileId,jobId,expectedBinding}`；history、`requests/current`（company+actor+delivery 最新请求及安全原输入）和 `requests/:requestId` GET 不触发网络/secret resolve/重放写入。
- 0360 新增 requests 租约表与 receipts 历史表；公司+delivery 复合 FK、公司级 requestId 唯一、每请求最多一回执、result 限 16 KiB、admission DB 约束 blocked。回执 UPDATE 被 trigger 拒绝，无 DELETE trigger 或删除 API。
- DB clock 控制 45 秒租约、5 分钟显式重试窗口、最多两次尝试；公司 advisory lock 限每公司一个有效执行、每小时十个新逻辑请求。现 observer 总 HTTP deadline 最大 30 秒，产物 64 MiB/envelope 96 KiB 硬流限。
- 相同 requestId/actor/body：执行中 202；完成后返回原回执，不重验网络、不追加审计、不更新时间。不同内容 409。过期租约只在显式相同请求重试时接管；旧执行者不能越过 fence 写回。GET 可恢复丢失响应，浏览器重载/身份切换后只 GET current 找回请求 ID，不自动重试 POST。
- 落库时失权/绑定变化丢弃收到的证据，仅以空诊断关闭仍持有的租约；响应前再次授权。不得把失败诊断、raw response、原始 envelope、token 或 policy/key 内容返回调用者。
- UI 默认折叠、展开后仅读取；明确展示“观测不等于准入”，无绿灯/轮询。POST 不确定时保留 requestId，显式 GET 恢复；只有 retryable 才可手动同 body 重试。

## 验证与既有债务
- Fixtures 使用独占 `/tmp` owned PostgreSQL、正常全部迁移、真实持久 session/会员/任务及 JSON secret 合同；只注入假 HTTP/secret resolver，不注册真实访问。类型/测试入口显式指向本分支 DB/shared 源码。
- Drizzle 在隔离 `/tmp` 输出目录从 0359 snapshot/journal 和本分支完整 schema 正常生成 0360；既有表/其他 schema 无变化。新表/约束/索引/FK 与 SQL 等价；SQL 保留 unique-index 先于复合 FK 的顺序及自定义 immutable UPDATE guard。
- 新两表随 delivery/company 关系级联清理，不增加 DELETE 封锁。旧 `company-deletion.ts` 先删 companySecrets，但旧 delivery 的 secret FK 尚在，属于既有清理债务；本片不宣称整个 coding 公司清理流程已闭环。

## 未确认写入的跨重挂载恢复补强
- 每次 POST 前把四字段安全输入持久化到浏览器 pending journal 并回读校验，按 company/user/delivery 稳定隔离；session、authEpoch、head 变化只取消展示/请求，不遗忘未确认 ID。每 ID 独立 key，不保存 token、policy、artifact/envelope 原文。读写/回读异常阻止 POST。
- 有 journal 时优先精确 GET 原 ID；current/latest 的 null、其他旧终态、403/404、expired/interrupted 都不构成“未发生”证明，也不清 journal 或自动创建新 ID。只有同 ID/input/delivery 的 durable terminal 才校验删除；多个未决逐项恢复。
- 显式二步确认 `POST requests/:requestId/close-unknown`，严格原四字段＋`confirmClose:true`，path/body ID 一致；fresh session/当前管理员/任务隐私与 start 相同公司 advisory 锁。missing 写空 terminal negative marker，live lease 返回 409，expired 清 fence 并写空回执；重复关闭不增审计。仍沿用 DB clock 新请求额度。
- 该 marker **仅阻止今后同 ID 派发**，不证明早先请求未发生，也不取消任何 CI/远端动作。feature OFF、配置漂移、公司暂停仍可关闭；paused 只开放已授权本地 metadata/close，不开放新观测外发。getter 不执行关闭写入。
- 浏览器存储可能被用户/外部程序清除或丢失，且不是跨标签页原子锁；本机制不声称绝对 exactly-once。服务器当前请求入口只是辅助发现，不可覆盖已知未决 journal。
