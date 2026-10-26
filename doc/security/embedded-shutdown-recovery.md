# 嵌入式 PostgreSQL 关停期间禁止恢复

2026-10-26，独立生命周期修复；不是 onboarding UI 失败。

## 原始观察与根因

本地全新 onboarding fixture 正常启动。11:42:33 Ctrl-C 后，日志先记录 embedded PostgreSQL 以 code 0 退出并尝试恢复，11:42:34 恢复成功，HTTP listener 五秒排空超时后，11:42:38 才记录停止 embedded PostgreSQL。最终 postmaster.pid 不存在。

服务器原先直到最后的 provider-stop 步骤才设置 supervisor 的 shuttingDown；HTTP 和应用排空期间收到 child exit 仍会恢复。依赖启动 PostgreSQL 未设置 detached，终端 Ctrl-C 可独立送达子进程；去除依赖导入时注册的 Node signal hooks 并不能隔离终端信号。

## 最小改动

- root shutdown 在首个 await 之前，对本进程拥有的 supervisor 同步调用 beginShutdown；仅禁止恢复，不提前停止仍存活的数据库。
- 实际 provider stop 保持在 HTTP、应用服务、数据库连接池清理之后，原有 ownership guard 不变。
- shutdown 独立缓存 Promise；提前标记不会跳过最终 stop，并发调用等待同一完成/失败结果。
- beforeRestart await 后再次检查，禁止在该等待期间关停后创建 replacement。
- 已经开始启动的 replacement 在完成启动后立即清理；最终 shutdown 等待恢复链及这次清理。

## 纯测试及复验点

```sh
cd server
NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run \
  src/__tests__/embedded-postgres-supervisor.test.ts src/shutdown.test.ts --maxWorkers=1
```

Supervisor 用 EventEmitter 和 deferred Promise 模拟，无真实 child/DB/网络：

1. 非关停期间异常退出仍恢复；恢复次数仍有上限。
2. beginShutdown 后，在排空期间以 code 0 退出：不创建 replacement、不重复 stop 已退出 child。
3. 存活 child 不被提前停止，最终 stop 只执行一次；并发调用得到同一 Promise。
4. beforeRestart 正在等待时关停：恢复后不再创建 replacement。
5. replacement 正在启动时关停：启动完成后停止 replacement，关停 Promise 等待清理，不报告 recovered。
6. retry delay 中关停：不恢复。
7. 最终 stop 失败：相同 Promise 持续返回该失败，不启动第二次 stop 或 recovery。
8. 既有 shutdown.test.ts 校验排空/应用/连接池/provider 的顺序及异常继续清理行为。

后续真人本地复验可在独立新 fixture 启动后 Ctrl-C，确认正常关停窗口不再出现 recovered，并检查最终 owned child 已退出。不要批量 kill 进程、删除 PID 或碰其他实例。

## 边界

这不是进程组隔离：不保证终端 SIGINT 后数据库仍可用于排空，也不回溯取消 Node 尚未处理关停信号之前已执行的恢复。原有启动/停止无响应的限制不在本次范围内。未新增 kill、PID 删除或外部/复用实例接管。仅运行纯测试，不运行真实 PostgreSQL、HTTP 服务、构建或重型类型检查；原始观察不是本次修复的 live 回归结果。

## 原生终端复验（2026-10-26 11:51–11:55 UTC）

在同一带标记、零Agent/任务的隔离实例重新启动当前源码，再从前台终端按Ctrl-C：修复后不再出现意外退出恢复/重新启动记录；最终出现停止记录，数据库pid文件消失，终端返回shell。原日志和复跑日志均保留，早期中途快照 `shutdownLogged=false` 已由最终快照纠正，不能用中途状态误判失败或完成。

**限制和代价不能隐藏：**修复前就已有 `graceful heartbeat run drain failed`；PG先被终端进程组信号关闭，随后意外恢复偶然帮助其他数据库清理。修复后不重启PG，数据库依赖的清理出现更多连接拒绝，观察到退出约18秒，相比原场景约5秒更慢；HTTP drain仍触及5秒上限。没有证明活跃任务下状态不受影响，也没有解决终端信号隔离或所有清理的优雅退出。

本补丁只保证服务器进入shutdown后不主动进行恢复，不提前停止原本仍活着的自有数据库，不改变外部/复用数据库的所有权边界。真实部署仍应验收进程管理器仅向Node发送终止信号时的有序清理，以及活跃任务恢复；不能把零任务样本当成完整生产退出验收。

## Root 关停协调前置收口（2026-10-26）

**本片不是终端信号隔离修复。** 16:22 UTC 的 native 复验仍出现 heartbeat drain 连接拒绝、HTTP 五秒排空超时和应用服务清理失败，至 16:22:45 才进入 provider stop。终端返回 prompt、postmaster.pid 消失且无误恢复，只证明该样本最终退出，不证明完整优雅退出。

