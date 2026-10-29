# 本地凭据与私密文件权限

> **对应代码** — `packages/shared/src/private-filesystem-permissions.ts`、`cli/src/client/mcp-auth.ts`、`cli/src/checks/secrets-check.ts`、`packages/plugins/sandbox-providers/daytona/src/private-filesystem-permissions.ts`
> **维护提示** — 凭据写入顺序、ACL 探针、允许主体、既有目录处理或受控副本变化时更新
> **最后验证** — 2026-10-30（对照本轮实现与真实 NTFS 拒绝/保全回归；不代表所有秘密存储路径或发行平台已验收）

## 一、权限按实际文件系统判断

POSIX 文件的 `0600`、目录的 `0700` 描述 owner 的访问范围。原生 Windows 的 Node `stat.mode` 或 `chmod(0600)` 不能证明 NTFS 私密性；不能把显示为 `666` 的文件直接当作泄漏，也不能因 `chmod` 调用成功就宣布安全。

当前受控 helper 在 Windows 检查真实 ACL：owner 必须是当前用户，允许访问主体限当前用户及操作系统特权主体 SYSTEM、Administrators。仅用于继承占位的 CREATOR OWNER 按实现限制处理。带链接/reparse point、额外主体的宽权限、无法确认 owner 或无法读取 ACL 的路径拒绝使用；拒绝不读取凭据正文。

## 二、新路径先保护、再写入秘密

新目录或文件必须由当前流程独占创建，且此时尚无秘密。流程先对空目录/空文件建立受保护的 owner DACL，再写入内容，并在需要时验证子文件继承与最终私密性。下载和压缩等暂存路径也遵守写入前保护；原子提升不能补救之前已经写到宽权限临时文件的秘密。

既有路径只验证，不自动改 ACL。拒绝宽权限的旧主密钥或凭据目录，是保全边界；不要为消除错误静默移除继承规则、跟随链接或接受不明 owner。处理前由用户或管理员确认路径和授权，保全原凭据引用及备份，必要时创建新的受控私密目录并重新登录/签发凭据。不要在普通日志、问题报告或命令输出中复制旧秘密。

## 三、探针不可用时保持拒绝

Windows 探针使用固定系统路径下的 Windows PowerShell 与 .NET ACL API，采用无 profile、非交互方式，不依赖外部 PowerShell 模块或用户 `PSModulePath`，也不读取秘密内容。执行失败、超时、平台能力缺失或不能确认权限时 fail closed。

遇到拒绝时，先核对实际目标路径、owner、是否链接、继承规则和额外 Allow 主体，再由有权限的负责人处理精确路径。不要关闭校验、扩大主密钥可读范围、删除互斥文件或把凭据转存到公开目录来“修复”登录。

## 四、模块与验证范围

MCP 凭据、CLI 本地主密钥检查和独立 Daytona host 暂存分别按各自入口执行上述策略，不能据此推断所有适配器和供应商路径均已完成权限验收。Daytona 的受控 helper 副本以源码一致性测试跟踪 canonical shared 实现，保持独立包的运行时依赖边界；私密提取暂存、保留普通工作区目录 ACL、宿主链接拒绝及成员路径验证规则见[插件说明](../../packages/plugins/sandbox-providers/daytona/README.md#native-windows-host-transfers)。

回归需要覆盖新空路径保护、子文件继承、真实宽 ACL 拒绝、旧路径不被修改、链接拒绝及探针不可用时拒绝。mock、POSIX mode 断言与原生 NTFS 测试分别记录。凭据文件权限通过也不证明远端认证、公司授权或业务写入已经成功；部署、备份与实际集成仍按对应[配置](01-configuration.md)、[备份升级](../05-maintenance/04-backup-upgrade.md)和[集成合同](../04-modules/01-integration-boundaries.md)验证。
