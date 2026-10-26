# 私有提示词准备/恢复/取消：实际浏览器验收

日期：2026-10-26，19:48–19:55 UTC。应用代码 `94c7c51ad65579480ed8da1a3d42acf25444b700`，3260键四语资源。自有云端Chrome，隔离authenticated实例和本地OIDC测试提供方；不是用户电脑、真实Casdoor或真实模型账户。

## 安全边界与夹具

- 使用专用可丢弃数据目录，辅助脚本先核验marker及PostgreSQL实际data_directory。
- 关闭heartbeat scheduler、Agent timer heartbeat、通知发送、WeCom worker、WorkBuddy和GitLab/修复执行；仅为本次元数据界面验证显式启用private prompt gate。
- 一个新建测试Agent仅有无效的测试API-key引用，用于配置形状校验。没有勾选三项执行/费用确认，没有点击执行，不调用真实CLI或外部模型。
- 固定文本技能快照与数据集案例由专用fixture建立；提示词版本通过真实UI保存、查看。没有执行注册表promote/rollback。

## 实际通过步骤

1. 从MIM-1进入真实输入栏，中文空负责人提示为“描述你希望完成的工作…”。负责人菜单系统本人显示“我”，关闭菜单未分配任务、未发送消息。
2. 打开提示词注册表，保存不可变测试版本，查看原文与hash，然后填写明确Agent/dataset/case/skillVersion引用。
3. 点击“准备 ticket — 不执行”，收到唯一票据、固定批准摘要、服务端保存的model/local环境/配置目录/固定凭据引用版本。界面明确目录不是最终执行目录、快照不是完整模型上下文。
4. 页面完整刷新后，同一票据、revision与批准摘要恢复。新的注册表写入/新准备被锁定；三项执行确认仍未勾选，执行按钮禁用。没有自动POST执行。
5. 依次切换中文、西班牙语、日语、英语，再回中文。状态/边界/确认文案切换，票据及摘要不变，确认没有被自动勾选。
6. 点击原子取消；界面显示已取消并释放父级操作锁。再次完整刷新、从注册表加载私有历史，服务端历史仍显示同一票据已取消。
7. 前后只读数据库核查：仅一条private test从awaiting_confirmation变为cancelled；issue/wake/run/attempt/spawn字段全部null，无私有结果。heartbeat runs、wake requests、notification deliveries、private execution authorization审计均为0。

## 非秘密证据定位

- fixture company：`228403fa-1812-4f54-a356-6bc6214307db`。
- revision：`f203fe7b-af6a-4d5b-9a58-262c84e91b2d`；registry selected/head始终null。
- test ticket：`3eba923b-29aa-45fe-87fd-5a515566a8d1`。
- approval digest：`5727086b9fa51310b494854e7ea125325e2bfb6e13690110b515a2f6032fa408`。
- 执行环境保留 `3260-browser-seed.json`、`3260-browser-before-cancel.json`、`3260-browser-after-cancel.json`。前后核对时间19:53:42与19:55:40 UTC。
- 初次辅助只读核查使用了错误的通知表名，返回42P01；已改为schema中的mimouse_notification_deliveries后通过，原错误日志保留。该核查失败没有执行写入，也不算应用测试通过。

## 没有覆盖的事项

- 没有真实收费执行、真实Claude安装/版本/参数兼容性验证。受限PATH可能不包含用户目录中的CLI，详见[部署及执行前置](../../plans/2026-10-26-p5-private-prompt-tests.md)。
- 真正execute响应丢失、实际权限撤销、跨账号、服务器进程重启中的不确定执行恢复由受控自动化负例覆盖；本次浏览器仅验证未执行票据刷新和取消，不能冒充这些真实故障场景。
- sessionStorage只保证同标签页；关闭标签页/跨标签页不保证恢复，须经历史读取核对。不能删除未知操作标记后直接重新执行。
- 未验真实移动端、IME、全部窗口大小或全部四语页面；仅当前实际页面范围。
- 原计划的提示词双版本固定集比较、受控运行态应用/回滚和实际成本路由仍不是本片完成项。

## 测试服务退出

19:57 UTC仅向本次前台服务发送Ctrl+C；PG PID文件消失，20:00 UTC实际终端已回到提示符。保留既有边界：终端信号可能先停止嵌入PG，drain仍记录数据库不可达错误；此次停止不证明已实现完全平滑关停。未删除PID文件或向不明进程发信号。
