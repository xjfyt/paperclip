# 本地集成验证记录

核验日期：2026-10-25 UTC。基线为 v2026.1023.0 / 1b4c803816e82b0265c8422e1a804327a7ed8c54。开发分支 mimouse。此记录是可审查候选版的本地证据，不是全部需求完成或生产上线证明。

## 已通过的检查

| 检查 | 实际结果 | 范围与限制 |
| --- | --- | --- |
| 四语合成 | 976 键，en / zh-CN / es / ja 键和占位符一致 | 词条数不是全应用覆盖率 |
| 全部 UI 测试文件 | 976键快照734文件/74批/8248项通过，零跳过失败 | React/jsdom，不是真实浏览器，不能跨快照套用结果 |
| UI 类型与生产构建 | tsc --noEmit、tsc -b --singleThreaded及Vite生产构建通过 | 大chunk与部分动态导入警告仍保留 |
| 完整服务端类型 | tsc --noEmit --singleThreaded 通过 | 不等于完整根目录 typecheck 脚本全部通过 |
| 服务端编译与资源打包 | 串行 tsc 生成 JS/声明，复制标准资源及 runner，写入 build-info 成功 | 与 package build 的步骤一致，但为云资源约束增加 singleThreaded；默认并行构建曾被 SIGKILL |
| 服务端定向安全/协议回归 | 16文件145项通过；另有10文件223项既有核心回归通过 | 后者覆盖真实数据库例行任务、路由授权、脱敏和外部loader；不是全仓所有server测试 |
| 外部适配器 | Qoder 17 项、WorkBuddy 5 项通过 | 真实子进程与假 CLI；非供应商收费任务 |
| 实际 HTTP/PostgreSQL | 最新源码入口40项通过；编译server入口配合976键UI共40项通过（含10项有限修复、10项应用令牌缓存） | 包括真实核心任务到已注册假 CLI 的运行记录、持久队列、OAuth 台账、CI 轮询与生产静态资源；workspace依赖仍使用TS loader |
| 迁移 | 0334–0341 已应用到专用隔离数据库 | 安全检查通过，20 项历史发现由既有 baseline 覆盖；生产升级演练未做 |
| 代码门禁 | no-git-push、设计 token gates、forbidden tokens 和 diff 检查通过 | 设计 token 检查不是安全凭据扫描 |
| 启发式凭据扫描 | 本次变更未发现所检查的私钥、GitHub/AWS/OpenAI 密钥格式 | 不能证明不存在所有种类的秘密 |

604键历史 UI 测试源码摘要：6e66d7f2260b14d702176b8d5c23ee6aca56533b6a6ae08177a986b56028b4a0。执行期间 UI 源码未变；每批退出码、文件列表和日志由 test:mimouse:ui 保存。此前 577 键阶段发现过一项空格回归及一个被终止批次，已修复/整批重跑；没有把原失败结果改写为通过。

先前服务端串行构建的build-info对应43ff050a37a62834188014851d00fc053db89b2e，已包含0340修复功能。21:49 UTC配合959键UI编译入口29项通过，后补跨公司修复负例后22:04 UTC完整30项通过。其后提交仅改变UI/文档，不把它们误称为此server二进制的源码提交。

## 环境问题处理

Node 24.22.1、pnpm 9.15.4、Rust 1.97.1；不升级项目依赖来掩盖问题。上游 Rust runner 构建成功，保留 7 条警告。依赖缓存原在 /tmp 内存盘，占用数 GB，导致类型/构建被回收；移到磁盘后，完整类型检查得以完成，暴露的一处会计事务类型错误已修正。串行编译完成服务端产物。

tsx CLI 的进程间 Unix socket 在此云环境受限，源码启动采用 node --import tsx；隔离 embedded PostgreSQL 使用回环 TCP，不改生产数据库设置。测试显式清除继承的数据库 URL、配置、加密主密钥和外部执行开关，每次直接数据库写入前核验 data_directory。遇到隔离进程 PID 重用触发实例保护时，未删除 PID 文件或绕过校验，独立会话重跑通过。

## 尚未通过的检查

- 命令执行会话直接启动 Chromium 仍受 socket() EPERM 限制。通过助手云桌面原生终端启动独立本地实例后，现有 Chrome 已完成四语首次引导/任务详情、审批及暂停通知界面的实际检查，详见 checklists/BROWSER-20261025.md。实际输入法、完整视觉/无障碍及所有路径仍未全量验收；没有关闭安全限制。
- 官方 Qoder CLI 1.1.78 的实际版本、帮助和隐藏参数校验通过，但没有登录、调用真实模型或消耗额度。
- Casdoor、WorkBuddy、真实通知接收目标及 GitLab/Runner 缺少实连输入。所有模拟成功保持 C2；不标为 C3/C4。
- 已按包覆盖全部35个非根工作区包的构建与类型检查：34包标准串行build加server等价串行编译；32包标准typecheck，加CLI/UI/server单独串行检查。原始根命令的一次默认执行曾因资源/环境失败，不把分批结果说成默认命令一次通过。具体复验命令见下节。
- 发布后全dist/npm安装包仍未验收。直接运行workspace中的cli/dist/index.js缺少zod等由发布清单生成器补齐的依赖；源码CLI经Node+tsx入口--help通过。未为掩盖该发布边界随意加依赖或改锁文件。
- 有限修复已接入并通过10项真实数据库测试，但真实供应商闭环未验收。七项能力面板已实现且区分夹具/未实现/未知；部分高频动态文案、配置修订与供应商对账仍有实现缺口，见 REMAINING.md。

