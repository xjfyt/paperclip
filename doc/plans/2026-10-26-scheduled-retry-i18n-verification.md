# 定时重试属性与卡片四语核验（2026-10-26）

本片新增独立贡献 `issueRetryUi` 47 键（en / zh-CN / es / ja），不生成最终 locales。范围：`IssueProperties` 定时重试展开项和工作区等待行、`IssueScheduledRetryCard`、共享 `RetryErrorBand` / `useRetryNowMutation` 的本地失败和 toast 框架。

真实入口核对：独立卡片在 `IssueDetailActivityTab` 中，经典任务界面“活动”页签可见，不是默认聊天页标题。宿主测试使用经典界面和已有 `#document-continuation-summary` 路由进入活动页；未把被 mock 掉的聊天线程当作真实卡片宿主。定时重试属性则由任务侧栏承载。默认聊天线程中的独立运行历史文案不在本片扩展范围。

## 保持的边界

- 原 `scheduled_retry` / `max_turns_continuation` / `workspace_busy`、run / agent / issue ID、时间戳、接口参数、失效查询、pending / promoted / already_promoted / waiting / gate_suppressed 门禁不变。
- `retryScheduleDisplay` 直接沿用 `formatMonitorOffset` 的 due-now 判定，包含未来 30 秒、过去 60 秒边界；只显示本地化单位和“前/后”，不改调度器、宽限、倒计时频率。
- 已知原因仅翻译展示标签；未知原因（包括下划线、空白）保持原样。服务端 Error、outcome.message、用户/智能体名字、URL 与诊断不猜测翻译；错误句末保留原组件已有标点框架。
- 本地缺少 ID 错误以对象身份区分；服务端同名 Error 仍保留英文原文。非 Error 和空 ApiError 的本地兜底随语言刷新；toast 按事件语言创建，不重写既有 toast。
- 同步修正前片工作区测试的配置 fixture：补全必填 provisionCommand / teardownCommand / cleanupCommand / desiredState，移除不完整强制断言，不以 unknown 绕过类型。
- 工作区争用仍只等待，不增加重试按钮。不改权限、机器协议值、模型输入或锁文件。

## 已执行（jsdom / 单元，不是真实浏览器）

- 卡片、retry-display、monitor-display 完整 3 文件 137 项通过：四语 pending 禁重复、成功、门禁/等待、错误后重试、同挂载切语、未知原文、缺少 ID、本地 API 兜底；52 个相对时间边界和已知原因覆盖。
- `IssueProperties.test.tsx` 全文件 171 项通过：打开详情跨四语、请求中切语不重发、already_promoted 禁重复、关闭重开保持状态、原时间/ID/诊断，以及工作区争用不显示重试。
- 监测横幅、monitor-surface 资源、issue-monitor、runRetryState 回归 4 文件 59 项通过；合并定向 8 文件共 367 项通过，配置 fixture 补全后属性 171 项再次通过。
- 实际宿主筛选 `monitor|scheduled retry host`：11 项通过、138 项未运行。四语活动页卡片真实调用原 issue UUID、门禁原文与本地 toast 框架；138 个筛选跳过项不计通过。
- `check-token-gates.mjs` 与 `git diff --check` 通过。

```sh
# cwd: ui；现有 Node / deps，512MB，单 worker
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/components/IssueScheduledRetryCard.test.tsx src/i18n/retry-display.test.ts src/i18n/monitor-display.test.ts --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/components/IssueProperties.test.tsx --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ../node_modules/vitest/vitest.mjs run src/pages/IssueDetail.test.tsx --maxWorkers=1 -t 'monitor|scheduled retry host'
```

日志：`/tmp/retry-card-tests.log`、`/tmp/retry-properties-tests.log`、`/tmp/retry-host-tests.log`、`/tmp/retry-token-gates.log`、`/tmp/retry-regression-tests.log`、`/tmp/retry-final-tests.log`。

## 中央合成与真实手测清单（未执行）

- [ ] 中央合成资源后，任务侧栏定时重试与经典活动页卡片切换四语，无 raw key；长西语/日语、移动端、200% 缩放和键盘焦点可用。
- [ ] 普通重试 / 最大轮次续行 / 无排期 / now / 未来 / 逾期 / workspace_busy；检查显示变化不改变时间、原因及关联运行链接。
- [ ] 授权测试环境中验证 retry-now 成功、已提前执行、gate_suppressed、waiting 与网络失败；pending 不重复请求，关闭/切语不提交，错误后可再次重试。
- [ ] 同挂载切语保留原错误、状态和内容，返回/前进再打开正常；运行变为 queued / running / cancelled 后按原规则隐藏卡片。
- [ ] 中央完整类型、生产构建、全量回归与 CI。本片遵循资源约束未跑全量/重类型/构建，未真实执行 Agent 或网络请求。enrollment 与运行历史等另组处理。
