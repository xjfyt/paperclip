# P5 私有提示词测试 UI：集成与人工验收

## 本提交范围

在已有注册表查看某个 revision 后显示独立的私有执行测试面板，不把提示词原文
传给面板或 POST 请求。原选择/撤销按钮和 `runtimeApplied: false` 合同不变。
顶部说明明确区分“注册表选择不执行”与“测试另行授权会执行”，不再让整个页面
的文字误称绝不执行。四语言为 en / zh-CN / es / ja。

共享合同来自 `449a530` 的 `mimouse-private-prompt-tests.ts`，本提交不修改后端、
共享合同、正式生成 locale、DB 或迁移。后端接口、执行开关及安全检查必须由中央
集成；本 UI 的 mock 测试通过不证明真实模型执行或端到端完成。

## 请求与状态

- API 基址：`/api/companies/:companyId/prompt-registry`。
- `GET /test-capabilities` 读取默认关闭的执行开关与 profile，页面不自动开启开关。
- `GET /:promptId/tests[?beforeId=UUID]` 读取私有历史；分页为 UUID 顺序。
- `POST /:promptId/tests` 固定 revision/head、Agent、dataset/case、skillVersion，
  三项独立确认：受限 profile、真实执行、外部处理及可能收费。无原文/config/context。
- `GET /:promptId/tests/:testId` 读取有界私有结果，按纯文本 `<pre>` 展示。
- prepared 只表示最终 prompt hash；spawned 不证明消费；completed 仅表示该次
  适配器结束并返回可用结果，不等于正确性/消费见证/发布通过。无完整 stdout/stderr。
- 明示仅 builtin Claude CLI bare / API-key / legacy / local / fresh；无 Paperclip
  token、tools、MCP、bridge。订阅登录、override、ACP/native、remote、resume 不回退。
  私有 ACL 不是 Agent/CLI/文件系统沙箱；派生配置只有 hash，不承诺完整上下文。

## 隔离与未知请求

组件按 company/user/session/prompt/revision/head 重新挂载，无全局数据缓存或浏览器
storage；请求经 `requestResponse` + `readApiJson`，不用 URL 合并 GET，每次均 no-store。
AbortSignal 和读 epoch 丢弃迟到响应；重新登录、切公司/用户/版本不复用结果/草稿。
401/403 清除面板草稿与结果，并通知父注册表隐藏原文。其他读取失败也隐藏结果及写控件。

POST 响应未知时冻结精确 payload/requestId，只允许恢复同一请求，并锁住父注册表
所有选择/切换/刷新控件。不会自动执行、重新生成 ID 或提升版本。离开页面有卸载提示；
**SPA 导航或重载不提供跨页面恢复**，没有持久化请求。离开后先检查服务端历史，不能把
网络断开当作未执行再授权。表单“清空”不代表取消已经执行的任务。

## 已运行的窄验证

2026-10-26：512 MB heap、1 worker，以下三个文件 **29 tests passed / 3 files passed**：

- `ui/src/api/private-prompt-tests.test.ts`：实际 fetch 边界（mock）验证同 URL 不合并、
  no-store、abort 迟到结果丢弃、编码路径与显式 POST payload。
- `ui/src/pages/PrivatePromptTests.test.tsx`：三确认、默认 gate 关闭、四语 key parity、
  纯文本结果、unknown 同 key 恢复、company/user/session/revision 隔离、迟到 POST、
  403 与离线 fail-closed、409 不重发、父 registry 在 unknown 时确实冻结/恢复。
- 原 `MimousePromptRegistry.test.tsx`：注册表选择/回退行为回归，独立 mock 新面板。

`node scripts/check-token-gates.mjs`：1285 文件，全部 clean。`git diff --check` clean。
未运行：浏览器视觉检查、真实后端/DB E2E、真实账号/CLI/模型调用、全量 typecheck/build。
没有安装依赖或更改共享 node_modules；仅为本 worktree 的 `ui/node_modules` 添加指向
已有依赖的本地链接。首次根目录测试因该 worktree 根缺少 vitest 依赖未加载测试；
改为从 ui 目录运行后通过。没有将加载失败记为通过。

## 用户拉取后的人工测试点

1. 中央合并后先生成 locale，启动隔离测试实例。用真人 active owner/admin session
   打开注册表，查看一个 revision；确认默认 disabled，打开页面不产生执行请求。
2. 配置受支持 profile 并由运维开启执行 gate。确认外部处理、费用、无工具 profile
   三项均未勾选时不能执行；逐项勾选与修改任一 UUID 后确认状态应清空。
3. 先用本地无网络 fixture 完整走 create → wake → prepared → spawn → completed。
   网络面板检查 POST 无正文，全部私有读 no-store。普通运行日志不应出现正文/回显。
4. 注入 POST 已提交但响应丢失：输入及父 registry 全冻结；“恢复同一请求”使用完全
   相同 ID/body，只能对应一份执行意图。不要把“刷新”做成新执行。
5. 在待处理请求/结果读取期间切公司、换用户、同用户重新登录；旧响应不可出现。
   撤销管理员资格再读取：结果及父 registry 原文隐藏，重新授权也不能恢复旧草稿。
6. 模拟 stale head 409、unsupported 422、网络失败；不自动重发，不显示后台异常正文。
   用 `<script>`/HTML 的 fixture 结果验证纯文本显示，无脚本或 Markdown 执行。
7. 取消、重启、进程失败、结果超限、CLI 返回0但无可用结果由后端 fixture 验证：UI
   如实显示 failed/unknown/cancelled，不显示 completed。unknown 不自动重跑。
8. 切换四语言、窄屏、键盘焦点，核对警告及按钮可见，表单清空在左、授权执行在右。
9. 真实 CLI/账号/外部收费/进程树行为仅由用户另行人工验收；先核准权限与额度，不把
   本提交的 mock 成功当作真实账号验证。没有授权从订阅自动切换 API 计费。
