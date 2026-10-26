# MiMouse 用户拉取与手工验收指南

本指南供你拉取代码后，在**独立、可丢弃测试环境**中自行验证。它是测试步骤，不是通过报告；下列手工用例默认均为「未执行」，实际结果请另行记录。

先读 [VERIFICATION.md](VERIFICATION.md) 最新时间段和 [REMAINING.md](REMAINING.md)，再按本文执行。模块文档中的早期「待集成」段落是历史切片说明，不能覆盖较新的集成证据；反过来，历史通过也不能证明最新代码通过。

## 1. 先确认你实际拿到的版本

在专用测试克隆内执行（不要覆盖正在开发的工作树）：

```sh
git remote -v                         # 确认来源是预期的 xjfyt/paperclip
git status --short                    # 有本地修改先停止，不 reset/clean
git fetch origin mimouse
git switch mimouse                    # 首次无本地分支：git switch --track origin/mimouse
git pull --ff-only origin mimouse
git rev-parse HEAD
git rev-parse origin/mimouse
git status --short
```

两条 SHA 应一致且工作树干净。快进失败先保留本地修改并排查，不强制覆盖。用以下记录头保存自己的结果：

```text
验收日期/操作者：
分支/完整 Git SHA：
VERIFICATION 最新记录时间/对应源码或 build stamp：
系统/架构/浏览器/Node/pnpm/Rust：
部署模式/应用版本/数据库版本（不含连接密码）：
测试公司 A/B、测试角色（用匿名代号）：
用例 ID | 通过/失败/阻塞/未执行 | 实际结果 | 脱敏截图或日志 | 相关资源 ID
```

**不要凭提交数量判断拿到了最新代码。** 本次校准时已独立核实的远端是 `f19971da0444d75fa785f695eb7974cefa75a2bd`；以自己拉取的完整 SHA 和下面的证据范围核对。后续本地代码、测试或按钮不自动成为已发布版本。

### 已核实版本与历史快照（2026-10-26 10:38 UTC）

