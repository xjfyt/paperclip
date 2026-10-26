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
