# Feedback 私有读取的会话隔离与验收

2026-10-26：补齐已有反馈页的隐私边界，不改变后端授权或增加集成能力。

- 列表、详情、候选、证据分页和推广回执查询键均包含 company/user/session。
- 私有 GET 独立调用 requestResponse，使用 no-store 和 React Query AbortSignal，不经过仅以 URL 为键的并发合并。取消后即使底层 fetch 返回也丢弃结果。
- 私有查询 staleTime/gcTime 为 0；认证重新检查期间卸载页面，数据重新检查期间隐藏旧内容和操作。
- 推广状态读取失败优先显示错误，清除本地回执与确认；不得以缓存回执覆盖 401/403。未知写入的冻结请求 ID 不因临时读取错误重置。
- 保留已有 local-trusted 浏览/手工导入行为；无真实用户仍不提供推广确认，不引入新的授权回退。

## 已运行的窄测试

在 ui 目录运行，单 worker、512 MB：

```sh
NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run \
  src/pages/MimouseFeedback.test.tsx src/api/private-feedback.test.ts --maxWorkers=1
```

测试点：同用户更换 session 时不显示温缓存；旧 session 未完成响应不能填入新会话；同 URL 的两个真实 API 调用不共享 fetch；取消后的延迟响应丢弃；推广回执（缓存或本地写入返回）遇到 401/403 不再显示；现有本地隐式访问、语言切换、未知写入按原 ID 重试保持通过。

## 人工复验

1. 同用户轮换 session，同时撤销目标公司权限：等待认证重新检查，原列表、详情和私有任务链接不得继续显示；网络面板应出现独立的新读取。
2. 延迟旧会话反馈 GET，切换公司/用户/session 后再释放响应：新页面不得显示旧标题、文本或回执。
3. 已显示推广回执后令推广查询返回 403：链接和 request ID 消失；恢复访问但服务器返回无回执时，本地旧回执不得复现。
4. local-trusted 模式仍可按原后端授权浏览和手工导入，但不能获得真实用户推广确认或 WeCom 会话授权。

此改动未运行数据库、真实账号、网络集成或浏览器 E2E；纯测试不等于真实租户撤权验收。未引入后台持续权限轮询：边界在已发生的认证/数据重新检查和会话切换时执行。
