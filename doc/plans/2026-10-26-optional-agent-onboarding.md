# 可选智能体配置与主界面优先

## 中央集成状态补记（2026-10-26 19:30 UTC）

已合入主分支工作线并生成四语资源；2354阶段完成全UI类型/构建、770文件8665项测试与实际云端浏览器无组织→显式建组织→零智能体Dashboard验证。后续3186阶段全UI分批聚合仍通过。真实浏览器未调用模型，不等于真实供应商或Cloud部署已验证。下文“本分支/父集成待做”仅保留原工作树提交时的历史范围。

统一证据及版本边界见 [VERIFICATION](../mimouse/VERIFICATION.md)。下文早期“未运行/待集成”如无后续限定，指原切片提交时，不覆盖本补记；未提到的实测不作通过推断。


日期：2026-10-26

## 行为与边界

- 无组织：`/`、未带组织前缀的工作页面和旧设置入口显示欢迎页，不自动打开整屏向导，不代建组织、不填默认组织名。
- 组织仍是任务、配置和权限的数据边界；没有组织时不伪造全局任务空间。
- 显式填写组织名并确认后，只创建该组织，用返回的真实组织前缀 `replace` 到 Dashboard。无需配置智能体、凭据、模型、目标或初始任务。
- 有组织但零智能体：Dashboard 可正常停留。显示说明和具备权限时的“配置智能体”；不因查询刷新、页面重挂载或浏览器刷新再次弹窗。
- `/onboarding`、`/:prefix/onboarding` 默认是启动卡；已有组织提供“进入主界面”。`DialogProvider` 初始 route dismissal 为 true，路径变化不再清除它，显式操作仍可重新打开配置。
- 两套 shell（`Layout.tsx`、`Layout.production.tsx`）都不再依据空组织列表调用 `openOnboarding`。
- 显式智能体配置及旧草稿：名称、连接、已就绪步骤均有“稍后配置”；该动作只退出和导航，不调用 agent hire、project/issue create。Back 仍限于本次配置的 entry step。
- Escape 或离开当前路由会使未完成异步 continuation 失效；后到的组织创建结果不夺回页面，未提交的智能体/初始任务动作不继续。已经送到服务器的明确用户操作没有撤销协议，不能宣称被回滚。
- 已有登录、首管理员认领、SSO/邀请及公司权限校验不变。Cloud managed 的 `/companies` 禁止创建规则不变；已知 Cloud 创建地址仍走明确的外部入口，缺少地址时显示原因，不展示无效的创建按钮。

- 创建成功后，在 POST 前捕获的 user/session 对应的公司列表缓存中写入返回组织；先取消旧 GET，并在每次 await 后复核会话和 UI intent，避免旧空列表导致 NotFound/选择清空。
- 后台同会话身份刷新先等待确认；失败时保留已成功创建的结果，给出“重试打开主界面”，只重试打开，不再 POST 创建。不同账号/会话的后到结果不写入新账号缓存、不导航。
- 明确 New Organization 意图与旧草稿恢复分离，清掉旧组织 ID；旧组织草稿不能偷换新组织名或直接跳回旧公司。

## 集成

新增独立域 `ui/src/i18n/contributions/optionalOnboarding/{en,zh-CN,es,ja}.json`（13 keys）。本分支**不修改生成 locales**。父集成在主树冻结结束后运行：

```sh
node scripts/compose-mimouse-locales.mjs
node scripts/compose-mimouse-locales.mjs --check
```

测试通过专用 `optional-onboarding-test-resources.ts` 注入这四份贡献，不绕开运行时的标准 composition。测试 helper 不被产品入口引用。

## 低资源自动验证

在 `ui/` 运行指定文件，单 worker、512 MB Node heap；不安装依赖、不启 DB、不启动真实模型：

```sh
NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run --maxWorkers=1 \
  src/lib/onboarding-route.test.ts src/lib/optional-onboarding-entry.test.ts src/api/companies-created-cache.test.ts \
  src/api/companies-query.test.ts src/context/CompanyContext.test.tsx \
  src/context/DialogContext.onboarding.test.tsx src/pages/Dashboard.onboarding.test.tsx \
  src/components/OnboardingWizard.test.tsx src/components/OnboardingWizard.step.test.tsx \
  src/components/OnboardingWizard.adapters.test.tsx src/components/OnboardingWizard.company-integration.test.tsx \
  src/App.onboarding-launcher.test.tsx src/App.test.tsx
```

最终执行：13 files / 234 tests 全部通过；三个 token 检查通过，四语 13 keys/占位符/安全内容校验通过。

覆盖：组织成功后精确导航一次；重复 Enter；IME；四语言文案/跳过；零智能体访问与重挂载；关闭/重新打开；带草稿刷新非配置页及配置 URL；pending create 的 Escape/导航；连接页退出；就绪步骤不启动初始任务；异步启动前置读取被取消后不继续提交；原有跨账号草稿授权、公司切换、adapter/auth 门槛与 Cloud/authclaim 用例。

`optional-onboarding-entry.test.ts` 仅是两套 shell 与三处 companyless 路由的源代码回归约束，不替代浏览器验证。

## 待手工验收（未冒充已执行）

1. 本地新实例无组织：分别打开 `/`、`/dashboard`、`/onboarding`，只见欢迎/启动卡；等待、刷新、前进/后退均不弹配置。Cancel 返回欢迎；网络无组织/agent 自动 POST。
2. 输入自己的组织名，连击确认/按住 Enter：只新增一个组织；落在返回前缀的 Dashboard，agents 数量为 0；刷新仍是 Dashboard。
3. 零智能体 Dashboard：任务/项目/设置可浏览；显式点配置后，名称、连接步骤均可稍后配置；回到 Dashboard，不出现 agent hire、starter project/issue、run 请求。
4. 浏览器返回/前进与 Escape：弹窗退出后不重新出现；在延迟的组织创建响应到达前离开，响应不得夺回页面。服务器已接收的组织 POST 可保留该组织，UI 不声称撤销。
5. 旧已就绪草稿：点击稍后配置不得创建初始任务；点击明确的 Get Started 才沿用旧启动流程。
6. 用无创建智能体权限的组织成员登录：主界面可见，但配置入口仍遵守 capability gate。无成员资格、未登录、首管理员待认领、SSO/邀请路径必须保留原来的安全门槛。
7. Cloud managed：已有单组织的 `/onboarding` 可回 Dashboard/显式配置；无公司且 Cloud origin 缺失时没有本地创建动作；已知 Cloud origin 的创建按钮仅转往 Cloud。
8. en / zh-CN / es / ja 和窄屏检查 footer：退出/Back 在左、主动作在右，可换行但不溢出。

## 验证范围

本任务只承诺上述 focused UI tests 与 token/贡献一致性检查。仓库级 typecheck、build、全量 UI、浏览器验收及真实 DB/模型流程未在本工作树执行；由父集成按资源约束确认，不能将本记录当作全链路完成证据。
