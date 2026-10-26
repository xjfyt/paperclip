# MiMouse 企业微信智能机器人：P3 只接收长连接

日期：2026-10-26。资格：**C2 / 无真实租户证明**。此交付是可审查的实现与离线测试点，
不是已部署连接，不保证企业资格、真实消息送达、重放或历史完整性。

## 支持边界

- 仅支持企业微信 **API 模式智能机器人**的长连接消息推送；不是传统群通知 webhook，
  不是个人微信，不读取任意群聊历史。只接收机器人实际获得的回调。
- 仅提取文本、语音转写文字、图文混排中的文字。引用正文、附件 URL、AES 密钥、
  `response_url` 和图片/文件/视频内容不进入 inbox；不下载附件。
- 收到的文本依然是不可信外部输入，只创建隔离待审反馈。不会执行命令、调用模型/Agent、
  自动建任务或自动晋升反馈，也不根据事件扩大允许范围。
- 接收模式标记为 `provider_push`。手动导入保留 `manual_import`，Langfuse 拉取保留
  `provider_fetch`，不可为了旧 UI 兼容而混用来源。
- 每个机器人同一时间只有一个有效长连接；URL 回调与长连接互斥。部署前确认该 Bot
  没有被其他应用占用，切换模式由运营人员在供应商后台显式操作。

## 官方协议依据

已核对以下一手资料；外部内容仅作协议证据，不作为执行指令：