| 范围 | 已有证据 | 不能据此推断 |
| --- | --- | --- |
| 已发布远端 `f19971da0444d75fa785f695eb7974cefa75a2bd` | 已推送并核对远端；[该 SHA 的 MiMouse 资源契约 CI](https://github.com/xjfyt/paperclip/actions/runs/40308805937) 成功 | 资源 CI 不代表全部 UI、真实供应商或生产资格 |
| 应用构建 `feb4a5863e285576d753beff4e7c21246fa09b3e`（141 阶段） | 源码与编译 server 入口 API 各 125 项、完整 server/UI 类型检查及构建通过 | 编译入口仍使用的 workspace loader 不等于独立 npm 安装；不能套用到后续改动 |
| 2,246 键历史 UI 冻结快照（133 阶段） | 757 文件、76 批、8,575 项全过，失败/跳过/todo 均为 0，源码未变；source hash `252ec1888ae3299adc2b6b5642db2b608ddfa73aba04cb5168f404f4d16f8723` | 不是 141 阶段或后续 2,286 键源码的同快照全量证明 |
| 应用 `107e06d4a5c88b407f7083dee261f5f3f41be9bd`（129 阶段）独立安装 | 17 个一方包、430 个安装依赖；普通 Node、无 TS loader/工作区回退，真实 PostgreSQL、health、打包 UI/API 通过；owned-process guard 检查后退出 0 | `naturalExit=not_verified_owned_process_exit`：未证明所有资源自然退出，也不是后续版本/全平台/生产发布资格 |
| 已包含在上述远端的应用 `c3840243f37b730f80146bb7bbd673e2b2ab37c7`：企微接收与提示词 UI | 源码 API 132 项、完整 server/UI 类型检查和 2,286 键 UI 生产构建通过 | 最新完整 UI 和独立安装不能沿用历史通过；编译入口见下一行，未宣称浏览器或供应商 C3 已过 |
| 同属已发布远端的 `c21a6ebcc4666a97397631594e811c2474b1a70f`：响应日志隐私修复 | 5 文件 67 项定向检查通过，含真实 pino 的虚构 canary；server 标准构建和编译入口 API 132项通过，build stamp 精确对应本 SHA | 编译入口仍使用workspace TS依赖loader；企微管理面板另在开发，不宣称已提供或完成 |

受控技能提升/回滚已在 129 阶段的原生 Chrome、`umask 0077` 测试实例实际通过：整树内容/执行位/删除恢复、备份、审计回执、四语和刷新相同回执，Agent 运行数为 0。旧失败 staging 孤儿保留，没有靠删除目录换取通过。独立安装的退出语义和复验方法见 [独立安装冒烟](../ALL-DIST-INSTALL-SMOKE.md)。这些历史结果不会自动填入你的用户验收记录。

2341键后续界面新增反馈页中的企微管理面板，测试步骤见 [企微界面手测](../plans/2026-10-26-wecom-admin-ui.md)；会话轮换、延迟响应和失权回执另见 [反馈隐私验收](../security/feedback-session-privacy.md)。请核对自己的SHA确实包含这些文件/界面；不把此前远端或2286键8606项通过套用于这批后续改动。

**后续增量适用性**：第 4.12 节企微接收以及第 4.13 节提示词 UI 用例，仅适用于你实际拉取且已包含对应迁移/路由/worker/界面的版本。旧142快照只有提示词注册表API；f19971d已包含提示词UI、企微API/worker及0355迁移，但尚无企微管理面板。入口缺失时记录「未提供/阻塞」，不要凭本文启用不存在的能力。新版本以该 SHA 的验证记录为准。

最新2341键快照完整UI已经结束：766文件、77批、8637项全过，零失败/跳过/todo，源码未变，对应远端16be872。初始化流程的新优化不包含在该快照中，具体应用SHA及摘要见 VERIFICATION.md 11:22 UTC记录。

### 证据如何解读

- C1：代码、契约及相应类型/构建证据；存在按钮不等于 C1 全部完成。
- C2：受控协议、假供应商、隔离数据库或本地身份夹具。真实数据库不等于真实供应商。
- C3：明确版本、环境、账号范围的真实连通；需要可追踪供应商回执。
- C4：公司用户完成约定业务场景；HTTP 200、创建远端任务都不足以单独证明。
- 人工录入 C3/C4 凭据只是**人工申报**，不是系统独立核验。能力台账不授予运行权限。

## 2. 安装、启动及数据安全

### 2.1 前提与禁止事项

- Node >= 24.11.0、pnpm 9.15.4；需要构建 Rust runner 时按仓库工具链安装 Rust。使用仓库依赖，不为绕过错误任意升级或改锁文件。
- 推荐先在 Linux/macOS 的 POSIX shell 测源码模式；Windows/六目标产物单独记录，不把 Linux 结果外推。
- 创建两个纯测试公司、虚构任务与脱敏样本。不要导入客户数据、生产账本、真实会话或生产密钥。
- 测试进程不得继承生产 `DATABASE_URL`、配置路径、密钥或执行开关。数据库、附件、工作区、技能目录、HOME 均隔离；不能让两个服务共用数据库文件。
- 本地隐式管理员模式只用于基本页面检查，**不能用于证明角色隔离、真实会话审批或受控恢复通过**。这些必须另起 authenticated/private 实例。
- 默认不调用模型、不发消息、不推 GitLab、不运行修复 worker；保存配置不是授权发送/执行。

### 2.2 最小源码界面启动

在干净测试克隆内，先退出任何注入生产环境的 shell，使用全新的测试终端。下面启动的是回环测试实例，不是生产部署配置：

```sh
node --version
pnpm --version
export TEST_HOME="$(mktemp -d "${TMPDIR:-/tmp}/paperclip-acceptance.XXXXXX")"
printf '%s\n' 'paperclip-mimouse-disposable-fixture-v1' > "$TEST_HOME/.mimouse-test-fixture"
mkdir -p "$TEST_HOME/os-home" "$TEST_HOME/evidence"
# 只改变本测试终端；不要读取/复制原HOME中的认证目录。
export HOME="$TEST_HOME/os-home"
unset DATABASE_URL DATABASE_MIGRATION_URL PAPERCLIP_CONFIG PAPERCLIP_INSTANCE_ID
unset PAPERCLIP_CONTEXT PAPERCLIP_SECRETS_MASTER_KEY PAPERCLIP_SECRETS_MASTER_KEY_FILE
unset BETTER_AUTH_SECRET PAPERCLIP_AUTH_PUBLIC_BASE_URL
unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME
export PAPERCLIP_HOME="$TEST_HOME" PAPERCLIP_INSTANCE_ID=acceptance
export PAPERCLIP_CONFIG="$TEST_HOME/instances/acceptance/config.json"
export PAPERCLIP_CONTEXT="$TEST_HOME/context.json"
export PAPERCLIP_SECRETS_MASTER_KEY_FILE="$TEST_HOME/instances/acceptance/secrets/master.key"
export PAPERCLIP_DISABLE_CWD_ENV_FILE=true
export PAPERCLIP_BIND=loopback PAPERCLIP_DEPLOYMENT_MODE=local_trusted
export PAPERCLIP_OIDC_ENABLED=false PAPERCLIP_WORKBUDDY_ENABLED=false
export PAPERCLIP_NOTIFICATIONS_ENABLED=false PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED=false
export PAPERCLIP_GITLAB_PUBLISH_ENABLED=false PAPERCLIP_GITLAB_POLL_ENABLED=false
export PAPERCLIP_CODING_REPAIR_ENABLED=false
export MIMOUSE_WECOM_WORKER_ENABLED=false
export PAPERCLIP_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
cp pnpm-lock.yaml "$TEST_HOME/evidence/pnpm-lock.before.yaml"
# 在终端保留完整安装输出与退出码；先只尝试冻结安装。
pnpm install --frozen-lockfile
```

安装规则与 [DEVELOPING.md](../DEVELOPING.md) 的锁文件政策一致：GitHub Actions负责提交锁文件，PR不提交本地生成的锁文件。若冻结安装**明确**报过期锁文件（例如新增`@paperclipai/paperclip-eval-kernel` devDependency未进入server importer）或patched-dependency hash mismatch，保留错误输出及退出码，检查错误确属这两类后，仅允许一次本地重试：

```sh
pnpm install --no-frozen-lockfile
# 不论重试成功与否，保存版本、锁文件前后差异及安装日志；失败则停止。
cp pnpm-lock.yaml "$TEST_HOME/evidence/pnpm-lock.after.yaml"
git diff -- pnpm-lock.yaml > "$TEST_HOME/evidence/pnpm-lock.diff"
node --version > "$TEST_HOME/evidence/node-version.txt"
pnpm --version > "$TEST_HOME/evidence/pnpm-version.txt"
git status --short
```

网络、认证、权限、平台编译或其它失败**不能**用非冻结安装泛化重试；也不能改依赖版本/补丁内容使它通过。重试生成的锁文件只留本测试克隆，不stage、不commit、不push；报告测试时标明这项本地差异，不把工作树称作完全干净。只保存无秘密的配置与日志。隔离HOME后包管理器如需初始化，先按自身安装文档完成；不要恢复原HOME去继承供应商凭据。

已核对`package.json`的`dev:once`和`scripts/dev-runner-options.ts`：`pnpm dev:once --data-dir "$TEST_HOME"`是支持的参数，会在迁移与启动前设置隔离PAPERCLIP_HOME，并保留显式配置/上下文路径。因此上例同时把这些显式路径放进测试目录，禁用当前目录dotenv。请使用独立普通克隆；已注册worktree的环境引导另有配置，不要混用其生产`.env`。新终端仍应确认没有其它供应商密钥变量或凭据挂载；示例列举不等于自动清除所有可能的外部秘密。

仅安装成功且环境隔离确认后，再单独启动（安装失败不要继续）：

```sh
pnpm dev:once --data-dir "$TEST_HOME"
```

浏览器打开启动日志给出的回环地址（默认 `http://localhost:3100`），另一个终端检查 `curl http://localhost:3100/api/health`。记录实际实例根和监听地址；若已有实例占用端口，不连接该实例冒充新测试，也不直接杀死未知进程。首次启动会应用测试库迁移。

认证测试：使用另一个全新测试目录，按 [Casdoor](casdoor.md)、[本地身份夹具](oidc-fixture.md) 与 [部署模式](../DEPLOYMENT-MODES.md) 配置 authenticated/private、独立 cookie、公开应用地址及测试认证秘密。本地 IdP 仅能证明 C2；按夹具文档启用回环服务，不能将它注册到生产。先 dual 并建立可恢复的测试管理员，再测试 sso-only。不要将上述 local_trusted 会话用于下面的授权成功用例。

### 2.3 自动复验入口（可选，资源消耗较大）

使用另一个新目录运行 API 套件，不能指向正在手工操作的实例：

```sh
API_TEST_HOME="$(mktemp -d "${TMPDIR:-/tmp}/paperclip-api-acceptance.XXXXXX")"
printf '%s\n' 'paperclip-mimouse-disposable-fixture-v1' > "$API_TEST_HOME/.mimouse-test-fixture"
PAPERCLIP_MIMOUSE_TEST_HOME="$API_TEST_HOME" pnpm test:mimouse:api
node scripts/compose-mimouse-locales.mjs --check
node --test external-adapters/qoder-cn/test/*.test.mjs external-adapters/workbuddy/test/*.test.mjs
# 串行执行，避免与构建争用内存：
pnpm test:mimouse:ui
```

API 入口会核查专用标记及真实 data_directory，拒绝混用现有配置实例。受限环境的回环 TCP 处理参阅 [deployment.md](deployment.md)，不要删除 PID 文件、关闭身份检查或放宽数据库鉴权。

需要自建产物时按仓库 `pnpm -r typecheck`、`pnpm test:run`、`pnpm build` 与部署文档执行并保留退出码。分包串行通过与根命令一次通过分开记录；编译 server 入口保留 workspace TS loader 的测试**不是**全 dist/npm 独立安装测试。不要运行 release/publish 脚本来做本地验收。

### 2.4 升级、备份、结束测试

升级测试必须在**备份副本**上做。先停写并备份数据库、PAPERCLIP_HOME、技能/附件/工作区、加密密钥与配置；秘密放受控存储，不放截图或 Git。记录恢复方法并实际在第二个隔离实例恢复，再应用新迁移。不可改写已应用迁移，不可用删表/清空未知投递让测试变绿。

结束时只停止自己记录的测试进程；检查未完成的远端任务和未知结果后保留脱敏证据。不要使用本文命令删除生产或未知目录；旧失败 staging、恢复前目录、未知投递必须保留调查。

## 3. 统一测试方式与权限矩阵

准备浏览器独立配置或无痕窗口：A 公司 owner、A 公司 admin、A 公司 viewer、仅属于 B 的 admin、未获邀请者；另备 A 的纯测试 Agent key。owner 不自动等于实例管理员，实例管理员也不自动替代必须存在的公司 owner/admin 成员关系。

公司页面由侧栏进入，URL 有公司前缀；不要手工猜公司 slug。常用尾路径：`notifications`、`coding`、`feedback-inbox`、`research-candidates`、`data-operations`、`skill-evaluations`。API 目录见 [api.md](api.md)，HTTP 请求沿用真实浏览器会话与 CSRF/Origin 要求，不关闭校验。

| ID | 操作步骤 | 预期 |
| --- | --- | --- |
| AUTHZ-01 | A owner/admin 打开上述模块，创建纯测试草稿；viewer 用同 URL 和对应写 API 再试 | 管理动作只允许具备实际权限者；viewer 不因按钮隐藏而绕过服务端。受限读可能拒绝，不要求所有管理员页面对 viewer 可读 |
| AUTHZ-02 | 复制 A 的候选/投递/报告 ID；B admin 将自己公司 URL/API 中资源 ID 换为 A 的 ID | 403/404，无 A 正文、目标、私有任务或秘密；分页游标也不能跨公司读取 |
| AUTHZ-03 | 用测试 Agent key 调管理员配置、人工晋级、固定 SHA 审阅、文件恢复接口 | 拒绝；伪造 userId、role 或 run header 不提升权限。调研报告另有真实签名运行身份要求 |
| AUTHZ-04 | A owner 暂停测试 admin 成员；该 admin 不刷新页面直接再提交 | 服务器拒绝旧页面操作；失败不留下部分任务/审批/恢复结果 |
| AUTHZ-05 | 未邀请者登录，再直达 A 页面和 API | 无公司访问权；IdP 管理员 claim 不产生 Paperclip 实例管理员权 |

**每个有保存/确认动作的用例，额外做以下步骤**：①连点两次；②提交前取消/关闭再重开；③浏览器后退/前进和刷新；④DevTools 临时离线制造网络错误，再恢复；⑤提交期间切公司/切用户。只在一次性实例进行受控重启。

预期：pending 禁止重复提交；同一操作身份重试得到同一回执，意图变化需新请求或409；刷新只读状态，不自动重放副作用；旧响应不覆盖新公司；草稿/确认不会跨用户泄露。网络错误不等于服务器没提交，应先查状态；结果未知不能盲目新建或重发。记录实际 HTTP 状态与资源数量，不能只看绿色 toast。

## 4. 分模块手工用例

### 4.1 四语和核心任务（已实现高频路径，仍有存量缺口）

1. **UI-01**：分别选择中文、英文、西语、日语，刷新并重新打开侧栏、命令面板、任务详情、运行记录、审批、例行任务、预算及新增模块。预期语言偏好保持、系统状态标签翻译、`html lang` 一致；用户正文/日志/ID不翻译。记录残留英文的具体页面与元素，键数量不是覆盖率。
2. **UI-02**：创建虚构任务，中文输入法组合期间按 Enter，再测试确认候选后的 Enter/Shift+Enter。预期组合不误提交、换行语义不变；检查西语长按钮、日语换行、键盘焦点、侧面板关闭/最大化和窄屏。
3. **UI-03**：在四语下制造空列表、无权限、网络失败；更改语言后查看日期、数字、费用、routines 时区。预期语言不会改变货币、持久状态、业务时区或账期。
4. **UI-04**：创建不指派 Agent 的任务，取消新建、返回、刷新，再创建一次；暂停/恢复任务并检查评论入口。预期无意外派发、重复任务或失效页面残留。

### 4.2 Casdoor（代码/本地身份 C2，真实租户另验）

1. **SSO-01**：按认证夹具或已授权测试 Casdoor 配置 dual；owner 登录、认领仅测试实例、建 A/B 公司并邀请 viewer。退出后未邀请者登录，再用 viewer 接受邀请。预期未邀请无访问，viewer 可读其授权内容但不能管理。
2. **SSO-02**：旧密码账号登录，在 Profile 显式绑定测试 IdP；退出再仅 SSO 登录，比较 userId。预期同一用户；同邮箱不隐式合并，已绑身份不能绑给第二用户。
3. **SSO-03**：切换 sso-only 后重新访问登录/邀请页并直接请求密码登录；尝试解绑最后可用 SSO。预期密码服务端拒绝、无错误回退入口、解绑拒绝。错误 issuer/签名/state/nonce 重放用受控协议测试，不能关闭验证测试成功。
4. **SSO-04**：登录后退出；测试 IdP 不可达时再次退出。预期本地会话失效，IdP 全局退出未确认明确显示；不能只看跳转 URL 判断成功。
5. **SSO-05**：实例管理员在 Access 对测试账号执行撤销，输入精确 userId；用旧 session/Board key 再访问。预期失效并有审计；同 requestId 重试不撤销后来新建会话。IdP 停用、成员暂停、本地撤销分别测试，不声称自动 back-channel logout。真实租户缺少条件时记录 blocked，不要求在仓库提交秘密。

### 4.3 Qoder CN（外部适配器已实现，真实模型未验收）

参阅 [coding.md](coding.md) 与适配器包说明。先环境诊断：记录 CLI 实际版本/路径，执行 `qodercn --version`、`qodercn --help`；这不消耗模型也不证明任务运行成功。

- **QODER-01**：先运行上文假 CLI 测试，再配置独立工作区的测试 Agent，查看七项能力。预期明确 C2/未知/未实现，不能安装后自动 C3。
- **QODER-02（可选实连）**：仅在你已批准测试账号、额度、模型任务和工作区后，执行一个最小无外部副作用任务，记录 run/session/版本；恢复同一会话，再用另一公司/Agent/工作区尝试复用。预期身份范围隔离，不能恢复“最近一次”其他会话。
- **QODER-03**：在受控假 CLI 下测试认证失败、非零退出、超时与取消、子进程清理；实连另记录供应商停止证据。预期失败可见，不把本地断开等同供应商确认取消；Windows 停止不套用 Linux 进程组证明。
- **QODER-04**：检查 credits、token、费用来源。预期 credits 不换算成未经定价 USD；未知保持 unpriced，不能显示零费用。动态工具人工批准、远程执行、代码往返不伪称支持。

### 4.4 WorkBuddy（OAuth/任务台账/ACP C2，真实应用待验）

详见 [workbuddy.md](workbuddy.md)。

1. **WB-01**：在真实人类 session 下查看连接页，另一用户/公司再打开。预期连接按所有者隔离；Casdoor 登录不等于 WorkBuddy OAuth。未启用/未获批配置明确阻塞。
2. **WB-02（可选实连）**：仅使用你已授权的测试应用与个人 OAuth；明确勾选允许的本公司 Agent，再确认最小远端任务。重复提交相同 requestKey。预期一个持久 job；权限未授权或责任用户不匹配拒绝。
3. **WB-03**：创建响应丢失时刷新该 job、重启本地服务后继续查询；ACP 断线后重新读取。预期恢复同一远端身份，不自动重建任务；待完成与创建结果未知区分。
4. **WB-04**：断开本地连接，再尝试追加 prompt/代理调用。预期拒绝后续访问，不宣称远端已强制取消；新 prompt 是显式新一轮，不由刷新触发。overview/状态与供应商回执核对，未知用量不计零。代码回传、强远端取消仍不是已实现能力。

### 4.5 通知（持久队列/修订/核对/策略已实现，真实送达另验）

所有用例先保持 worker/outbound 关闭。详见 [notifications.md](notifications.md)。

1. **NOTIFY-01**：在通知页创建企业微信、飞书、钉钉应用/兼容 webhook、公众号的测试配置草稿；缺必填项再保存。预期缺项明确拒绝，成功创建默认停用、无发送；秘密只通过受控引用与固定版本，不出现在页面/历史/日志。
2. **NOTIFY-02**：两个窗口编辑同一配置，先保存窗口一，再提交窗口二旧版本。预期旧版本409；修订留下非秘密历史并暂停。已有投递预览仍绑定旧目标/旧凭据版本，不转投新目标。
3. **NOTIFY-03**：配置订阅严重程度、精确重复窗口及策略版本；在 fixture 内生成相同/不同严重程度事件并重复。预期过滤和有界精确去重，CAS 冲突可见；不是摘要聚合，不能把不相同事件误合并。
4. **NOTIFY-04**：查看待投递预览及未知投递的人工核对，填 accepted/not_accepted/unknown 证据后刷新。预期人工记录有操作者/状态快照，原传输 state/receipt 不变；不是独立供应商 C3。
5. **NOTIFY-05**：在 fixture 中模拟超时、429、token 过期、重启与轮换。预期租约/缓存隔离，未知结果不自动重发；人工重试要求明确核对及接受重复风险，并沿原目标版本、同 requestId 去重。
6. **NOTIFY-06（可选实送）**：仅当你已确定测试收件人、渠道资格、模板/OpenID并授权这一条发送后，开启所需发送开关，预览并单独确认。核对供应商回执和收件端实际消息，分别记录受理/送达/已读；关回测试开关。公众号资格和钉钉租户能力不可用则 blocked。
7. **NOTIFY-07**：尝试把普通个人微信/个人群当作支持渠道。预期不提供伪成功驱动，明确不支持；不借企业微信能力宣称可读所有客户群。

### 4.6 GitLab 编码交付、六目标矩阵（台账/门禁已实现，Runner/上传未完成）

使用专用 fixture 仓库与不含秘密的提交，先保持发布、轮询、修复关闭。详见 [coding.md](coding.md)。

1. **CODE-01**：关联真实测试任务、干净隔离工作区、GitLab 项目及完整 base/head SHA，登记交付；查看固定提交差异并核对文件与证据摘要。预期只读、不 fetch/checkout/push；同实例第二项目不接受第一项目来源。
2. **CODE-02**：未审阅时检查门禁；审阅后再写新证据或改变清单、HEAD/工作区。预期旧摘要/回执失效，重新加载确认；取消重开不保留勾选。脏树、非祖先、二进制/超限、子模块/缺对象明确阻塞，不截断冒充完整。
3. **CODE-03（可选真实项目）**：只读同步固定 SHA 的 MR/CI，核对 GitLab 项目/pipeline/job/commit；新 SHA 出现后复查审阅。预期旧绿灯不沿用。明确允许工作分支写入后才能另做 push/MR 测试；本指南不授权 merge/tag/生产发布。
4. **CODE-04**：打开构建矩阵，检查 Windows/macOS/Linux × x86_64/arm64 六格；登记一个本地测试产物后再看。预期本地 hash/字节数不变成 Runner/签名/目标架构证明，其余缺项逐格 blocked；错项目/旧 SHA 清单不生效。
5. **CODE-05**：检查上传与发布状态。预期缺上传合同仍为 `upload_contract_missing`，客户端提交 uploaded/signature/testStatus 不可升级证据。六个目标分别需要实际 Runner、工具链、测试、签名及上传回执，不能用同一个 Linux 文件填绿六格。
6. **CODE-06**：用自动夹具验证有限修复；手工查看 maxAttempts/派发窗口/费用上限和版本。预期默认关闭、未知费用/额度不足/旧模板/撤销/过期阻止新派发；环境故障不当代码修复。派发结果未知先对账不重复运行。窗口不是运行中强制截止，候选完成不自动推送。

### 4.7 反馈与 Langfuse（人工入站/确定性分组/只读连接器已实现）

1. **FEEDBACK-01**：在反馈页用虚构产品/版本/事件 ID 导入含假邮箱、假 token 字样的样本；重复完全相同输入，再改正文复用事件 ID。预期先创建、重复原回执、改内容409；已知敏感模式脱敏，原文不进请求日志。脱敏不是保证全部匿名，先自行审核样本。
2. **FEEDBACK-02**：导入同产品/版本/标题及相同错误堆栈的两条样本，再导入不同版本。查看候选、分组和复现证据清单。预期基于明确字段/确定性证据，不自动合并事实、不声称语义聚类或复现已执行。
3. **FEEDBACK-03**：人类 owner/admin 填复现、预期、建议、验收标准并确认转待办；连点/刷新/重试。预期一个 private/backlog 任务、无 Agent 指派/派发；quarantined 不因晋级变可信；另一用户看不到他人的私有回执。
4. **LF-01**：Langfuse 面板创建只读任务，使用测试项目的受控密钥引用、固定版本、明确不超过24小时窗口；先检查缺项/非法 origin 被拒绝。没有实连授权仅运行 fixture，不向实际账号请求。
5. **LF-02（可选实连）**：明确点击拉取一页，核对来源 URL、project/trace/observation、微秒时间与 `provider_fetch`；继续页、重启服务后继续、显式 replay。预期游标持久化、同事件不重复、初始脱敏快照不覆盖；人工 sourceKind=langfuse 仍标 manual_import。
6. **LF-03**：受控 fixture 测试401/429、未知schema、404/405/410、取消、页面并发与审计失败。预期失败关闭、重试时间可见、页和游标同事务；响应丢失先刷新状态，不宣称完整抓取。只读 GET、不拉完整 trace/io/客户日志、不发模型/客户回复。企微接收的未发布增量见 4.12；语义聚类和自动复现仍未完成。

### 4.8 调研与例行任务（候选/人工晋级/报告身份接线已实现）

详见 [research.md](research.md)、[research-routines.md](research-routines.md)。

1. **RESEARCH-01**：导入虚构调研候选，填写来源 URL、带时区检索时间、产品、证据、差距与建议；遗漏来源或产品不匹配再提交。预期校验拒绝无证据输入，来源声明不升级为独立核验。
2. **RESEARCH-02**：管理员审阅收益假设、范围、验收及依赖，再确认转任务；刷新与重试。预期私有 backlog、无自动派发；同请求去重，低信任边界保持。
3. **RESEARCH-03**：点击新建调研例行任务；在原 Routine 页面查看状态/触发器/执行人，在调研页查看绑定。预期 paused、无触发器、无 Agent、报告 disabled；创建与绑定若部分失败，应提示先查已有暂停任务，不自动重建。
4. **RESEARCH-04**：绑定公司公开项目/父任务后，检查已有描述没有被覆盖；尝试绑定私有/继承私有来源。预期私有来源不进入可用列表或拒绝启用，不自动公开任务。
5. **RESEARCH-05**：用受控 API fixture 测真实运行身份关联；普通 Agent key 加伪造 run header、错误公司/任务/assignee、已结束 run 均拒绝。已授权 signed run 报告幂等入 quarantined 候选。该夹具不是实际定时外网调研；真实来源拉取、定时任务实跑需单独实测。
6. **RESEARCH-06**：手动暂停纯测试公司，再由真人公司管理员读取已有调研配置/候选；尝试绑定和提交报告。预期只读仍可用，绑定/报告写入仍拒绝；不能为读页面自动恢复公司、启动 Agent 或模型。

### 4.9 运营预演与审核（dry-run 已实现，业务写入未实现）

详见 [operations.md](operations.md)。

1. **OPS-01**：输入虚构月度数据，指定 YYYY-MM、IANA 时区与字段映射，包含时区月界线两侧记录、insert/update/noop；小数用字符串。预期稳定差异/hash，期外记录明确列出，界面语言不改账期；重复来源/映射冲突拒绝。
2. **OPS-02**：保存不可变预览，重复相同 requestId，再改内容复用 requestId。预期原回执/409；顺序改变不另造业务操作身份，内容变更不能覆盖原预览。
3. **OPS-03**：准备21条以上差异，不看完直接送审，再逐页看完送审。预期未完整查看时不可确认；审批只含必要摘要和链接，不泄露业务行值。两个窗口并发送审仅一条审批。
4. **OPS-04**：由有效管理员批准，再刷新 readiness；修改旧预览 hash/审批 payload 做负例。预期旧授权不能复用；即使批准仍 `dry_run_only`、`writesSupported:false`、`write_adapter_not_implemented`，没有 apply API、不真实记账。`externalWrites=0`不代表已有审批通知机制完全关闭。
5. **OPS-05**：重启后读取同一预览/审批，取消或网络失败后返回深链。预期结果保留、不自动执行外部写入。真实数据拉取、执行意图/租约/结果未知对账、业务写入和月度执行仍是后续实现，不列作已通过。

### 4.10 评估与受控技能恢复（窄范围已实现，原生复验特别关注）

详见 [evaluation.md](evaluation.md)、[evaluation-restore.md](evaluation-restore.md)。不要为填充运行记录直接修改数据库；无既有安全测试运行时，使用隔离自动夹具，或将该手工用例标为缺少测试数据。

1. **EVAL-01**：在技能页准备同技能两个已有版本及已完成的安全测试运行；评估页冻结输入/精确预期，选定两版运行进行比较。预期逐条 exact_text_v1、固定分母/哈希，历史 superseded 成功记录可选择；缺失/失败/输入或执行上下文不一致均阻塞，不能自动挑最好运行。
2. **EVAL-02**：选择无成本记录的运行，查看费用及费用上限门禁。预期未知不是0；部分未知不包装成总费用，账本快照不是最终供应商账单。晚到费用要新比较请求，原报告不可变。重复比较请求幂等，改输入同键409。
3. **EVAL-03**：报告可人工审阅时查看恢复 readiness。预期比较本身不执行、不改 currentVersionId、不自动授予提升。准备测试 managed-local 技能的完整基线/目标文件，含新增、删除、二进制与可执行文件；先备份并记录文件清单/哈希。
4. **RESTORE-01**：公司 active、技能被 Agent 引用、有 queued/running 运行时尝试恢复。预期拒绝，不自动暂停/解绑。Viewer、Agent、Board key、local_implicit，以及不支持的 Windows/远程/catalog/project/bundled 来源都必须拒绝。
5. **RESTORE-02**：仅将测试公司手动暂停，确保无运行/代理引用；由真实公司 owner/admin session 确认精确报告 hash、当前版本及动作。预期实际整个目录与元数据切换，新增/删除/二进制/执行位符合目标；只有 applied 收据才成功，202/prepared 不是完成。
6. **RESTORE-03**：引用最近一次已应用提升收据执行回滚；重试同请求。预期恢复提升前的完整树和名称/描述，不仅版本指针；过期报告/并发编辑/实际目录漂移/符号或硬链接/特殊文件拒绝。
7. **RESTORE-04**：先用自动故障夹具复验两个 rename 中断和数据库失败。确需手工重启时只操作已备份的一次性实例，记录 prepared 操作ID，再从恢复面板显式选择 apply 或 compensate。预期 pending 阻止普通读取/编辑/附挂/运行解析，不自动猜布局；选补偿后不能改回 apply。未知字节保留，不删孤儿目录骗过检查。
8. **RESTORE-05（已发现问题回归）**：在 POSIX 测试终端以 `umask 0077` 启动独立实例，对**全新的 requestId**做支持范围内恢复。新建 staging 目录应按受控标准规范化并通过完整校验；原 live 源目录仍需合法0755、文件0644/0755。修复仅规范化本次独占新建目录，不 chmod 旧源或旧孤儿。若旧失败请求已有不完整孤儿，保留调查，明确新请求再测，不能反复复用旧 requestId 宣称修复无效或删除旧目录消除证据。

恢复是暂停期可恢复整树替换，不是活跃 Agent 无停机发布。提示词注册表的选择/回退不等于运行态应用；提示词实验比较、运行态接线和自动成本路由闭环仍未完成。

### 4.11 能力验证凭据台账（已实现人工审计，不是自动认证）

1. **CAP-01**：打开 Qoder、WorkBuddy 和一个未登记的上游适配器 Agent 概览，逐项核对本地/远程执行、会话恢复、确认取消、工具批准、工作区往返、用量报告七项。预期完整且区分 C2/未实现/未知；未知不等于不支持。
2. **CAP-02**：当前面板支持查看、分页与撤销，不提供完整新增表单。由公司管理员在已认证测试会话通过 `POST /api/companies/:companyId/capability-evidence` 录入纯测试人工凭据，字段以 `packages/shared/src/capability-evidence.ts` 的追加契约为准（供应商/版本/账号范围/环境/时间/证据引用及申报等级）；不熟悉 API 时运行对应隔离夹具并将手工新增记未执行。重复同一幂等键与并发旧版本请求。预期只增不改、持久幂等与CAS冲突、审计可追溯，明确标注人工声明；保存不触发供应商请求或模型。
3. **CAP-03**：更换版本/账号/环境或让记录失效，再撤销/替代证据。预期不匹配证据不能继续显示有效验证；历史不覆盖；能力台账不解锁原有权限、取消或费用能力。跨公司/Agent写入负例沿 AUTHZ 执行。

### 4.12 企业微信接收入站（未发布增量；默认关闭，非真实 C3）

先确认实际 SHA 已包含该增量。当前管理入口是 `GET/POST /api/companies/:companyId/feedback-wecom/connections`、`PATCH .../:id` 和 `POST .../:id/enabled`，不是通知 webhook；管理面板另在开发，本节不假定已有可用配置页面。配置字段以 `server/src/services/mimouse-wecom/protocol.ts` 为准。先用仓库隔离 fixture 和虚构秘密；worker 保持 `MIMOUSE_WECOM_WORKER_ENABLED=false`，不得把真实企业群/生产 bot 当故障注入对象。

只有你明确批准测试企业、bot、群/直接发送者白名单和固定版本的公司秘密引用后，才在**另一个隔离终端/实例**显式启用 worker。开关、配置和授权都不是 C3；需要另记真实供应商证据。缺条件就记 blocked，不要求提供生产凭据。

1. **WECOM-01 默认关闭**：分别在开关缺省与明确 `false` 时启动、访问页面、保存或启用测试配置。预期 worker 不拨号、不解析连接秘密、不领取接收租约；配置 API 本身没有网络副作用。仅打开页面/HTTP 保存成功不应接收消息。只测 fixture，不为这项检查把开关改为 true。
2. **WECOM-02 注册与边界**：用 instance admin 和普通公司 admin 分别尝试注册；再用 Viewer、Agent 和跨公司身份访问/修改。注册需要实例管理员且公司 active；管理仍受公司授权约束。配置须引用本公司有效的固定秘密版本，并至少显式允许一个群或直接发送者。重复 bot 身份不可跨公司重占；返回状态不含 bot/sender/group ID、秘密引用、凭据或租约令牌。跨公司资源只得 403/404，不能泄露对象。
3. **WECOM-03 显式启用**：在受控 worker fixture 中执行 false→true、重复 true、禁用、更新配置、再次明确启用。预期仅新的 false→true 形成一次激活；重复 true 不重置租约/重连预算，不抢占接收器。修改配置须先禁用且没有残留租约，bot 身份不可改。内部令牌断言留在 fixture，不复制到日志；API 成功不是已收到供应商消息。
4. **WECOM-04 暂停/取消/退出**：fixture 让公司在凭据解析、连接构造或入库期间暂停/归档，并切换 root worker 的 standby/关闭门禁。预期停止续租/接收，待处理事务结束后释放；取消后的晚到消息/认证响应不再入库。关闭实例后没有新拨号或后台接收；不能让旧 activation 被自动恢复为新授权。
5. **WECOM-05 崩溃与预算**：仅在一次性 fixture 模拟进程中断、残留租约过期、release 结果未知及连续断线。预期 `interrupted`/终止状态与 gap 可见，重启监督器或重试相同 enabled=true 不刷新旧预算；需人工审查后明确重新启用。并发接收器不超过 2，同一连接不能被两个进程同时占有；不因清空状态/删除租约让测试通过。
6. **WECOM-06 会话与来源**：fixture 注入认证前消息、错误认证 req_id、认证失败、错误 bot ID、非白名单群/发送者及 `disconnected_event`。预期认证前/身份不符不导入，错误认证失败关闭；被其他会话挤出后终止，不持续争抢连接。固定 WSS、TLS 验证和禁止重定向不因测试而放宽；只发送必要订阅/心跳，不自动业务 ACK、客户回复或媒体下载。
7. **WECOM-07 畸形与日志**：fixture 发送二进制、非法 JSON、超大帧/队列、含虚构 secret/token/SQL 文本的异常，保存捕获日志。预期按受控状态终止，不把原始帧、正文、凭据、群/发送者 ID、秘密引用或绑定 SQL 写进状态/错误日志。无未处理异步异常；日志只保留必要固定事件/计数。用虚构标记查泄露，不能拿真实秘密做测试输入。
8. **WECOM-08 回执与低信任**：fixture 发送一条允许的文本，重复同 msgid，再用同 msgid 改正文；附带媒体 URL、response_url、aeskey 或指令文本。预期 `provider_push`、首份脱敏快照保留、重复不新增、quarantined 不升级可信；不下载附件、不执行消息指令、不自动创建/指派任务或调用模型。状态如有 gap 必须保留，`replaySupported:false` 不能当完整补抓；人工晋级沿 FEEDBACK-03 单独确认。
9. **WECOM-09 可选实连**：仅在明确测试授权下接收一个虚构最小文本，保存 bot/范围/版本的脱敏对应证据、供应商消息 ID 映射、接收与停止回执。缺真实供应商回执仍是 C2/blocked；10 项本地 DB/API 或纯协议通过都不能代替这项 C3。

### 4.13 提示词注册表（已发布 API；四语 UI 属后续增量，不应用运行态）

142 快照通过管理员 API 测；只有实际包含 UI 的版本才执行页面步骤。入口为公司 `prompt-registry` 页面（若提供）及 `GET /api/companies/:companyId/prompt-registry`、`POST .../revisions`、`POST .../:promptId/selections`。参阅 [提示词注册表](../plans/2026-10-26-p5-prompt-registry.md)。必须是真人 owner/admin 的有效 session，不使用 Board key、Agent key 或 local_implicit 替代。

1. **PROMPT-01 精确内容**：用虚构 promptKey 创建两版，正文包含前后空格、换行及无害 HTML 字样；再读取版本正文/哈希。预期不可变、原样文本展示，不 trim、模板插值或执行 HTML；创建不会自动选择版本。正文和数据库绑定 SQL 不能出现在错误日志中。
2. **PROMPT-02 仅注册表选择**：查看目标内容/ID/hash及服务端 head receipt，再明确勾选「仅选择注册表」进行 promote；刷新查询回执。预期 `runtimeApplied:false`，Agent 指令、技能文件、调度/模型调用均不变。选择不表示效果提升、运行态激活或默认将来运行采用该版本。
3. **PROMPT-03 回退与并发**：两个窗口读同一 head，A 选择版本后 B 提交旧 head；再翻页找到真正 head receipt，针对它做 rollback。预期旧 CAS 返回 409，需重新检查/确认，不自动覆盖；回退引用真实 head receipt 的 beforeRevisionId，不依 UUID 大小或列表第一行猜测。历史回执不可改写，ABA 回到同版本也不能复用旧 head。
4. **PROMPT-04 未知结果安全重试**：fixture 或 DevTools 制造写入后响应丢失。预期页面冻结本次 requestId/完整请求/CAS，恢复按钮重试原请求，不生成新 ID；重复只返回原回执。先记录非秘密 requestId并查回执，未知时不要新建同意图。页内「刷新」只读、不重放写入；整页刷新/离开/换 session 不承诺恢复内存草稿，不能当自动重试。明确新意图才新请求。
5. **PROMPT-05 会话数据隔离**：让正文读取或写入响应挂起，再切公司、用户，或同用户重新登录产生新 session；随后放回旧响应。预期草稿、正文、确认、未知请求和回执视图清空/隔离，旧响应不能出现在新身份中。同一路径必须发新身份独立读取，不复用前一会话的 in-flight cache；只测 sign-out 清缓存不足以证明这一点。
6. **PROMPT-06 权限失效与失败**：撤销成员权限后保留旧页面提交/刷新；另用 Viewer、Agent key、Board key、local_implicit 和跨公司 ID。预期 401/403/404、无正文泄露；权限失效清空草稿/确认，失败视图隐藏旧正文和修改控件。普通网络读失败也不继续显示过时授权内容；恢复后需重新检查，不自动确认。
7. **PROMPT-07 四语与分页**：仅在带 UI 的版本用中/英/西/日语测试版本、head、回执分页及长正文。预期业务正文/ID/hash不翻译，迟到分页不覆盖新选择；缺 head receipt 时必须显式加载，不能先回退。键盘取消、后退和重复点击不触发额外写入。

### 4.14 成本策略预览（保存策略和阻断证据，不是已完成自动路由）

适用含 0353/0354 的版本；参阅 [成本策略预览手测](../plans/2026-10-26-cost-routing-preview-manual-tests.md)。

1. **COST-01**：在 `cost-routing-preview` 保存虚构策略，选择真实存在的安全评估/账本记录。预期保存不可变版本并展示原因；没有实际运行上下文见证和适配器精确匹配时，所有预览仍为 blocked，`selectedAgentId`/`comparableCost` 为空。已记录 USD 仅诊断，不等于可信可比较成本，更不等于节省费用或自动派发。
2. **COST-02**：fixture 覆盖未知币种/费用、部分账本、过期窗口、错公司/适配器/运行来源和重复请求。预期硬阻断，不用零费用或推测的未来上下文补齐。请求和审计幂等，无模型/任务派发。
3. **COST-03**：挂起旧身份策略/账本读取，再切换公司/用户/session并访问同路径。预期新身份独立请求，旧响应不能填入新页面；刷新不自动选择或执行。暂停公司下的调研只读边界另按 RESEARCH-06 测，不能借成本面板绕过写入限制。

## 5. 安装包与升级最后一关

源码启动成功后，仍不能省略独立安装包验收：

- 129 阶段独立消费者已通过 owned-process guard 冒烟，范围与退出限制见第 1 节；这不自动覆盖你拉取的新版本。对实际交付的本地 tarball 记录 SHA-256，在**不含 workspace 源码和 TS loader**的全新消费者目录按交付的离线依赖说明安装；不要拿 npm 上不同版本替代。无 tarball 或构建未过时记 blocked。
- 执行该包 CLI 帮助、启动隔离实例、health、迁移、打开静态 UI，再测评估/数据库入口。确认入口全部来自安装包，并记录构建 stamp。
- 特别检查 hoisted `node_modules` 下原生 PostgreSQL wrapper 与平台库能否解析、真实启动数据库；“安装了依赖”或5项布局单测不等于启动通过。记录 shutdown 已完成、HTTP监听关闭与数据库PID消失；若 harness 检查后由调用方显式退出，必须保留 `naturalExit=not_verified_owned_process_exit`，不可改写成自然退出通过。
- 升级演练分别覆盖空库、旧版备份副本、应用回退及备份恢复；检查旧投递/任务/人工审阅历史未被误重放，旧 WorkBuddy 凭据迁移后按文档重新授权，不能复制旧密文猜身份。
- Windows/macOS/Linux 的安装与六目标构建各自记录；POSIX 恢复成功不等于 Windows 恢复已支持。

## 6. 如何报告问题与判定结束

每个失败给出：完整 SHA、用例 ID、角色/公司匿名代号、最短复现步骤、预期/实际、时间、HTTP 状态、脱敏资源 ID/截图/日志及是否可重现。不要上传 cookie、授权码、邀请链接 token、secret、数据库或客户原文；不要删除失败日志。

建议先完成：版本核对 → 安装/health → 四语与基本任务 → AUTHZ → 反馈/运营/调研人工路径 → 评估/恢复 → fixture 自动复验 → 有授权条件的供应商实连 → 独立安装包/备份恢复。没有外部条件的项目记 blocked，未点击的项目记未执行，不因其它模块通过而勾选。

验收结论分别填写「源码可用」「构建通过」「安装包通过」「手工路径通过」「供应商 C3」「业务 C4」，只对实际测试 SHA 和环境有效。本文不会把尚未实现的业务写入、上传、六目标 Runner、语义聚类、自动复现或真实供应商验证写成已完成。
