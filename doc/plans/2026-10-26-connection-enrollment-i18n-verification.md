# 实际连接注册入口四语补齐

## 范围与边界

- 实际路由 `/apps/connect` → `AppsConnect` → `ConnectionSetupFlow`：补齐一次性 Paperclip 注册、待继续、Cloud 查询失败、授权窗口提示、注册链接缺失、已注册但提供商登录不可用，以及自有 OAuth 应用入口。
- 同一实际 host 的 Composio 账户检查、AI 重连、连接池、已保存连接和记忆连接器门控状态一并补齐；保留既有 `status` / `alert` 语义、按钮行为和布局。
- Header 及其取消/进度 aria 沿用已翻译的生产组件；面包屑改为当前语言。旧 `pages/apps/Connections.tsx` 未挂载的注册 banner 不计入覆盖。
- `connectionEnrollmentUi` 四语贡献独立保存；正式 locale 由集成方统一合成，本切片不修改生成文件、lock 或依赖。
- 本地已知错误保存翻译 key，已有错误在切语言后即时更新；外部错误原文保持字面值。URL 拒绝沿用已有安全验证及 `connectionHandoffUi`，不根据任意外部文本猜测错误类型。
- 提供商/用户名称保留原样并由 React 转义。请求载荷、授权 URL、state/token、sessionStorage key/value、轮询、访问范围、返回路径保持不变；翻译不授予权限或创建连接。

## 自动化与限制

- 在本工作树 `ui/` 使用 `vitest.config.ts`（`@` 指向本树），只读复用现有依赖；单 worker，`NODE_OPTIONS=--max-old-space-size=512`。
- `src/pages/apps/AppsConnect.test.tsx` 为真实生产组件 mounted fixture，非另造状态展示组件；全套同时覆盖现有 enrollment 恢复/授权关联/默认访问测试。
- 新增四语覆盖页面等待请求时切语言、dialog popup 受阻、缺链接、危险 URL、本地 fallback/原始错误、pending、Cloud 查询失败、已注册但不可用，以及入口 loading/alert。
- 检查切语言不重发授权、不改变已保存访问选择或查询次数；授权 URL/state 和 `intent` 返回地址逐字保持；未调用真实外部平台、OAuth 或凭据授权。
- 首次从仓库根目录运行 UI 配置因相对 setupFiles 找不到而未执行测试，改为 `ui/` 后重跑。最终结果见下方追加记录。
- 不运行全仓类型检查/build/DB（按当前磁盘与轻量任务约束）；jsdom 不能证明浏览器真实弹窗、视觉、焦点或窄屏体验。

## 待人工验证（未实测）

只在 fixture/stub 环境，禁止真实 OAuth、凭据或外部平台：

1. 四种语言分别打开 `/apps/connect?source=gmail` 与任务内同一连接 dialog，检查注册说明、入口面包屑、标题、取消、返回及继续按钮。
2. 请求 pending 时切语言，验证按钮仍禁用且不新增请求；返回/取消后不应重新跳转（异步流程防护另片记录）。
3. 模拟 Cloud 查询失败、注册链接缺失、非法 URL、popup 受阻及未知服务端错误；原地切语言后本地文案更新，原始诊断不被改写。
4. popup fallback 链接文字切语言，href、state、token 与安全属性不变；仅 stub 页面可点击。成功只解除注册前置步骤，不应自动扩大访问范围。
5. 已注册但提供商不可用时，不降级到 PAT/自有 OAuth；重试/返回仍由用户明确点击。
6. 中/日/西语在 320/375px、键盘 Tab/Escape、浏览器前进/后退、重复打开/关闭下检查换行、焦点、ARIA 朗读。用户和提供商名称不翻译。
7. Composio、AI 重连、连接池和记忆连接器的 loading/error/disabled fixtures，检查可见文字与 status/alert 一致。

## 本切片最终结果

- 两个定向文件 301/301 通过，其中实际 `AppsConnect` 全套 297 项、四语资源契约 4 项；26 个贡献 key。
- `node scripts/check-token-gates.mjs`、`git diff --check` 通过。已知历史 jsdom `window.open` 提示来自既有 fixture，不发生真实导航；新增外部动作全部 mock。
