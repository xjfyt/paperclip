# 连接注册迟到响应与重复点击修复

## 复现与影响

在真实 `ConnectionSetupFlow` mounted fixture（页面与 dialog 两种 host）中，修复前 21 项回归用例全部失败：

- Back、Cancel、卸载、公司/provider/intent/Agent 切换，以及账户/session 更换或退出后，旧注册 POST 的成功回调仍执行顶层导航或给旧 popup 分配授权 URL。
- 同一事件轮内两次点击在 React pending 状态提交前发出两次注册请求。

该问题与四语翻译分开提交；不将翻译验收冒充原有异步安全已经通过。

## 有界修复

- 每次注册请求绑定当前 UI 意图（company、provider、host、credentialSource、intent、Agent、resume/reconnect、步骤、身份/访问选择）及既有 auth cache 的账户/session 指纹。
- 进入 mutation 前同步设置 pending 标记，重复点击只产生一份既有 payload。company label、returnTo 在点击时快照；不改变服务端参数、URL、state/token 或 sessionStorage 访问选择协议。
- Back/Cancel/卸载/上下文更换使该 UI 意图失效；只关闭本次预留窗口、清理本地授权链接，不让旧成功或失败覆盖新流程。旧请求结束也不能关闭新请求的 popup 或解锁新请求的 pending 状态。
- 只订阅已有 auth query cache，不新增会话读取、OAuth 或其他网络请求；同一 user/session 的普通资料刷新不作新身份。明确会话失效、更换、退出则废弃旧 UI 响应。
- dialog 的注册轮询仍使用原 2 秒间隔；Back 后的 active 结果不再刷新 gallery 推进旧流程。正常注册成功仍仅更新前置条件，后续提供商授权/权限选择保持原行为。
- **不取消服务端 enrollment、不撤销外部授权、不清除远端状态。** 已打开的外部页面是否完成授权，不由本地 UI cleanup 证明；需要时仍由用户在提供商侧检查。

## 最终验证

- `ui/` 下 `NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run --config vitest.config.ts src/i18n/connection-enrollment-messages.test.ts src/pages/apps/AppsConnect.test.tsx src/features/connections/ConnectionSetupFlow.oauth.test.ts src/features/connections/ConnectionSetupFlow.architecture.test.ts --maxWorkers=1`：4 文件 344/344 通过。
- 原 21 项红测已转绿；另有旧请求成功/失败不能影响新 popup、同 session 刷新、Back 后 active 结果不能推进等 3 项补充测试。
- 全部授权、popup、API 与导航均为 fixture/mock。既有 jsdom `window.open` 提示不表示发生真实外部访问。
- `node scripts/check-token-gates.mjs`、`git diff --check` 通过。按资源约束未运行全仓 types/build/DB；未做真实 OAuth 或浏览器视觉验收。

## 待浏览器人工验收（仅 stub 环境）

- 延迟注册响应，在页面和任务 dialog 分别 Back、Cancel/Escape、切公司、切 provider/任务后再释放响应；不重开或导航，旧错误不覆盖新界面。
- 同事件快速双击、请求失败后明确重试；每次明确新意图仅一份请求，不能因为旧 pending 锁永久卡住新入口。
- 开启第二次请求后再释放第一次成功/失败；第二个窗口与按钮 pending 保持，最终只使用第二份授权地址。
- 同账户普通刷新继续有效；明确退出/换账户/换 session 后只废弃旧 UI 回调，不把 cleanup 描述为远端撤销。
- stub popup 完成、手动关闭、popup 被浏览器阻止与跨源窗口行为，仍需实际浏览器验证；不会为验证接入真实平台或凭据。
