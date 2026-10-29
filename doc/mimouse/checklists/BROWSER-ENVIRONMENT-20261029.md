# 2026-10-29 真实浏览器验收：环境阻塞

## 结论

本轮真实浏览器验收为 **blocked / 未执行完成**，不是通过，也不是应用页面失败。不能用 jsdom、APIRequestContext 或生产构建成功代替浏览器证据。

- 标准 server 构建印章为 `8b590bf8f1e0c8752d98dd4c02fd32bab8214d12`；独立标记的临时 PostgreSQL 中已正常启动编译入口与静态 UI。
- 已安装 Chromium 在创建本地 IPC socket 时被环境限制，未打开应用页面。
- 可用的独立浏览器无法连接该执行环境的回环监听；没有把可信本地实例暴露到公网来绕过隔离。
- 官方 Playwright headless-shell 下载地址返回 195 字节的 `text/html` 不可用页面，不是 ZIP。未改用非官方镜像，也未关闭系统安全限制。
- 没有找到可验证的现成兼容 headless-shell。临时 server 和数据库均已正常停止，没有创建真实组织、调用模型或发送通知。

## 仍需实际浏览器验证

1. 空实例可到达主界面，关闭/跳过初始化后不强制配置 Agent；Back/Forward、刷新不陷入引导循环。
2. 创建一次性测试组织而不配置 Agent，进入概览和任务列表；英文、中文、西班牙语、日语切换及刷新持久化。
3. 任务标题、用户正文和原始诊断不被翻译；系统菜单、提示、aria 和错误恢复文案跟随语言。
4. 文档/批注/任务输入的草稿、取消、返回和切语；Windows 中文、日文输入法组合期间 Enter 不误提交。
5. 菜单键盘交互、窄窗和长文案布局；浏览器面板的缩放、尺寸重选与停止操作需在合成会话中验证。

四语浏览器脚本已有 `tests/mimouse/i18n.spec.ts`，但本次没有完成其中任何浏览器用例。该脚本创建合成组织和未分配 Agent 的任务，不验证全部上述场景。

## 在受支持环境复验

先按 [用户验收指南](../USER-ACCEPTANCE.md) 安装依赖并构建 server/UI，在可销毁的本地环境运行，勿连接生产数据库或使用真实 Agent 凭据。以下为 POSIX shell 示例；3100 必须没有其他服务占用。

```sh
pnpm exec playwright install chromium
export PAPERCLIP_MIMOUSE_TEST_HOME="$(mktemp -d "${TMPDIR:-/tmp}/paperclip-browser-acceptance.XXXXXX")"
printf '%s\n' 'paperclip-mimouse-disposable-fixture-v1' > "$PAPERCLIP_MIMOUSE_TEST_HOME/.mimouse-test-fixture"
node tests/mimouse/prepare-disposable-db.mjs
PAPERCLIP_MIMOUSE_TEST_COMPILED=true PAPERCLIP_TEST_POSTGRES_TCP_ONLY=1 \
  pnpm exec playwright test --config tests/mimouse/playwright.config.ts i18n.spec.ts
```

此命令在本轮环境中尚未成功完成浏览器阶段；需要保留实际退出码、截图/trace、完整 Git SHA、浏览器/OS/输入法版本。失败时不要复用未知服务、删除数据库锁或关闭认证来获得绿色结果。
