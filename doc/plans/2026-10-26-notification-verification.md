# 通知 endpoint/version 验证切片

基线：`45a234e289b14fd5a8177a61bc69f2be6368bcc3`。原 §7.4/§9.4；不新增供应商独立认证要求。

## 合同与失效

- 当前版本观察按公司、endpoint、configVersion独立查询；不是通知中心最近100条的客户端推断。最新pending/失败不被旧accepted覆盖。
- HTTP202只是测试入队；worker保存accepted只表示平台业务接口受理，不等于送达/已读/C3/C4。旧review accepted仍是管理员“报告受理”。
- configuration=`saved_not_revalidated`：GET不再次解析秘密或重做配置校验。原保存配置可能读取已配置AWS等秘密provider，本轮不改变该行为；保存不发送消息，新verification读/声明不新增任何外部调用。
- credentialStatus=`metadata_active`仅表示本地秘密/版本/provider元数据允许使用，不代表远端账号、token或权限仍有效。未固定远端VersionId的秘密不能提供精确账号/版本验证绑定；原发送合同不变。
- endpoint verificationEpoch仅被凭据安全变更递增；名称、resolve更新的updatedAt、普通token缓存刷新不递增。暂停endpoint/worker也不递增。
- 新delivery由DB触发器固定epoch，涵盖既有SQL run.failed生产者。旧行不回填；manual-retry不补上缺失epoch，不将旧观察变成当前证据。
- `doc/plans/sql/2026-10-26-notification-verification.sql` 是A0待分配迁移号的提案，不是已应用迁移；journal/snapshot集中维护。schema依赖其应用后才能部署。
- 凭据变更持有来源行然后更新endpoint；声明事务必须按company台账锁→providerConfig→secret→pinnedVersion→endpoint锁序，禁止endpoint→secret倒序。公司台账与既有adapter记录共用revision和幂等边界。

## 本地检查（不是供应商验收）

第一片：512MB/单worker，server只读query fixture7项、shared严格快照匹配6项通过。没有运行数据库或provider。

命令：

```sh
cd server
NODE_OPTIONS=--max-old-space-size=512 node ../node_modules/vitest/vitest.mjs run --config vitest.notification.config.ts src/services/mimouse-notifications/verification.test.ts --maxWorkers=1 --pool=forks
cd ../packages/shared
NODE_OPTIONS=--max-old-space-size=512 node ../../node_modules/vitest/vitest.mjs run src/notification-verification.test.ts --maxWorkers=1 --pool=forks
```

第一次命令误在server目录创建相对路径，已移回计划目录；未找到测试退出。下一次标准config因复用node_modules指向主树而找不到新shared文件，改用显式当前工作树shared alias的纯fixture config后通过。无安装、无服务/DB/网络。类型/构建、迁移、真实DB并发与浏览器留中央验证。
