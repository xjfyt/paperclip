# 私有集成 HTTP 日志路径脱敏（2026-10-26）

## 修复边界

请求正文及异常脱敏不足以保护误贴到 URL ID 段的内容。私有公司集成日志现在只保留白名单中的静态命名空间，统一输出：

`/api/companies/:companyId/<静态命名空间>/:redacted`

公司 ID、连接/版本/预览 ID、未知或格式错误的尾路径、查询、fragment、absolute-form host 都不输出。请求序列化与成功/失败消息共用该策略；Express 改写 `req.url` 时消息仍按原始 `originalUrl` 分类。不会依赖仅匹配成功后才存在的 route template。原始路径在 URL dot-segment 归一化之前分类。agent-commentary 同样只保留静态前缀；既有 webhook 模板保持不变。普通非私有命名空间行为不变。

涵盖 WeCom、Langfuse、feedback inbox、cost-routing（含 preview）、prompt registry、capability ledger、coding、notifications、data operations、research、skill evaluations、WorkBuddy。

## 自动化与用户复验点

新增 `server/src/__tests__/private-integration-log-paths.test.ts` 使用无效的合成 CANARY 字符串，不接触实际凭据。

- 全部 14 个私有命名空间：200/400/403/404/422/500 的请求序列化、成功/失败消息、错误对象及附加属性均无 canary。
- malformed company/ID/tail、大小写路径、absolute-form URL、编码斜杠、dot-segment、无效 percent encoding、查询值、正文/异常/header canary。
- 消息生成在 Express 改写 URL 后仍不泄露原始 ID。
- 命名空间前缀 lookalike 不误匹配，普通 health 日志仍保留静态路径。

纯单测执行（server 目录，单 worker/512 MB）：

```sh
NODE_OPTIONS=--max-old-space-size=512 pnpm exec vitest run src/__tests__/private-integration-log-paths.test.ts src/__tests__/capability-evidence-log-policy.test.ts src/__tests__/mimouse-log-policy.test.ts src/__tests__/cost-routing-log-policy.test.ts src/__tests__/http-log-policy.test.ts --maxWorkers=1
```

没有启动 HTTP server、数据库、provider 连接或重型 build。父集成/用户可在可丢弃环境中补充真实 pino HTTP 输出验收：仅使用合成 canary，向上述私有路径发送格式错误 ID 的请求，确认完整日志输出（包括 `req.url` 与 `msg`）只含静态命名空间；不使用真实 secret 验证。禁止把“正文已脱敏”当作完整 URL 路径安全的证明。

本切片实际结果：上述 5 个纯测试文件 **52 tests passed**；`git diff --check` 通过。首次从仓库根目录调用 server config 因测试根目录不匹配未发现文件；改从 server 目录执行后通过，不把该次空运行计为验证。未运行真实 HTTP/DB、全量类型检查或 build。
