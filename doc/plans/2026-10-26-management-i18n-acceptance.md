# 管理与运行路径 i18n 人工验收（2026-10-26）

原计划 §4.2 管理/运行路径分片补齐；只修改显示文案及本地错误描述符，接口、权限、金额、状态和业务正文不变。

## 第一片：成员偏好、审批、费用

- `useResourceMemberships`：收藏/取消收藏/退出/加入错误使用完整句子，不再拼英文动词；资源名称保持原样。toast 按触发时语言生成，已弹出的 toast 不承诺随语言切换更新。没有组织的本地错误保留翻译 key 到显示时。
- `ApprovalDetail`：六类本地失败保留描述符，切换语言可重新显示；远端 Error.message 不翻译。预算暂停说明的 `/costs` 链接保留原路由。
- `Costs`：借方/贷方、订阅入账费用、其他计费用量、缓存输入与输出说明，不改账务统计或费用合计。
- 新贡献 `managementUi` 由主集成统一生成 locales；本分支不编辑生成产物。

自动检查命令（现有依赖，512 MB、单 worker，无服务/DB/外网）：

```sh
cd ui
NODE_OPTIONS=--max-old-space-size=512 ../node_modules/.bin/vitest run --maxWorkers=1 \
  src/hooks/useResourceMemberships.i18n.test.tsx src/i18n/management-errors.test.ts \
  src/pages/ApprovalDetail.test.tsx src/pages/Costs.test.tsx
```

结果：4 文件 57 项通过（成员 hook 4、错误/字典 4、审批 13、费用 36）；三项 token 门禁与 `git diff --check` 通过。

人工检查全部待执行，按 zh-CN/en/es/ja、桌面/移动端分别记录：

- [ ] 用测试组织触发收藏、取消收藏、加入、退出失败；标题、重试建议本地化，资源原名/ID不变，原有缓存回滚仍有效。
- [ ] 触发审批本地兜底错误，保持页面打开切换语言，错误随之更新；服务器错误正文保持原样；预算审批不能绕过预算控制，`/costs` 链接可到达。
- [ ] 费用页核对借/贷、订阅月费与用量费分开说明；有/无其他入账费用两条文案、缓存输入/输出数值正确；筛选与币种原逻辑不变。
- [ ] 窄屏长文案不遮挡按钮，不出现原始翻译 key 或富文本槽位。

完整类型/构建、浏览器 E2E、真实权限/失败请求和账务对账未执行；静态候选不是完整覆盖率。技术路径、原始服务器错误、用户资源名及 token 数值不是待翻译的业务正文。

## 第二片：活跃 Agent 保存、重试与日志

仅处理 `AgentDetail.tsx` 的保存条/保存结果、内置资源及权限操作本地失败、恢复/重试按钮及兜底、运行日志加载/分页、复制失败提示。未挂载的 `AgentDetail.production.tsx` 不扩大修改；指令文件正文、命令、stdout/stderr、API 原始错误保留。

本地 `actionError`/`logError` 使用延迟描述符，切换语言仅更新显示；不再次调用保存、运行或日志 API。toast 沿用触发时语言。日志大小的数值格式按所选语言显示，不改变读取偏移。

自动检查：`AgentDetail.instructions.test.tsx` 12、`AgentDetail.log-visibility.test.tsx` 9、`AgentDetail.liveRun.test.ts` 12、`AgentDetail.progress.test.ts` 12、`management-errors.test.ts` 4，共 49 项通过；三项 token 门禁、差异检查通过。仍为 512 MB/单 worker，不包含完整类型/构建或浏览器。

- [ ] 在测试 Agent 编辑设置：未保存、保存中、成功/失败提示四语正确；保存/取消后再次进入无重复请求，原有敏感信息/权限边界不变。
- [ ] 对失败或失联测试运行检查重试/恢复/取消等待态、兜底错误；切换语言不再次重试，服务器错误正文保持原样。
- [ ] 模拟运行日志首次及追加读取失败：在错误仍可见时切换四语，无额外日志读取；分页大小/总量格式、已有日志与读取偏移保持正确。
- [ ] 禁止剪贴板权限后复制测试数据：本地失败提示本地化；不使用真实 API key 做人工截图。
