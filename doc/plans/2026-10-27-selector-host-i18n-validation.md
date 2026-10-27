# 智能体选择器宿主文案：验证记录与人工检查

日期：2026-10-27。仅覆盖动态审查报告中指定的 7 个宿主文件，不代表页面整体已完成 i18n。

## 修改边界

- `CompanySkills.tsx` / `.production.tsx`：安装与附加智能体选择器的空态、必需/不支持技能说明、版本标题/最新选项、暂停标记，以及四处 `All skills` 入参。
- `PermissionsPanel.tsx`：选择器提示、选中数量、无编辑权限空态、安装设置强制说明。
- `EmailEndpointSetup.tsx` / `ChatEndpointSetup.tsx` / `Secrets.tsx`：报告列出的选择器 placeholder / emptyMessage。
- `ProfileWizard.tsx`：StepAssign 的已有配置、组织默认配置、无配置描述。
- 未修改 AgentSelect / AgentMultiSelect 默认实现、权限规则、事件回调、API、筛选逻辑或数据载荷。名字、title、adapterType、版本号/标签、`__latest__` 和 ID 保持原义。
- Skills 的 `No agents yet.` 分支按既有控件条件不可见；这里只防御性复用已有空态翻译，不将其计为新的运行时缺口。

## 自动验证的不同覆盖层级

| 验证 | 覆盖与限制 |
| --- | --- |
| `selector-host-surfaces.test.tsx` | 挂载真实 `ProfileWizard.StepAssign`、`PermissionsPanel` 与真实选择器/弹层；四语切换保持筛选输入、焦点/选区、选中 ID、必需项禁用及原始名称/title；显式点击才触发回调。不是整个向导或 App 路由 E2E。 |
| `EmailEndpointSetup.test.tsx` 新增四语组 | 挂载真实邮件设置宿主与选择器，API 为测试替身；待真实查询状态解除 disabled 后开窗，热切不增加读取、设置调用或改写草稿。没有真实邮件/凭据/外部服务操作。 |
| `selector-host-wiring.test.ts` | 读取 7 个宿主的精确 prop、翻译调用和回调文本，确认版本哨兵值、原始 adapter/title/profile 名称通道等仍保留。仅源接线契约，不是 AST 编译检查，也不等同于运行时验证 Skills 两壳、非邮件 Chat 或 Secrets。 |
| 四语资源校验 | 对比 23 个条目的形状、插值和单复数计数展示。 |

结果：上述三个 focused 文件 **64/64 通过**（含 31 个新增用例），token 四门检查与 `git diff --check` 通过。
轻测使用已有 Vitest、单 worker、Node 640 MB，独占临时目录；未安装依赖或运行全量类型检查/构建。
首轮夹具问题（等待 Email 可点击、当前 TypeScript 包无 compiler API）已修正，不改业务代码来迁就测试。

## 待人工检查（测试环境）

1. 英文、简中、西文、日文各检查宽屏/窄屏。Skills 两套界面打开目录筛选及智能体选择器，确认长说明、版本标题与暂停徽标不遮挡控件。
2. Skills 选择已有版本后切语：版本 ID、版本号、自定义标签、智能体选择不变；取消不安装、不附加。`Latest` 仍对应原 `__latest__` / null 语义。
3. Permissions 选择器切语时确认强制安装项仍不可取消，其他项只在显式选择后提交；无编辑权限时不出现可选项。
4. 邮件/聊天设置与 Secrets 只检查选择器文案和取消路径，不输入真实凭据，不触发真实连接或密钥绑定。
5. Profile 与邮件选择器使用真实中文/日文 IME 组合输入再切语，检查候选框、焦点、筛选草稿。jsdom 的原生 value/input 事件断言不是浏览器 IME 证明。

其余宿主标题、说明、错误消息及未列出的控件仍属于其他片段；本记录不宣称全页或全站四语验收完成。
