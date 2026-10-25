# 本地集成验证记录

核验日期：2026-10-25 UTC。基线为 v2026.1023.0 / 1b4c803816e82b0265c8422e1a804327a7ed8c54。开发分支 mimouse。此记录是可审查候选版的本地证据，不是全部需求完成或生产上线证明。

## 已通过的检查

| 检查 | 实际结果 | 范围与限制 |
| --- | --- | --- |
| 四语合成 | 604 键，en / zh-CN / es / ja 键和占位符一致 | 词条数不是全应用覆盖率 |
| 全部 UI 测试文件 | 730 文件，73 批，8205 项通过，零跳过、零失败 | React/jsdom，不是真实浏览器 |
| UI 类型与生产构建 | 通过 | 大 chunk 与部分动态导入警告仍保留 |
| 完整服务端类型 | tsc --noEmit --singleThreaded 通过 | 不等于完整根目录 typecheck 脚本全部通过 |
| 服务端编译与资源打包 | 串行 tsc 生成 JS/声明，复制标准资源及 runner，写入 build-info 成功 | 与 package build 的步骤一致，但为云资源约束增加 singleThreaded；默认并行构建曾被 SIGKILL |
| 服务端定向安全/协议回归 | 13 文件，100 项通过 | 不是全仓所有 server 测试 |
| 外部适配器 | Qoder 17 项、WorkBuddy 5 项通过 | 真实子进程与假 CLI；非供应商收费任务 |
| 实际 HTTP/PostgreSQL | 源码入口19项组合通过；编译server入口20项组合全部通过 | 包括真实核心任务到已注册假 CLI 的运行记录、持久队列、OAuth 台账、CI 轮询与生产静态资源；workspace依赖仍使用TS loader |
| 迁移 | 0334–0339 已应用到专用隔离数据库 | 安全检查通过，20 项历史发现由既有 baseline 覆盖；生产升级演练未做 |
| 代码门禁 | no-git-push、设计 token gates、forbidden tokens 和 diff 检查通过 | 设计 token 检查不是安全凭据扫描 |
| 启发式凭据扫描 | 本次变更未发现所检查的私钥、GitHub/AWS/OpenAI 密钥格式 | 不能证明不存在所有种类的秘密 |

UI 测试源码摘要：6e66d7f2260b14d702176b8d5c23ee6aca56533b6a6ae08177a986b56028b4a0。执行期间 UI 源码未变；每批退出码、文件列表和日志由 test:mimouse:ui 保存。此前 577 键阶段发现过一项空格回归及一个被终止批次，已修复/整批重跑；没有把原失败结果改写为通过。

服务端串行构建的 build-info 对应代码提交 4a5778a7bf94497de8195ad6cf97e60a1a0a0450。后续文档或测试配置提交不意味着重新生成了这一二进制快照。

## 环境问题处理

Node 24.22.1、pnpm 9.15.4、Rust 1.97.1；不升级项目依赖来掩盖问题。上游 Rust runner 构建成功，保留 7 条警告。依赖缓存原在 /tmp 内存盘，占用数 GB，导致类型/构建被回收；移到磁盘后，完整类型检查得以完成，暴露的一处会计事务类型错误已修正。串行编译完成服务端产物。

tsx CLI 的进程间 Unix socket 在此云环境受限，源码启动采用 node --import tsx；隔离 embedded PostgreSQL 使用回环 TCP，不改生产数据库设置。测试显式清除继承的数据库 URL、配置、加密主密钥和外部执行开关，每次直接数据库写入前核验 data_directory。遇到隔离进程 PID 重用触发实例保护时，未删除 PID 文件或绕过校验，独立会话重跑通过。

## 尚未通过的检查

- Chromium 因进程 singleton 的 socket() EPERM 无法启动。云浏览器无法访问此隔离命令会话；官方 Playwright 浏览器与 headless shell 下载也未取得有效 ZIP。没有关闭云安全限制或读取受限目录来绕过。真实四语浏览器路径、视觉、实际输入法和可访问性验收仍 blocked。
- 官方 Qoder CLI 1.1.78 的实际版本、帮助和隐藏参数校验通过，但没有登录、调用真实模型或消耗额度。
- Casdoor、WorkBuddy、真实通知接收目标及 GitLab/Runner 缺少实连输入。所有模拟成功保持 C2；不标为 C3/C4。
- 根目录 pnpm build / pnpm typecheck 的全工作区脚本并未全部通过，不能以已通过的 UI 和 server 编译替代这一结论。
- 自动修复任务调度、统一能力面板、部分高频动态文案及应用 token 自动刷新仍有实现缺口，见 REMAINING.md。

## 复验入口

先按照部署文档准备独立测试目录与标记，确认不是生产实例。

- pnpm test:mimouse:ui：发现并分批执行全部 UI 测试；任何失败批次或源码变化都会返回非零。
- PAPERCLIP_MIMOUSE_TEST_HOME=<absolute-disposable-home> pnpm test:mimouse:api：启动源码服务并验证实际数据库/HTTP 链路，不启动浏览器。
- PAPERCLIP_MIMOUSE_TEST_COMPILED=true：上述 API 入口改用 node --import tsx dist/index.js；须先完成服务端和 UI 构建。server 入口使用编译 JS，但 workspace 依赖仍按上游 exports 指向 TS，因此保留 loader；这不是发布后全 dist 包的安装验收。
- node --test external-adapters/qoder-cn/test/*.test.mjs external-adapters/workbuddy/test/*.test.mjs。
- node scripts/compose-mimouse-locales.mjs --check。

外部适配器的实际 model hello probe 默认关闭；不得为复验此候选版自动开启收费探针或向真实收件人发送测试消息。
