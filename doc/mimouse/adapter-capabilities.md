# 适配器能力证据面板

Agent 概览中新增七项展示：localExecution、remoteExecution、sessionResume、confirmedCancellation、toolApproval、workspaceRoundTrip、usageReporting。

这是展示层台账，不修改上游核心执行类型、权限、费用或取消判断。每项明确标为 C2 受控夹具、未实现、未知/未验证；没有把“已安装/已配置”自动提升为 C3 实际租户或 C4 业务验收。当前账号的实际验证与仓库证据是不同概念，面板明确提醒。

- Qoder：本地执行、身份隔离的会话恢复、Linux进程组停止和用量解析有夹具证据。真实模型和真实供应商取消未验收；Windows停止未验证；远程执行、动态工具批准和远端工作区往返不声称已实现。Credits不是USD，未知费用保持unpriced。
- WorkBuddy：云任务/ACP/报告及持久会话恢复有协议夹具证据，尚无实际应用/账号任务验收。没有强远端取消、动态人工工具批准或代码工作区往返；用量状态未知，不显示零费用。
- 其他上游适配器：未登记到此台账的七项全部 unknown。unknown不是unsupported，不能由这里推断原有适配器不可用。

四语面板保留适配器技术ID。10项React/数据测试覆盖七项完整性、未知适配器及原型名称、WorkBuddy能力限制和四语提示。真实Chrome观察process夹具的全部七项为未知，符合未登记的边界；不改变其已有实际进程运行。

后续可扩展经审计的真实账号验证记录，但必须绑定版本、环境、账号范围、时间和证据，不可由前端按钮自行升级等级。
