# 私有准备恢复与历史比较：实际浏览器验收

日期：2026-10-26 20:40–20:58 UTC。代码及server构建印章：`0cd351c41f760a56ee8f1b2b2e63b630b9f6c634`，3312键四语。自有云端Chrome与隔离authenticated实例、本地OIDC夹具。**没有真实CLI、外部模型执行或真实费用。**

## 一、错误引用与大写UUID恢复

使用先前MIM的无执行夹具，保持scheduler、Agent timer heartbeat、通知及外部业务worker关闭。

1. 选择已有固定revision，输入格式合法但不存在的Agent UUID，其余三个固定UUID使用大写。点击metadata-only准备，真实HTTP返回422，父写入锁和原请求身份保留。
2. 点击“放弃本地准备并编辑”。界面明确只清本标签页准备标记、不取消服务器票据；字段恢复可编辑。服务日志在该动作期间没有新增POST，不自动准备或执行。
3. 将Agent UUID更正为实际测试Agent的大写形式，另一次明确点击准备。四个大写输入被正确处理，返回新票据及固定批准摘要，无绑定卡死。
4. 三项执行确认始终未勾选，执行按钮禁用；只点击原子取消。新票据持久状态cancelled。
5. 只读DB核查MIM：旧、新两条票据均cancelled，执行相关字段全null；runs、wakes、notification deliveries及private execution authorization均为0。

证据：失败准备请求ID `2dba6716-b31b-4325-a16b-e29d7d0c4dd3`；新票据 `2d38f30c-464a-413a-9d1c-6058c1fb7794`；批准摘要 `0d480b204eec5807d8205ff0a1763286335cd49e801a2332a9c3200650a7f30a`；执行环境 `3312-recovery-receipt.json`。

该出口**不适用于任何已知票据或可能收费阶段**。真实execute响应丢失等故障仍以受控负例及后续实际环境验收为准，不能用本次metadata-only操作证明未知收费可以放弃。

## 二、明确合成的历史比较夹具

另建专用组织 `Synthetic comparison 3299 - no execution`（CMP）。Agent为paused，定时唤醒关闭。直接构造两条已封存private test、两个run及两个wake的历史记录，包含固定文本、witness和版本hash；**这些数据库记录不是实际执行证明**。不存在真实账户/API-key或供应商调用。

- company：`aaaaaaa1-1111-4111-8111-111111111111`。
- prompt：`aaaaaaa2-1111-4111-8111-111111111111`。
- dataset：`aaaaaaa8-1111-4111-8111-111111111111`。
- baseline/candidate revision：`aaaaaaa6-1111-4111-8111-111111111111` / `aaaaaaa7-1111-4111-8111-111111111111`。
- test IDs：`aaaaaa20-1111-4111-8111-111111111111` / `aaaaaa21-1111-4111-8111-111111111111`。

### 实际通过步骤

1. 从真实组织切换菜单进入CMP，经提示词注册表选择该prompt。比较表单以全部大写UUID明确指定两份历史，服务正确处理UUID语义。
2. 初始没有账本记录：两侧原文匹配均1/1，但总成本为“未知”，不能当零；报告保持blocked，明确显示baseline/candidate cost unknown。
3. 切换中文、西班牙语、日语、英语，质量/费用状态一致，阻断原因是四语可读说明并保留原机器码。切语言没有重新POST比较。
4. 专用夹具随后显式插入两条**合成**账本记录，每侧0.125分。界面仍保留旧读取快照，只有手动再次比较才更新。结果仅“可供人工审核”，并非发布批准，不应用配置。
5. 编辑上限时旧报告立即清空。上限0分再比较：超限blocked；上限1分再比较：可供人工审核。没有把未知费用、合成账本或质量分宣称为真实最终账单。
6. 暂停该合成组织的夹具成员资格，再通过真实页面比较，HTTP返回403，旧私有报告与引用内容隐藏。恢复同一成员原active状态后刷新，能重新进入，但不自动恢复旧报告或重新比较。
7. 比较区只显示聚合分数、ID/hash与阻断，不显示原始prompt/input/output；没有创建普通evaluation报告、审批或模型运行。

### 只读领域核对

辅助脚本在marker与实际data_directory核验后，只读比较六类领域记录的有序JSON指纹；认证session/lastSeen与本次人为权限夹具不在该领域指纹内，不宣称整个HTTP栈绝无写。

- 无账本阶段前后：`2fc1b49abb4dc1f0db39879ac42d9a4812f327aa0304cd572b26bbf8909dee0f`。
- 人为插入合成账本后，比较、预算变化及被拒绝读取前后：`8f92496c9113a1e2697f875e8f1cd22b395c3cdb59946740bfb83a57b5504425`。
- private tests/runs/wakes各2，未增加；cost events仅人为夹具从0增至2；普通comparison reports和activity始终0。每次比较前后领域指纹相同。
- 证据文件：`3312-comparison-before.json`、`3312-comparison-after-unknown.json`、`3312-comparison-known-before.json`、`3312-comparison-known-after.json`。
- 合成组织成员 `0e77a879-43cd-4479-b240-796cdea657ee` 已恢复active，恢复日志与刷新页面均已核对。

## 边界与待实际测试

- 本次证明真实UI/HTTP/数据库权限与只读展示流程，**不是模型生成质量、真实CLI发现/参数、真实Casdoor、真实计费或真实业务C3/C4验收**。
- 私有测试的固定PATH可能不包含用户目录安装的CLI；先按[私有执行手册](../../plans/2026-10-26-p5-private-prompt-tests.md)核验，不能自动回退到订阅或继承全环境。
- 本次角色撤销为本地OIDC测试组织。不同真实账号、真正并发网络响应和实际IdP撤销仍需用户环境验证；自动化另覆盖失序、fresh授权及存储失败负例。
- 未全面验证移动端、真实IME和所有窄屏布局。报告不代表普通runtime受控应用/回退或实际成本路由完成。
- 旧浏览器标签在CDP读取/填写时超时，未把失败算作通过；按支持流程在同一云端浏览器新标签继续，后续实际操作完成。没有修改浏览器安全设置或换用用户电脑。

## 退出与证据保留

21:02 UTC仅向本轮自有前台服务发送Ctrl+C，PG PID文件消失；21:05 UTC实际终端已返回提示符。沿用已记录的PG先接收终端信号导致drain报错边界，不据此声称完全平滑关停。未删除PID文件或修改系统安全设置。
