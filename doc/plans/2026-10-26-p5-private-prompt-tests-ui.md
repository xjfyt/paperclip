# P5 私有提示词测试 UI：两阶段授权、恢复与人工验收

## 当前合同与范围

本 UI 使用共享两阶段合同 `31fc549`、所有者绑定补充 `d559fc8`、批准快照 `bb346af`。此文档替代早期
“单 POST 执行／只在内存保留请求”的描述。旧方案已发现自动 auth revalidation 会
丢失未知收费请求身份的问题，不能作为安全上线方案。

注册表选择/回滚仍保持 `runtimeApplied: false`。测试是独立、可能收费的外部模型
执行，不自动选择/提升/发布版本。四语言为 en / zh-CN / es / ja。私有 ACL 不是
Agent、CLI 或文件系统沙箱；不承诺完整模型上下文、provider consumption 或 stdin
written 见证。prepared、spawned、completed 不混为一谈。

仅支持固定版本 `local_encrypted` 公司 `secret_ref` 的 `ANTHROPIC_API_KEY`，
使用 builtin Claude CLI bare、legacy、本地、fresh profile，无 Paperclip token、
runtime tools、MCP、bridge。latest、订阅 OAuth、其他 env、router、extra args、
同名 adapter override、ACP/native、remote、resume 均不回退。

仅接收完整非空 `SKILL.md` 和明确 UTF-8 的非可执行文本快照；不执行技能脚本、
工具、binary 或 assets。只发送 case `input`，不发送 `expected`。literal revision、
固定 skill 文本与 case input 合计最多 **256000 UTF-8 bytes**，超限拒绝，不截断。
前端没有读取技能正文/expected，不用浏览器字符数代替服务端 byte 校验。

## 两阶段 API

基址：`/api/companies/:companyId/prompt-registry`。

1. `GET /test-capabilities`：默认关闭的服务端 gate；页面不能自动开启。
2. `POST /:promptId/tests`：**仅准备元数据，不执行、不调用模型**。body 含 requestId、
   revision/head、Agent、dataset/case、skillVersion、executionProfile，不带三项执行确认。
   返回 `awaiting_confirmation` ticket 及固定 `approvalDigest`。
3. 用户核对 ticket 固定绑定，重新勾选受限 profile、真实执行和可能收费三确认，才调用
   `POST /:promptId/tests/:testId/execute`，body 为 digest/profile/三确认。
4. `POST /:promptId/tests/:testId/cancel` 携带同 digest，仅原子取消尚未执行 ticket。
   执行和取消竞态只能一方推进；客户端不根据网络结果猜测谁赢。
5. `GET /:promptId/tests` 与 `GET /:promptId/tests/:testId` 只读；无自动 POST。

响应由无新增依赖的显式运行时解析器校验：required fields、UUID、64hex digest、
已知状态、固定 profile、false flags、带时区时间、nullable witness/result、嵌套
witness 对齐、结果 JSON 大小/深度/节点数。不会只 `as` 类型后释放收费身份。

prepare 回执展示的是服务端持久化的 `approvalSnapshot`，不是当前 Agent 查询结果：
model、CLI/builtin、configuredCwd、本机环境 source/id、固定 company secret 引用及版本、
configDigest、fresh/禁工具/禁 Paperclip 凭据/非完整上下文均可核对。严格拒绝摘要中
夹带 env 映射、凭据值或未知字段。历史 null 摘要只读，禁止授权执行；不凭当前 Agent
配置“补齐”旧快照。`configuredCwd` 仅为配置工作目录；null显示“运行时解析，尚未确定”。
实际执行目录由核心 executionWorkspace 在运行时解析，不能称prepare已锁定实际目录；
effective local environment ID/source只是已知目标，不是完整context。journal 不保存整个快照，固定 approvalDigest 由服务端覆盖它。

## 同标签页非秘密 pending journal

- 同步写入 `sessionStorage` 并读回完全一致后才允许 POST；写失败/读回不一致，
  **零 execute 请求**。prepare 同样记账，但未知 prepare 本身不收费。
- key 按 company/user 隔离。严格字段白名单只保留版本号、原 session 标识、
  operationId、test/request/digest、UUID refs/head、profile、阶段；无正文、凭据、
  私有结果、summary 或任意配置内容。
- controller 稳定在 owner/company 层，不依赖 revision/head 选中状态。auth 后台
  revalidation 隐藏私有展示、禁止操作并失效旧 HTTP epoch，但不删除 journal；
  新 session/epoch 清空展示/checkbox，并以新权限 GET 重验。不同用户/公司不读取
  或重放别人的 marker；切回原 scope 仍只 GET，不自动执行。
- 每次显式 POST 尝试先 CAS 写新的 operationId；旧响应不能修改/清除更新的 marker。
- 所有 HTTP 错误（包括 400/401/403/404/409/422）、畸形200、错误绑定都保留 marker。
  401/403 只隐藏内容、清草稿与确认，不删未知操作身份。
- GET `awaiting_confirmation` **不能证明迟到 execute 不存在**。execute_pending 只能
  显式重试同 test/digest（重新三确认）或原子 cancel；cancel_pending 只重试 cancel。
- 已确认 pending_harness/pending_wake/queued/prepared/spawned 记作 accepted。
  queued/prepared/spawned 之后只 GET；pending_harness/pending_wake 可重新三确认后显式
  “继续同一执行准入”，只携带原 testId/digest 恢复同一 fence，不 prepare、不新建 attempt。`unknown` 永不自动重跑且保留 marker。
