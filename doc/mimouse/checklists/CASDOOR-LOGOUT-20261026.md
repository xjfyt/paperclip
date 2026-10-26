# Casdoor 注销失败提示验收（2026-10-26）

范围：原计划 §5.4 的“Casdoor 不可用时本地仍退出，并说明全局退出未确认”。本次只有纯函数/API mock/React DOM 测试；没有运行真实浏览器、认证服务、数据库或外网请求。现有本地 IdP 浏览器记录不证明下列真实 Casdoor 场景通过。

## 已实现的边界

- 本地 `POST /api/auth/sign-out` 明确返回 `success:true` 后才记提示并重置账户查询；health 刷新不阻塞完成。实际请求失败、空/错误 JSON 或缺失/false success 不虚报成功，不清原账户缓存。
- 仍使用已验证的服务端 IdP URL 与既有顶层跳转；不增加弹窗、自动重试或 IdP 探测。导航抛错仅意味着全局结果未知，不撤销本地成功。
- 同标签页 `sessionStorage` 只有 `paperclip.local-sign-out=local-complete-global-unconfirmed`；无账号、URL、token、cookie 或回调数据。存储受限时只有内存降级，不能保证离开文档后的提示恢复。
- `/auth` 正常、加载、health/session/capabilities 失败均可显示提示；退出后 gate 检查失败也显示。刷新/返回仍保留，关闭提示或新的已确认登录才清理。它不作为权限依据。
- **浏览器自己显示的 IdP 网络错误页不是本站页面，不能展示本站文案。返回本站后才显示。** 页面不能凭“成功跳转”“返回 URL”“任意 query 参数”确认 IdP 全局退出；UI 没有全局成功态。
- Cloud 仍直接 `/cloud/logout`，不调用本地 sign-out、不清 Cloud 缓存、不写新提示。注册、显式绑定和成员授权不变。

## 人工测试（全部待执行）

请在有授权的独立测试实例/测试 Casdoor 应用与虚构身份上执行，不停用生产 Casdoor，不改生产 DNS/代理，不关闭 TLS/鉴权。先验证 dual 恢复账号可用，再测试 sso-only。只记录脱敏截图、HTTP 状态与是否已登录；不要保存完整 IdP URL、响应体、cookie、ID token 或浏览器存储导出。

| 场景 | 操作 | 预期与需记录证据 |
| --- | --- | --- |
| Casdoor 退出端点不可达 | 正常 SSO 登录后，仅对测试浏览器阻断测试 IdP 的 logout 目标，保留本站 API 可达；点击退出 | 本地请求 success:true；旧账户缓存清除；浏览器可能进入自己的网络错误页。返回本站 `/auth` 后显示本地已退出/全局未确认；本站 session 为空或401。不要仅凭登录页判定全局已退出。 |
| IdP 正常返回 | 恢复测试 IdP 后重新登录并退出 | 仍实际到达合法退出端点；回到本站仍提示全局未确认。另由授权测试人员独立核验 Casdoor 会话，本站不自行宣称成功。 |
| 本站退出失败/离线 | 保持已登录，将本站 sign-out 请求阻断或用受控测试代理返回失败，然后退出 | 展示既有退出失败信息，不写成功提示、不清账户缓存、不发起 IdP 跳转。恢复后可手动重试，不自动重放。 |
| 退出后本站健康检查失败 | 本地 sign-out 成功后使测试 health 检查失败 | 本地成功提示仍可见，同时保留现有连接/登录检查错误，不能把两种结果混成退出失败。 |
| 返回、刷新、关闭提示 | 完成一次本地退出，返回、刷新、前进/后退，再关闭提示后刷新 | 同标签页提示持续且不变成全局成功；关闭后不再显示、不发外部请求。 |
| 重新登录 | 从提示页完成密码/SSO登录；另测SSO直接回公司路径 | 新会话被确认后清理旧提示；再次退出产生新提示。未完成/失败的登录不提前清除。 |
| 禁止浏览器存储 | 测试环境禁止 sessionStorage 或模拟配额错误，再退出 | 本地退出仍成功；当前文档提示可用，不承诺跨页面保留。没有把秘密或 URL 改存到 localStorage。 |
| query 不可信 | 无提示状态访问 `/auth?logout=success&global_logout=success`；有提示时重复 | 无状态不伪造本地成功；已有提示仍为全局未确认，不据参数解除或升级。 |
| Cloud 与四语 | Cloud 测试租户退出；自托管分别切中/英/西/日，含移动窄屏及键盘关闭 | Cloud 原路径与缓存行为不变；四语完整、无原始 key、长句不裁切，状态区可读，关闭按钮可操作。 |

## 自动验证

集中测试覆盖本地成功/失败、账户缓存观察者、health挂起/拒绝、IdP导航抛错/无确认返回、响应验证与URL限制、同标签页回访/关闭/确认新会话、四语文案、Cloud不写提示。9文件132项通过，使用既有依赖、512MB、单worker：

```sh
cd ui
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run --config vitest.config.ts \
  src/hooks/useSignOut.test.tsx src/pages/Auth.test.tsx src/api/auth.test.ts \
  src/lib/local-sign-out-notice.test.ts src/components/CloudAccessGate.test.tsx \
  src/components/SidebarAccountMenu.test.tsx src/components/InviteAuthMethods.test.tsx \
  src/lib/oidc-navigation.test.ts src/lib/browserNavigation.test.ts --maxWorkers=1
```

`git diff --check`、`check-token-gates`、`sync-agent-palette-tokens --check`、`sync-cliplab-character --check`通过。首次启动验证因配置路径重复及worktree缺UI依赖链接未执行测试，修正命令并只复用现有依赖symlink后重跑通过，没有安装依赖。生成locale未改，由中央集成者compose后复验。

全量类型检查/构建、真实Casdoor全局注销/停用与浏览器故障实证仍需单独执行，不能由上述mock结果升级为通过。
