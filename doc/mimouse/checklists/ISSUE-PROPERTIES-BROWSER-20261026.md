# 任务属性与重复关停：真实浏览器局部验收

时间：2026-10-26 17:07–17:18 UTC。应用 `e39d0d4bdb300b10c1d75b20a03db538a8bd8eca`、3186键生产UI、源入口server、既有隔离PostgreSQL/回环OIDC真实fixture会话、云端Chrome。未连接真实供应商。

## 实际界面路径

- 在已有无Agent测试组织 `228403fa-1812-4f54-a356-6bc6214307db` 用“新建任务”创建纯夹具标题，未选择负责人、项目或执行环境；创建成功后正常进入实际任务详情。
- 任务 `MIM-1` / `72e9bd8a-fd24-45e5-9300-9626a359879a`，标题 `Browser 3186 property controls - no execution` 保持原样。
- 实际属性侧栏检查中文、英文、西班牙语、日语；属性标签和系统空项本地化，稳定tab ID `side-panel-tab-properties` 与任务ID不变。
- 中文输入“无项目”、西语输入“Sin proyecto”、日语输入“プロジェクトなし”均能搜索到对应系统空项目选项；西语界面输入原英文“No project”仍显示“Sin proyecto”。选择后仍按原语义清空项目与执行工作区配置。
- 语言切换不会改写已输入的搜索词。因此切语言后旧语言查询可能无匹配；本轮明确编辑查询，而非声称会自动翻译用户搜索内容。
- 查看了桌面中文属性布局；本轮使用直接文本输入，不是实际操作系统IME测试。复制工作区路径、其它有Agent/模型的高级属性、窄屏及真实供应商仍待手测。

## 独立数据库核对

17:14 UTC只读程序先核验fixture标记、`SHOW data_directory`真实目录与明确公司/任务ID，再读取：

- 标题保持不变，status=todo，assignee_agent_id=null。
- project_id、project_workspace_id、execution_workspace_id、execution_workspace_preference、execution_workspace_settings 均为null。
- 该公司Agent、heartbeat_runs、notification_deliveries、notification_subscriptions均为零；没有启动模型或发送通知。

## 关停局部复验

仅对本轮已确认运行的云端终端发送两次Ctrl+C；第二次发生在首次排空尚未返回shell时。最终终端返回提示符，数据库PID文件不存在；新增日志中heartbeat drain失败、HTTP drain超时、停止owned PostgreSQL各出现一次，没有误恢复。

这与独立Node子进程重复SIGINT/SIGTERM测试一起支持“同一根关停不重复启动”的窄合同。**数据库仍先收到终端信号，heartbeat/服务排空仍有ECONNREFUSED；不是完整优雅退出通过**。没有依赖detached补丁、强杀进程组或删除PID。

## 发现的后续漏译

真实截图还发现任务聊天输入框中的系统默认“No assignee”可见文字未本地化，虽aria已中文；已单独安排修复及可见textContent回归，不能因为属性侧栏通过就称整个任务页四语完成。

更多边界见 [属性控件手测](../../plans/2026-10-26-issue-property-controls-i18n-qa.md) 与 [关停记录](../../security/embedded-shutdown-recovery.md)。


## 后续3193键输入栏复验（18:11–18:21 UTC）

已补默认“No assignee”的可见文字，不只是aria。真实Chrome确认中文输入栏显示“无负责人”，菜单“选择负责人/搜索负责人/负责人”已译；输入“无负责人”与原英文“No assignee”均显示同一中文选项，Escape可关闭，没有发送或分配。其它语种与fallback分支由6文件347项定向回归覆盖；完整UI历史结果仍只对应3186冻结。菜单中用户自身的“Me”标签及未分配时占位语属于其它宿主文案，仍可继续改进，不宣称整个聊天页已无残余。