## 复验入口

先按照部署文档准备独立测试目录与标记，确认不是生产实例。

- pnpm test:mimouse:ui：发现并分批执行全部 UI 测试；任何失败批次或源码变化都会返回非零。
- PAPERCLIP_MIMOUSE_TEST_HOME=<absolute-disposable-home> pnpm test:mimouse:api：启动源码服务并验证实际数据库/HTTP 链路，不启动浏览器。
- PAPERCLIP_MIMOUSE_TEST_COMPILED=true：上述 API 入口改用 node --import tsx dist/index.js；须先完成服务端和 UI 构建。server 入口使用编译 JS，但 workspace 依赖仍按上游 exports 指向 TS，因此保留 loader；这不是发布后全 dist 包的安装验收。
- node --test external-adapters/qoder-cn/test/*.test.mjs external-adapters/workbuddy/test/*.test.mjs。
- node scripts/compose-mimouse-locales.mjs --check。

外部适配器的实际 model hello probe 默认关闭；不得为复验此候选版自动开启收费探针或向真实收件人发送测试消息。

21:31 UTC 更新：816键资源校验通过；29项源码入口 API/PostgreSQL 通过；15文件118项服务端定向测试通过；Qoder/WorkBuddy外部适配器共22项通过。当时完整类型通过而编译入口待复验；现已完成后续43ff050构建与29项编译入口复验，见上文。

816键完整回归：732文件、74批、8224项全部通过，零跳过失败；源码摘要d399b9c77f09916d7fc710a8c8b08bb5f44436321083dfb555eda2c2e7c05c3b，执行期间未变。之后915键定向12文件243项通过，959键定向10文件142项通过，959键类型与生产构建通过；后续959键整套结果见下文，不混用旧快照结论。

服务端新编译曾与UI回归并发时再次SIGKILL；待整套回归完成后单独运行，GOMEMLIMIT=2500MiB、GOGC=20、GOMAXPROCS=2、tsc --singleThreaded完成编译。该资源调度调整不跳过类型错误或编译步骤。

22:05 UTC阶段UI快照：734文件、74批、8247项通过，零失败/跳过；摘要8c0d7849959fe0fb50976aeb68d71022a34ef8bb3a1556a0d4eb03c98c681428，执行期间源码未变。测试清单与全部批次日志保留用于交付。编译入口API/PostgreSQL30项通过，新增服务层公司过滤及数据库复合外键23503负例。


## 22:20 UTC 集成检查收敛

- 该阶段服务端构建基于e8a7f4aa8521eb8dfe5a82ca95a92c46c7c4d4c5，后续仅修改重复测试夹具与文档；编译入口30项连续两轮通过。曾有一轮新增负例使用默认公司前缀撞到保留夹具，改为正式公司创建API分配前缀后重复复验通过，没有放宽跨公司拒绝断言。
- 全工作区34包标准串行build通过，server额外执行串行tsc、供应商依赖核验、标准资源/runner复制及build-stamp通过。32包标准typecheck通过，CLI tsc --noEmit --singleThreaded、UI tsc -b --singleThreaded以及server类型/编译分别通过，共覆盖35个非根包。
- 云桌面独立终端补跑既有核心测试，10文件223项全部通过、无跳过；包括routines-service、routines-e2e、routines-routes、例行任务批注和遥测、适配器权限/注册表、日志脱敏与新增包实际loader。专用数据库、HOME和供应商开关隔离，没有调用真实模型。
- 三项JSON解析测试、959键资源一致性及工作树diff检查通过；新增分支CI使用只读权限、固定上游Actions版本，YAML已解析检查。远端工作流尚未执行，不能算CI绿灯。

资源受限时的实际检查方式（先准备正确Node/pnpm/Rust环境及独立测试目录）：

```sh
export GOMEMLIMIT=2500MiB GOGC=20 GOMAXPROCS=2 CARGO_BUILD_JOBS=2
pnpm preflight:workspace-links
pnpm --workspace-concurrency=1 --filter '!@paperclipai/server' -r build
pnpm --workspace-concurrency=1 --filter '!@paperclipai/server' --filter '!paperclipai' --filter '!@paperclipai/ui' -r typecheck
pnpm --filter paperclipai exec tsc --noEmit --singleThreaded
pnpm --filter @paperclipai/ui exec tsc -b --singleThreaded
pnpm --filter @paperclipai/server exec tsc --noEmit --singleThreaded
```

server编译除tsc --singleThreaded之外仍执行package.json中的所有资源复制和供应商核验步骤；不要把只生成JavaScript误当完整打包。大型类型检查不要与完整UI回归争用内存。Unix socket受限的执行会话与云桌面终端不共享/tmp；使用各自独立HOME/测试数据库，证据输出到共享工作区。


## 23:27 UTC 令牌刷新与最终候选复验

- 当前四语976键；UI完整734文件、74批、8248项通过，零失败/跳过，执行期间源码不变。摘要9a58bd8325a04556082f9c6f292af5e4e4f1b363c2d17ca678be7daf4407c4d1。独立定向10文件146项也通过，包含中文移动侧面板焦点恢复；不等于真实移动设备验收。
- 服务端定向16文件145项通过，含27项应用凭据/刷新协议单元测试；原核心10文件223项在云桌面隔离数据库重跑通过，无跳过。
- 源码及编译server入口各40项数据库/API测试通过。最新server build-info精确对应02d1d35f9532e07c232a2a399be02b4b01ce41d3；后续文档提交不改变该二进制来源。编译入口继续使用workspace TS依赖loader，并非npm发布安装验收。
- 0341加入公司/密钥版本隔离的加密token缓存、数据库刷新租约、修订CAS和退避；覆盖竞争、重启复用、撤销/轮换、迟到写回和结果未知不重发。钉钉应用及公众号支持app凭据自动按TTL刷新，也保留固定accessToken。供应商提前拒绝token时保守拒绝并交由管理员检查，不盲目刷新后重发可能已送达的消息。
- 新增测试初次使用相同假收件目标触发正确的跨公司全局限流；改为独立夹具收件目标后全部通过，没有关闭限流。编译复验曾被旧实例PID保护挡住，改用新建且带明确标记的隔离实例；其初次启动受Unix socket权限限制，确认无运行进程后只将该新测试集群设为回环TCP，随后40项通过，未删除PID或绕过实例保护。
- 最新UI类型/生产构建、CLI串行类型、32个其他工作区包类型、DB构建与迁移检查均通过。34包标准build的先前完整结果仍有效；此后代码变化集中于已重建的DB/server/UI，不宣称默认根命令单次全过。
- 真浏览器复核976键版本：中文侧栏宽度/反馈/Agent动作、侧面板属性/关闭/最大化、命令面板标签切换正确，英文任务内容保持原样。自定义新建标签控件仍显示Open a new tab，编辑器aria仍为editable markdown，列入剩余项，不宣称全应用本地化。

## 23:37 UTC 后续实现：配置修订

0342迁移已在专用旧数据夹具上应用，回填v1历史并给run.failed触发快照增加配置版本。4项新增DB测试通过，完整源码入口44项通过；通知UI17项及路由授权12项通过，server/UI类型、DB构建、UI生产构建和代码门禁通过。四语资源980键；尚未对980键快照跑整套UI，976键8248项只作为上一候选证据。最初新增快照属性未同步TypeScript接口导致类型检查失败，补齐后整套server类型复验通过。浏览器名称修改及历史已复核，详见浏览器清单。

## 23:42 UTC 后续实现：投递人工核对

0343按生成结果校正新增唯一索引先于复合外键的顺序后，首次应用到测试库成功；没有重写已应用迁移。完整源码API/DB48项通过，含4项核对、幂等、并发、跨公司FK23503和状态变化拒绝；通知UI19项、路由授权15项通过。server/UI类型、DB构建、四语990键及代码门禁通过。人工依据不改原state/receipt或发送消息；不把人工观察提升为供应商C3。真实浏览器核对表单将在下一集成轮复验；本切片不沿用先前浏览器结论冒充完成。

## 2026-10-26 00:26 UTC 完整集成快照

1331键UI源码摘要37ff8682c13f75bed1a3e2678b97ba1ddfd43cc7184dd98f5b195a338384f66e：736文件、74批、8289项全部通过，零失败/跳过，执行期间源码未变。server标准资源串行构建及UI生产构建通过；server build-info对应064da700af3cf6ef5760825e995e50f79461eab3，编译入口48项HTTP/DB通过（仍使用workspace TS依赖loader）。

随后独立authenticated/private实例的真实Chrome测试已完成本地测试IdP的签名回调、首位管理员认领、未受邀拒绝、Viewer邀请及读写隔离、旧密码账号显式绑定并以SSO回到同一userId。详见OIDC-BROWSER-20261026.md。真实流程发现三项UI缺口，正修复；以上整套快照不是这些修复后的结论。所有供应商C3仍未验收。
