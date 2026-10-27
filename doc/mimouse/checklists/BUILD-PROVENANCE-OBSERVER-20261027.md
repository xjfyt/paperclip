# 构建来源验签与精确任务观测器验收边界

> 历史范围：本文“未接线”描述对应4513基础阶段。4578已增加受权API、持久回执与恢复；请优先阅读[当前接线清单](BUILD-OBSERVATION-RECEIPTS-20261027.md)。准入与六目标矩阵仍blocked。

日期：2026-10-27。代码来源：基础 `f2e32f89`、观测器 `66c1e378`；本轮冻结 `a68db2c3`。这是离线夹具验收与未来授权实测清单，不是平台发布/C3通过报告。

## 当前实际能力

- 两层均**默认关闭、尚未接线**：未给配置或显式 `enabled:false` 时不执行验证/网络读取。没有新增 UI 按钮、API 路由、数据库、凭据注册、签名器、CI写入或上传协议；不能要求用户点击尚未实现的采集入口。
- 纯函数 `verifyMimouseBuildProvenance` 检查 DSSE 包装的 in-toto Statement v1 / SLSA provenance v1，使用 Ed25519、标准 PAE 和原始 payload 字节。它不读网络、文件、数据库或时钟，当前时间及可信策略必须由未来服务端调用方提供。
- 成功 `verified_claim` 只证明签名及策略/上下文一致；**不等于产物代码签名、实际平台、测试执行、工作流依赖闭包或可信控制平面证明**。不能写成旧矩阵的 `signatureVerified=true`，不能据此宣称 SLSA 等级或发布就绪。
- `observeMimouseGitlabBuild` 只读固定 project/pipeline/job：job → pipeline → 指定产物文件 → 指定 DSSE 文件 → job复读 → pipeline复读，共6次 GET。无“最新成功”、任务名搜索、分页、重试构建、下载URL跟随、解包或执行。
- 观测成功可记录实际返回字节的 SHA-256/大小和最小化来源结果，但仍 `admission: blocked`；既有六目标矩阵全部 blocked，上传 blocked，`readyForRelease=false`，原 runner/test/signature 三项布尔值仍为 false。

## 可复现的离线定向检查

以下命令已对当前文件/标准配置作静态核对，**本清单整理时没有执行**。从仓库根目录进入 `server`，避免相对 setup 路径指向错误位置；使用已安装依赖，不安装/升级依赖：

```bash
cd server
CODEX_HOME='' NODE_OPTIONS='--max-old-space-size=640' \
  node ../node_modules/vitest/vitest.mjs run --config ./vitest.config.ts --maxWorkers=1 \
  src/__tests__/mimouse-build-provenance.test.ts \
  src/__tests__/mimouse-gitlab-build-observer.test.ts \
  src/__tests__/mimouse-build-matrix.test.ts \
  src/__tests__/mimouse-gitlab.test.ts
```

标准 [server/vitest.config.ts](../../../server/vitest.config.ts) 加载 [setup-supertest.ts](../../../server/src/__tests__/setup-supertest.ts)。`CODEX_HOME=''` 仅使 setup 建立临时测试目录及虚构 `sk-vitest` auth；它不是登录授权，也不会调用真实 Codex。setup 同时隔离测试 `PAPERCLIP_HOME`。四个指定套件使用注入传输/假响应及内存临时签名密钥，不需要真实凭据或真实 GitLab 调用。

## 夹具验收：应通过的窄合同