此前共享 Promise 仅在 embedded supervisor 内；root 的两个 `process.once` listener 和程序化 shutdown 仍可各自重新执行 teardown。本片把 root 入口统一到 `createCoordinatedServerShutdown`：

- 首次调用先发布工作 Promise，随后同步禁止 supervisor recovery/heartbeat scheduling，再执行原有排空。同步重入也取得同一个 Promise。
- SIGINT、SIGTERM 使用本次实例拥有的持续 listener；同信号、混合信号和程序化调用共用一次工作及结果。首次 signal 才请求进程退出；程序化先开始、signal 后加入也只退出一次。第一调用的 signal 决定排空参数。
- begin/drain 的未捕获错误不会跳过既有最终清理。等待最终清理结束后，程序化调用仍收到原错误；两阶段都失败时用 AggregateError 保留两个错误。signal 路径记录一次错误并以非零状态退出，不假报成功。
- 最终清理完成或拒绝时，只移除该协调器自己的两个 listener，不移除预先存在或后来加入的其他 listener。纯程序化 shutdown 不调用 process.exit。
- HTTP 关闭统一走既有五秒预算的最终清理，不再在程序化尾部重复调用无独立预算的 server.close。服务、连接池、owned provider 顺序及所有权条件不变。

### 本片验证

```sh
cd server
NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run \
  src/shutdown.test.ts src/__tests__/embedded-postgres-supervisor.test.ts --maxWorkers=1
```

本轮两个文件 **38 项通过**。新增协调测试覆盖：同信号重复、两信号混合、signal-first / programmatic-first、同步重入、自己的 listener 移除与其他 listener 保留、begin/drain/finalizer 单错和双错、最终清理只执行一次。

其中一项在 POSIX 创建单个 Node 测试子进程，真实向该 ChildProcess 依次发送 SIGINT、第二次 SIGINT、SIGTERM，等子进程确认收到后才释放假 drain；验证进程正常以 0 退出且 begin/drain/finalize/exit 各一次。仅引用本测试创建的 child，无负 PID、组 kill、真实 PostgreSQL 或其他会话；失败时清理也只针对该 child。Windows 跳过这一项，其余协调器测试不依赖 OS 信号。

另以 512MB 执行只含 shutdown.ts / shutdown.test.ts 的独立 TypeScript 检查；不代表 index.ts 的完整项目类型检查。未运行全仓 typecheck/build、真实 PostgreSQL、浏览器或活跃任务验收；不改共享 node_modules、依赖 patch、lockfile、system/security 设置。

### 必须保留的限制

- 前置 begin/drain 抛错会跳过该 drain 中剩余步骤；本片保证的是仍进入一次最终清理，而非每个 worker 都停止成功。既有 finalize 内部自行记录并继续的失败仍保留原语义，不在本片转换成 rejection。
- 不新增总超时或强制停止策略，沿用已有各阶段预算。因此不能声称所有关停路径都有界：未完成的 worker/drain/provider Promise 仍可能阻塞；等待期间重复信号加入同一工作，不作为强制退出捷径。
- 同进程组中的 PostgreSQL 仍可能先收到终端 Ctrl+C，本片的真实 Node 信号测试不能作为 DB 维持至 drain 完成的证据。正常 SIGTERM、活跃任务状态保留以及真正的终端 DB 顺序仍待后续验收。

### 候选后续：依赖隔离，尚未实施

本地已安装 embedded-postgres 18.1.0-beta.16 没有可注入 spawn 配置的公开 API。最小候选是扩展仓库已有 patch，增加显式 opt-in，仅 POSIX 的 postgres spawn 设置 detached，保留 pipes/ChildProcess 引用、不 unref；只由本进程创建的新实例和 recovery replacement 开启。initdb、外部/复用实例和 Windows 保持原行为。不得直接改共享 node_modules。

父进程单独收到 SIGKILL **本来就不保证子进程被杀**，不能把所有孤儿风险说成 detached 新增或声称原实现安全。detached 确实改变终端/会话信号传播；异常退出、启动尚未交接 ownership、recovery 正在启动、stop 超时都需另行审计。重启时继续核对 PID/dataDir/实际数据库目录；匹配活进程只复用、不接管停止权限，不通过删 PID 或杀进程组“恢复”。

后续验证应只复制小型依赖 JS/声明/元数据到隔离 staging，逆向已有 patch 得到匹配基线后以 patch --check / apply 验证候选，再用 fake-spawn 测开关及跨平台分支。真实 POSIX 测试须使用新建、可追踪的最小子进程/测试会话，证明信号隔离与有序停止；不得向未知/共享组发信号，也不得用 mock 宣称 native 问题已解决。真实 PostgreSQL和终端验收需独立 fixture及明确所有权。若最终采用 patch，发布 marker、安装完整性和 lockfile patch hash 必须一致；当前未安装、未修改/提交锁文件，不把隔离 staging 等同 frozen-install 通过。
