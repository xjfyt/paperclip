# P5 私有提示词执行测试（设计审阅中）

本文件描述拟实施合同，不是功能已完成或测试已通过的证明。注册表选择仍为
`runtimeApplied: false`，成本路由预览仍全部 blocked；测试结果不自动提升版本。

## 范围与事实

仅支持当前选中的服务端 builtin Claude 实例、legacy runtime、显式 CLI engine、
local execution target、fresh session。外部同名 override、未知 adapter fallback、
ACP/native/remote、resume/warm/recovery 或配置漂移均 unsupported，不回退。
精确 UTF-8 revision（含前后空白与 `{{...}}`）仅在内存进入独立 literal section，
不把原文写入 issue description、模板、context snapshot 或 activity。

当前源码的 skill test 创建仅保存配置快照，并不使快照成为运行配置；旧结果还会
被复制到 Skills Studio 可读的 outputSnapshot。本片使用专用私有 intent/result，
不借旧 skill-test 结果读面扩展权限。固定 skill version 复用受核验的文件清单，
不追随新 head/selection。

## 拟新增接口与数据

- `POST /api/companies/:companyId/prompt-registry/:promptId/tests`：requestId、
  revisionId、expectedHeadReceiptId、agentId、datasetId、caseId、skillVersionId，
  独立明确执行和可能收费确认。不能接收 raw body、context、heartbeat ID 或 witness。
- `GET .../:promptId/tests/:testId`：当前有效真人 session + active 公司 owner/admin
  且测试所属发起者/既定私有 ACL；no-store，错误仅固定 code。
- 专用 intent 表绑定公司、actor/session、精确批准 payload digest、revision/content hash、
  dataset/hash/case、skillVersion、无 secret 原文的配置摘要、issue/wake/run/attempt。
- 状态：pending_harness → pending_wake → queued → prepared → spawned → completed；
  failed/unknown 不自动重跑。唯一 request、issue、wake、attempt fence 必须由 DB 强制。
- prepared witness：实际最终 prompt 的 SHA-256、UTF-8 byte length、implementation
  identity/version、所有绑定 ID。它不是 spawn、stdin_written 或 provider consumed。

## 核心接缝

1. 创建事务重查 session、user、active owner/admin、company/agent/resource，保留
   skills.test 和 tasks:assign。使用 issues.create 的 private personal project 与 ACL。
2. 核心 heartbeat queue 用 reserved key 的 DB 唯一 fence 和队列事务关联；普通
   wake 不得伪造标记。未知响应同 request 恢复，不另建 intent。
3. 最终 adapter.execute 前重查实际选择的同一 builtin 对象与全部执行合同，server
   从持久绑定取正文，不信 caller context。prepared 写失败必须在 spawn 前阻断。
4. Claude 拼好最终 prompt 后持久 prepared，再把同一变量传 stdin。现有 onSpawn
   callback 失败被 process helper 捕获并继续 stdin，不能把它误当强持久化保证。
5. 私有执行的 onMeta/onLog/onEvent/result/summary/errors/live stream 全部需专用
   出口或固定安全摘要；不得只在一个 adapter.invoke 点遮罩。

## 待确认的安全合同

- completed 是否仅提供私有 resultJson/summary，舍弃 stdout/stderr 完整 transcript。
- Paperclip bearer/runtime tools/MCP/bridge 能让模型主动将原文写回普通 issue API；
  只遮罩 stdout 无法阻止该路径。是否明确首片关闭这些通道并绑定到批准配置。
- 本片不承诺完整 instructions/tools/MCP/env/provider hidden context 的捕获，也不把
  OS/CLI 自身日志/会话文件当作已隔离；真实账号、成本、权限与进程树需人工验收。

## 验收合同（尚未执行）

- 精确 literal 与本地无网络 fixture 子进程收到的 stdin 字节一致；真实 create →
  唯一 wake → dispatch → 私有 completed。禁止本环境调用真实模型、CLI 账号或外网。
- override/fallback/unsupported/config drift/撤权/跨公司资源拒绝，零 dispatch。
- 并发相同 key、创建与 wake 未知响应恢复、取消/重启/多 attempt 不重复运行。
- witness 写失败零 dispatch；spawn 失败保留 prepared-only，结果未知不自动再跑。
- 普通 issue、activity、run events、log、live、旧 Studio 列表不含原文/回显。
- 私有 ACL、旧未知数据兼容、原普通 skill test API 行为不变。

正式迁移、生成 locale、全套检查由中央集成。每个代码提交保持小于 1000 非生成行；
独立安全审阅通过前不标记可上线，不推送。

## 审阅确认后的进一步收窄（2026-10-26）

仅显式 `claude_cli_bare_api_key_v1`：固定 `claude-*` 模型、`engine: cli`，
`env` 仅允许 `ANTHROPIC_API_KEY` 的 company/local_encrypted secret_ref，必须指定
正整数 version（latest、user secret、订阅 OAuth、其他provider/路由一律不支持）。
配置仅接受 engine/model/cwd/env；额外参数、命令、Chrome、普通工具配置不静默忽略。
批准的是固定 Agent 配置、版本和数据集，不是预先批准完整派生 context。

builtin 的受限分支复用既有 process helper，但不经过普通 CLI config builder。
固定 bare、空 tools、禁用全部工具/MCP、禁 slash commands、空 strict MCP、禁 Chrome、
禁会话持久化；不传 --add-dir、普通 instructions、Paperclip authToken、runtimeTools、
runtimeMcp 或 bridge。子进程仅接固定 API key、临时 HOME/CLAUDE_CONFIG_DIR；
process helper 的 `inheritEnv:false` 禁止继承服务端/Paperclip/Git 凭据，remote拒绝该选项。

官方依据（2026-10-26 查阅，未运行真实 CLI）：
- [CLI reference](https://code.claude.com/docs/en/cli-reference)：空 `--tools` 禁内置工具但不禁 MCP；
  另用 deny rule；严格 MCP、禁 slash command/Chrome/session persistence 均有独立开关。
- [Headless / bare mode](https://code.claude.com/docs/en/headless)：bare 不发现普通 hooks、
  plugins、MCP、CLAUDE.md，不读取订阅 OAuth/keychain；API key 是独立的收费授权。
  文档特别说明旧版本 bare 行为有差异，因此不能当作通用沙箱。
- `--safe-mode` 仍保留 managed hooks，本片不将其作为安全替代。

当前只保证受审 server/builtin 路径不自动传播原文；不是操作系统沙箱，不防恶意
替换的主机 CLI，不声称禁止模型服务处理，也不声称全部隐藏 provider 上下文已捕获。
未识别固定flags的CLI必须失败，不回退普通订阅模式；实际安装版本/受管策略需要用户
在独立测试机器核验后再启用。真实CLI/计费/进程树验证尚未做。

当前原型验证：适配器边界 mock 8项、私有结果边界7项、配置/authority3项、真实本地
无网络 Node 子进程 stdin/env 隔离1项通过。不是端到端创建/queue/DB验收证明。
结果上限128000 UTF-8 bytes、深度16、节点4096；超限标记失败，不截断伪装完整。
completed仅表示有可用CLI success result且受控执行结束，不代表正确/消费/发布通过。