1. **默认关闭**：省略配置与显式关闭都不读取调用方字段、不调用传输/时钟；配置来源必须是运营方服务端，不接受 envelope 自带 key/policy 或请求里的“可信”开关。
2. **真实密码学、有限结论**：用内存生成的 Ed25519 密钥核对官方 PAE 向量、UTF-8字节长度、原始签名字节；改 payload/签名、错 key、未知 key、重复 key ID/同 SPKI 别名均失败。签名有效但策略不符仍必须拒绝，不升级其它证据。
3. **时间/绑定**：覆盖撤销、过期、未来偏移、起止顺序、从开始时刻计算的有效期、公司/源码SHA/产物名与摘要/invocation不符。重验不刷新签名构建时间；相同有效构建可重查，不宣称有持久防重放或跨操作授权保护。
4. **精确身份与 P2 修复**：job、pipeline、project和源码均须匹配，下载后两次复读变化仍阻断。ID在 JSON 转数值前要求正安全十进制整数；`42.000000000000000001`、`42e0`、超安全整数应拒绝，不能经舍入冒充预期ID。无关的 duration 小数仍允许；该 P2 修复及回归已包含于观测器提交。
5. **有限输入/网络**：覆盖重复及转义重复键、危险键、BOM/无效UTF-8、嵌套/大小上限、路径穿越和编码歧义、401/404/206/3xx、错长度/摘要、流中断、取消和超时；保留稳定错误码，不输出 token、PEM、原始供应商响应或异常串。
6. **流式与最小化**：按真实流字节计数/哈希，不信 Content-Length；元数据2 MiB、产物64 MiB、DSSE96 KiB，总截止最多30秒，所有读取/复读/验签共用。失败/超限取消 body，迟到响应也释放；产物不完整缓冲、不保存、不解包。HTTP透明解码后的返回表示字节才是哈希对象。
7. **未知不算通过**：缺 erasure/expiry 字段保留 unknown blocker；旧 expiry 不证明已删除。没有明确 invocation 映射就不验来源，不能从 envelope 猜；job成功/JUnit/人工可信布尔值不能代替平台或测试证明。任意成功夹具最终仍不可放行。

## 真实 C3 前置条件与当前阻断

仅在明确授权限定真实 GitLab 实例、项目、任务及只读范围后，才可安排真实读取；本轮未提供/读取真实凭据、未做真实调用。即使得到授权，未完成的接线不能靠手工填“已验证”绕过。

- 运营方可信根：确认 builder 身份、密钥来源/保管/轮换/撤销、当前 policy revision、SPKI及策略指纹；不能把任意租户任务持有的签名密钥当作可信控制平面。
- 当前授权：未来调用方重新核验 company/operation→source/project→pipeline/job 的关系、当前凭据权限、当前服务端时间与策略；旧快照和客户端自报期望不能建立权限。
- GitLab版本与精确任务：记录目标实例版本/端点能力、固定 project/pipeline/job及source SHA、两个固定产物路径、期望大小/摘要。当前无跨项目或 synthetic commit 映射，不能改用 latest-success 来补证据。
- recipe与隔离：审定 buildType、工作流不可变 ref、全部 external parameters，以及 include/依赖/runner环境闭包与控制平面隔离；精确参数匹配只是一条签名声明，不是闭包已独立验证。
- 传输限制：只允许明确来源白名单的 HTTPS、DNS固定的受保护传输；**私网端点、重定向及 GitLab CDN 跳转当前均拒绝**，凭据不向跳转目标转发。遇到这些目标应记录 blocked，不绕过保护、不声称已适配。
- 仍需独立补足：真实产物平台与架构、测试执行证据、代码签名、可信采集及持久历史/重放策略、六目标实测。最后两次 GET 只提供有限快照，不保证之后未变更；签名构建时间也未被独立证明等于 GitLab执行时间。

## 证据与当前结果

- 设计：[来源验签基础](../../plans/2026-10-27-mimouse-build-provenance-foundation.md)、[精确任务只读观测器](../../plans/2026-10-27-mimouse-exact-job-observer.md)。实现：[纯验签器](../../../server/src/services/mimouse-coding/build-provenance.ts)、[共享合同](../../../packages/shared/src/mimouse-build-verification.ts)、[观测器](../../../server/src/services/mimouse-coding/gitlab-build-observer.ts)、[观测合同](../../../server/src/services/mimouse-coding/gitlab-build-observation-contract.ts)、[原矩阵](../../../server/src/services/mimouse-coding/build-matrix.ts)。
- 中央定向4文件128项已通过（观测器57项包含在内），日志 `/tmp/paperclip-4513-build-provenance.log`；这是离线测试证据，不是上述标准命令在本次文档工作中另跑的结果。
- 中央标准server/shared构建与标准server配置128项回归已通过；163项编译入口API及834文件10570项UI严格聚合通过。真实GitLab/controller/C3、平台构建、签名与发布验收未执行，不能由这些离线结果替代。

中央整合更新（2026-10-27 12:06 UTC）：4513键完整UI类型/生产构建、784项UI定向、标准server/shared构建、标准配置128项构建来源回归及163项编译API已通过；新输入834文件84批10570项完整UI严格聚合通过。具体日志、首轮失败修复与环境边界见[VERIFICATION](../VERIFICATION.md)，不能外推真实浏览器或C3通过。