- 对已知票据或可能收费阶段，仅 schema 合法、所有者及全部固定绑定一致的 completed/failed/cancelled 终态才
  CAS 清除；后端合同保证终态不被迟到 execute 重新推进。失败也不是重新收费的理由。
- 保证范围是**当前标签页正常刷新/卸载**。不承诺关 tab、清 storage、另一标签页、
  用户主动篡改浏览器存储或跨设备恢复。现有 owner 历史可显式查看，但不自动执行。

## 验证记录与限制

两阶段补丁使用 512 MB heap、单 worker，五文件 **82 tests passed / 5 files passed**：

- `api/private-prompt-tests.test.ts`：独立私有 fetch/no-store、abort、分离prepare/execute/
  cancel、畸形200、required/nested shape/结果大小负例。
- `lib/private-prompt-journal.test.ts`：strict非秘密字段、scope隔离、operationId CAS、
  全部绑定错配、损坏存储 fail-closed。
- `pages/PrivatePromptTests.test.tsx`：两阶段三确认、unknown同key、所有HTTP错误、
  session/head/revision恢复、auth revalidation迟到POST、storage失败/读回失败零execute、
  旧响应不得清新marker、取消竞态、unknown与终态、StrictMode、真实Registry host+authEpoch组合、旧epoch写锁、pending准入恢复、固定审批快照及四语言。
- 原 `MimousePromptRegistry.test.tsx` 与 `MimousePromptRegistryPage.test.tsx` 回归。

`git diff --check` clean；token gates 1285 文件 clean。首次测试因 UI 未声明 zod 而
加载失败，随后移除该依赖，改为显式窄解析器并重新通过，没有新增/安装依赖。
未运行真实浏览器视觉测试、真实后端/DB E2E、全量 typecheck/build、真实模型/CLI或
外部请求。本记录只证明 UI/mock 边界，不代替后端唯一执行 fence、迁移或真人验收。
中央集成必须生成正式 locale、类型检查并完成独立安全审阅。

## 人工验收清单

1. 用真人 active owner/admin session 打开页面；默认 gate 关闭；打开/读取/切语言不会
   创建收费执行。准备 ticket 后检查没有 wake、spawn、模型请求或费用。
2. 使用隔离本地无网络 fixture，核对 ticket 的固定引用/digest，再三确认 Execute；
   检查 prepare 与 execute 是两个接口，execute 前 sessionStorage marker 已存在且不含秘密。
3. 在 execute 已发但响应断开时刷新、切窗口触发 auth refetch、同用户重登录、切 head/
   revision。新画面恢复同 ticket，原 UUID refs/digest 不变，无自动 POST、无新收费意图。
4. 逐一注入 400/401/403/404/409/422/500、空200、错误 request/test/digest/owner/refs。
   marker不能清；403内容隐藏。存储禁用/配额失败/读回不一致必须零 execute。
5. 让迟到 Execute 与 cancel 竞态。GET awaiting不能解锁新执行；cancel成功才显示取消。
   若执行已被接纳则只显示原ticket状态并GET，不能在“取消失败”后新建收费执行。
6. 改变同scope marker 的operationId，再送旧200；旧响应不能清新marker。unknown保留；
   完整匹配终态才清理。切其他user/company看不到原scope结果，切回重新授权读取。
7. 用 `<script>`/HTML 结果验证纯文本。复核非 UTF-8、缺失/空SKILL.md、可执行/binary/
   assets、256000 bytes边界及超限；非法输入零dispatch、超限不截断、stdin无expected。
8. 四语言、窄屏、键盘焦点检查；清空在左、准备在右。清空表单不代表取消执行；
   cancel仅取消尚未执行ticket，不是正在运行的进程终止按钮。
9. 真实CLI/API-key/费用/进程树仅由用户另行授权后人工验收。本地mock成功不构成真实
   账号验证，也不授权订阅切换API计费。

### CLI 安装并非 prepare 检测项

执行的固定PATH及人工安装前置见[服务端手册](2026-10-26-p5-private-prompt-tests.md#真实-cli-发现前置未由-node-夹具证明)。prepare仅准备固定元数据，不代表本机已能发现claude或其Node依赖；默认用户目录安装可能不在受限PATH内。本轮没有用真实CLI/账号证明安装成功，不自动继承环境补救，也不自动重试未知执行。

## 输入更正与仅元数据准备的显式放弃

新准备的4个UUID输入按UUID语义规范小写；旧journal与重试body保留原字节拼写，因为服务端requestDigest绑定原body。经过严格格式校验的UUID绑定比较忽略字母大小写，actor/session/hash/操作CAS仍严格比较。

当用户填错引用，准备请求可能404/422，或网络结果未知。仅当journal为prepare_pending且testId、approvalDigest都为null，当前身份已验证且无正在进行的请求时，用户可显式选择“放弃本地准备并编辑”。同步重新读取storage，复核owner/company、phase、空票据字段和operationId后才删除本地marker；存储失败仍锁定。动作不发POST，不生成新requestId，不宣称服务器票据被取消。之后另一次用户主动准备才生成新ID；服务器可能保留一张从未授权执行的历史票据。

安全依据是prepare接口从不执行/唤醒，不是错误码能证明服务端没有写入。execute_pending、cancel_pending、accepted及任何已知ticket均不允许此出口；不能用它清除未知收费执行。人工验收增加：错误但格式合法UUID→准备被拒绝→显式本地放弃→编辑正确大写UUID→新准备成功；确认无自动执行，新旧请求不混用、旧迟到响应不复活marker。