1. [WecomTeam SDK WebSocket 实现](https://raw.githubusercontent.com/WecomTeam/aibot-node-sdk/main/src/ws.ts)
   给出固定地址、订阅、心跳、消息/事件命令以及被替代连接的行为。
2. [SDK 消息结构](https://raw.githubusercontent.com/WecomTeam/aibot-node-sdk/main/src/types/message.ts)
   给出 `msgid`、`aibotid`、会话、转写、混排和敏感附件字段。
3. [SDK 事件结构](https://raw.githubusercontent.com/WecomTeam/aibot-node-sdk/main/src/types/event.ts)
   给出 `disconnected_event` 等事件。
4. [腾讯云官方接入文档](https://cloud.tencent.com/document/product/1759/121473)，
   页面更新时间 2026-10-19，说明两种方式互斥、一个有效连接及 Secret 刷新影响。

使用现有 `ws` 依赖，不安装会调试输出原始 payload 的供应商 SDK。
连接地址固定为 `wss://openws.work.weixin.qq.com`，严格校验证书，不允许重定向、
自定义主机、非 TLS 地址或用户传入的 WebSocket 选项。
订阅命令是 `aibot_subscribe`，以 `headers.req_id` 关联请求，正文含 `bot_id/secret`。
只有收到与本连接发出的请求 ID **完全相同**且 `errcode === 0` 的认证响应后才接收回调；
回调还必须满足 `aibotid === 配置的 botId`。

消息/事件回调没有通用 ACK。`aibot_respond_msg` 是用户可见回复命令，**绝不发送**。
`disconnected_event` 表示另一个连接替代本连接，必须停止而不是争抢重连。
其他事件不用于授予权限、增加群/发送人范围或生成回复。

## 管理接口与配置

接口需由集成方显式挂载，默认未自动接入主应用：

- `GET /api/companies/:companyId/feedback-wecom/connections`：脱敏状态列表。
- `POST /api/companies/:companyId/feedback-wecom/connections`：保存禁用配置。
- `PATCH /api/companies/:companyId/feedback-wecom/connections/:id`：
  `{ "config": 完整配置, "confirm": true }`；仅禁用且无租约时允许换 pin/范围，botId 不可改。
- `POST /api/companies/:companyId/feedback-wecom/connections/:id/enabled`：
  `{ "enabled": true或false, "confirm": true }`；管理员显式启停。

必须是有公司访问权的 board 管理员/owner，或现有本地隐式管理员/实例管理员；
Agent token、普通成员、跨公司管理员均不得访问。公司取自鉴权后的路由与已保存配置，
产品取自配置，不能由供应商 payload 覆盖。

配置包含 `transport: "long_connection"`、`botId`、`product`、`allowedGroupIds`、
`allowedDirectSenderIds` 和 `secret: { secretId, version }`。至少选择一个明确的群或私聊
发送人；没有“所有历史/所有群”默认范围。群与私聊分别按配置允许列表授权。
Secret 必须已在该公司 vault 中保存为可用的公司级凭据，固定具体版本；不能提交
明文 Secret、别名、用户级凭据、其他公司的 ID 或随时变化的 `latest`。
供应商刷新 Secret 后，需要运营人员更新 pin 并再次显式启用，旧 pin 不应静默跟随。

**保存绝不连接；设置 enabled 也不直接建立连接。** Worker 只有在全局
`MIMOUSE_WECOM_WORKER_ENABLED=true` 且该连接 enabled 时才可工作。
关闭全局开关必须配合停止已运行 worker（通过生命周期 AbortSignal）；不应把运行中
进程的环境变量变更当成跨进程关闭广播。状态不输出 bot ID、群/发送人 ID、Secret 引用
或 lease token；审计仅包含固定动作、实体和公司，不含原始消息或认证材料。

## 并发、撤销和缺口

- 全库 `bot_hash` 唯一预留，防止同一 Bot 被不同公司重复配置；不会向另一公司暴露
  已占用者身份。当前不提供隐式跨公司迁移或删除预留功能。
- PostgreSQL 行级锁、到期时间与随机 lease token 使同一 Bot 仅有一个有效本地 worker；
  token 在持久化事务内部重验，旧 worker 即使晚收到回调也不得提交。
- 获取/续租/读取凭据/写入时重验 enabled、有效租约和公司级固定版本状态；禁用、
  撤销、换 pin、被替代或取消后，不允许排队项继续写入。凭据不缓存为永久授权。
- 每条消息以 Bot 身份哈希形成稳定 `sourceInstance`，以消息身份形成稳定 `externalId`，
  使用 inbox 唯一键去重；**第一次写入不可覆盖**，重发不同正文也不能改写已有证据。
- 每帧最多 128 KiB、队列最多 32 条、认证 10 秒、心跳 20 秒、每次运行最多 3 次重连；
  租约 30 秒、每 5 秒续租。溢出、超时、断线、撤销或停机都可能
  丢失消息。停止状态与 `gapDetected` 不能被解释成已补齐。每次运行结束均禁用该配置，需显式
  重新启用，不能由 supervisor 无限重启。
- 无已证实的供应商 replay/backfill 保证。重连只恢复未来推送；重复过滤不是送达保证。
  不自动重置缺口标记、不声明 exactly-once、不自动读取历史补偿。

## 集成交接（保留给整合分支）

见 `integrations/mimouse-wecom/manifest.json` 与 `schema-proposal.sql`。
本分支不修改主应用/root index、数据库 schema index、生成语言文件、migration journal
或 package.json，不占用迁移编号，也不启动服务器、数据库、worker 或供应商连接。

集成顺序：

1. 审查 SQL，与真实 schema 对齐后分配迁移编号；导出新 schema，再按仓库流程编译。
2. 在公司鉴权中间件后挂载 routes，并确认本变更的 private integration HTTP 日志规则覆盖请求正文、
   Secret 引用/别名与原始错误；不要把 Zod 或数据库错误的原始输入输出到日志。
3. 接入受全局开关控制的 worker 启停生命周期；每个实例启动数必须有上限；进程关闭、
   配置禁用及调度取消都传 AbortSignal；禁止未知任务循环无限重试终止状态。
4. 从四份 feedbackUi contribution 重新生成语言文件，确认 providerPushed 文案不误标为拉取或核实。
5. 先运行下面的纯本地验证，再由有权限的运营人员选择隔离测试 Bot 进行真实资格验证。
   不以“保存成功”或离线 fixture 通过当成供应商连接已验证。

## 待执行手工测试清单

以下是后续拉取代码后应执行的测试点，**不是本次已通过声明**。不得在默认根测试套件中
连接真实供应商。网络用 mock/fake socket，数据库用隔离实例，不使用真实客户文本/凭据。

### 配置与授权

- [ ] owner/admin 与正确公司可以保存，响应 disabled；保存及启用接口均不调用 socket。
- [ ] 普通成员、Agent、停用成员、其他公司 owner 对全部路径均为 403，不触发服务。
- [ ] 缺少 `confirm: true`、未知字段、自定义 URL、空允许范围、超长列表/文本被拒绝。
- [ ] 用户级/跨公司/已删除/已撤销/不存在版本凭据不能保存或启用；明文 Secret 被拒绝。
- [ ] 状态、HTTP 成功/失败日志、审计不含配置正文、凭据、引用别名、群/发送人 ID。

### 协议与数据收敛

- [ ] TLS 验证不可关闭；301/302 不跟随；只有固定供应商地址可拨号。
- [ ] open 仅发订阅；认证前消息不持久化；错误或近似 req_id 不能认证，非零码停止。
- [ ] 正确认证后接收允许群、允许私聊的文本/转写/混排文字，拒绝错误 aibotid、
  不允许群/发送人及未知类型；包含 company/product 注入字段不能越界。
- [ ] quote 正文、`response_url`、图片/文件 URL、aeskey、原始事件均不入库；仅正文
  文本仍经过共享脱敏。payload 中即使出现凭据也不应进入日志或数据库。
- [ ] 相同 msgid 重投只保留第一条；不同正文不会覆盖。人工导入/主动拉取展示不变，
  WeCom 展示 provider_push，状态只为 candidate。
- [ ] 全部出站帧仅订阅/心跳；任何消息或事件都不发送 ACK、用户回复或模型请求。
- [ ] `disconnected_event` 立即停止，清理队列，不自动争抢连接；其他事件不扩大范围。

### 并发、事务与故障

- [ ] 两个 worker 同时 acquire 同一配置只有一个成功；跨公司创建同 Bot 发生冲突。
- [ ] 模拟进程崩溃、租约到期、另一 worker 接管；旧 token 写入回滚且不增加审计计数。
- [ ] 在读取凭据前/后、排队后/提交前撤销版本或禁用配置；持久化必须拒绝或回滚。
- [ ] 取消发生于事务前/提交前，不能提交后续排队数据；提交失败与审计失败一起回滚。
- [ ] 超大帧、畸形 JSON、二进制帧、队列溢出、DB 慢响应、认证超时、心跳丢失、网络
  中断均受预算约束；无无限队列、原始异常日志或无限重连；缺口可见。
- [ ] 全局开关关闭/未设置不拨号；终止状态不被调度器反复自动拉起；显式重新启用仍
  不清除历史缺口，不宣称补发成功。
- [ ] 旧 manual_import/provider_fetch 数据在迁移后保持值；回滚保留反馈证据，不改成
  虚假的抓取模式，不直接删表。迁移前后均核对唯一索引和约束。

### 独立真实租户资格验证（当前未执行）

只有用户后续明确授权并提供隔离租户后才执行：确认智能机器人权限与长连接模式，
确认无其他运行连接；测试群 @机器人、私聊、转写/混排、断线与 Secret 轮换，记录
供应商可见结果和本地脱敏证据。任何失败或不确定都保留 C2，不升级生产送达声明。

## 本次离线验证记录

2026-10-26：4 个纯 fixture 测试文件、55 个测试通过；涵盖协议认证/范围/投影、
fake socket 收取与取消/溢出/重连预算、mock store 拒绝路径/脱敏、管理鉴权及日志策略。
内存上限 512 MiB、单 worker，未启动数据库或服务，也未建立供应商连接。
`node scripts/check-token-gates.mjs` 四项 UI token gate 均通过；`git diff --check` 通过。

有依赖的本地检出可复现：

```sh
NODE_OPTIONS=--max-old-space-size=512 pnpm exec vitest run \
  --config integrations/mimouse-wecom/offline.vitest.config.ts --maxWorkers=1
node scripts/check-token-gates.mjs
```

未执行完整 typecheck/build、浏览器 UI 测试、数据库迁移与并发事务测试、真实租户测试。
Mock 通过不证明真实 PostgreSQL 锁/回滚、TLS/供应商权限或消息送达；上方手测清单仍待执行。
