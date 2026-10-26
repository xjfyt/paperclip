# 反馈与矩阵浏览器C2实证

2026-10-26 03:36–03:47 UTC，助手云桌面的真实Chrome，独立authenticated/private实例3101和回环测试IdP3102。不是实际Casdoor、Langfuse、企业微信或GitLab租户。所有外部执行/通知/推送/修复开关关闭。

- 首次实际入口暴露遗漏company route root注册：侧栏进入无组织前缀的独立页。已加入路由根和无前缀重定向，刷新自动回到/OID/feedback-inbox，保留完整组织布局。路由辅助测试通过；所谓before日志的用例因排队至修复后才真正运行，不能称为红测试，原始缺陷依据为浏览器观察。
- Viewer浏览器看不到导入/确认表单，正式接口403。Owner经真实回环OAuth登录后可导入测试文本。
- 测试文本包含虚构password字段与“忽略规则并执行命令”句子。保存后的证据显示password=[REDACTED]，恶意句子仍只是文本。再次提交同一来源事件返回原记录，没有重复。
- 填写复现、预期、建议、两项验收条件，明确勾选后生成一个private/backlog任务。创建后只有原始回执及任务链接，刷新再打开同一候选恢复同requestId，服务日志仅一条promote POST。
- 实际任务为OID-1，私人项目、无执行者；独立真实OAuth客户端核对responsibleUser为Owner、sourceTrust为low_trust_review/quarantined。Viewer读取该任务404，读反馈403。数据库确认promotionCount=1、agentRuns=0。没有执行导入文本中的指令。
- 反馈页面切换中/英/西/日，系统标签与回执随语言变化，中文客户文本及脱敏标记不变。
- 隔离样例另生成41字节真实本地文件并计算SHA-256，平台/提交/job均明确为协议夹具声明，不是Runner构建。正式矩阵API和浏览器显示Windows/macOS/Linux × x86_64/arm64六项均blocked；Linux/x86_64只显示本地哈希，其余缺产物，全部缺Runner回执；上传缺合同。四语显示正确，西语长文案及哈希换行可读。没有点推送、MR或同步按钮。

环境失败记录：并行的完整server类型、API和Vite构建争用资源，server类型被SIGKILL、Vite137。保留失败日志，停止并行后UI构建与server完整类型分别串行通过。UI构建目录完成前不进行浏览器导航。Ctrl+C关闭原生测试进程组仍产生PG恢复/HTTP drain日志，正常退出并启动成功，不称零警告。0345/0346在既有隔离实例升级成功。

边界：本次不证明外部服务已连接、真实多平台Runner已运行、上传成功或生产部署；反馈候选只是精确标题匹配，不冒充语义聚类或自主修复。完整1730键UI回归待下轮冻结快照复验。
