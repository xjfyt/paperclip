# 本地 OIDC 浏览器验收（进行中）

只使用助手云端Chrome、独立authenticated/private实例和回环测试IdP。所有用户为paperclip-fixture.invalid的虚构身份；不是实际Casdoor租户，不提升C3/C4。监听3101/3102，供应商、通知外发、GitLab发布和收费Agent开关全部关闭。

- 测试IdP具有RSA签名/JWKS、nonce、单次授权码和S256 PKCE、固定客户端/回调/注销地址，拒绝外部origin与重放。两项实际HTTP协议测试通过。
- 干净隔离数据库首次迁移通过0334至0343，旧实例不覆盖。使用单独cookie实例前缀oidc-fixture，保留原浏览器测试数据库。
- 首次SSO按钮实际跳转到本地IdP，授权URL具有state/nonce/S256。首次表单提交因夹具CSP仅允许self而阻止跨端口回调；将form-action精确加入固定测试应用origin，保留其余CSP及回调白名单。未修改生产应用安全策略、未绕过浏览器安全警告。
- 待完成：签名回调后会话、初始管理员认领、公司邀请/未邀请隔离、旧账号绑定、注销与停用。这些步骤尚不能标记通过。

## 00:17 UTC 已观察的本地 C2 结果

- 测试Owner完成真实浏览器SSO回调，GET session成功；通过正式bootstrap/claim认领一次性测试实例管理员，并创建“OIDC 本地隔离验收”组织。没有创建或调用任何模型。
- Owner通过成员页创建Viewer只读邀请，退出后返回/auth；随后用Outsider身份登录。界面显示No organization access，访问既有公司issues接口实际403。
- 同一Outsider接受正式一次性Viewer邀请后，原issues接口返回200/空列表；后台join-request管理接口仍403，不因成员身份升级为管理员。该身份现在是受邀Viewer，名称Outsider仅为固定测试标识。
- 发现待修复的真实UX缺口：无组织访问页只有提示而无退出/切换账号按钮；只读Viewer进入空组织概览时仍自动弹出创建首个Agent引导；邀请页在有效详情旁短暂显示Invite not found。首位管理员、成员与部分设置导航仍有英文。整套UI快照运行期间不改源码，先记录，再修复和复验。

00:21 UTC补充：使用独立、真实OAuth会话的本地HTTP客户端复验，先核对数据库data_directory与一次性夹具标记。受邀Viewer读issues=200、写issues=403、通知管理=403；另一未邀请Member读既有公司issues=403、公司列表为空。没有绕过认证或直接写成员关系。安全回执只保存状态和虚构资源ID，不保存cookie/token。另由Owner通过正式API创建Legacy只读邀请供后续浏览器绑定测试。

00:25 UTC补充：浏览器通过正常邮箱/密码注册虚构Legacy账号，接受只读邀请后从Profile显式绑定Casdoor。真实list-accounts返回credential与casdoor两条关联，均属于同一原userId；退出后纯SSO再登录仍为该userId，保留原显示名和成员身份。没有用同邮箱自动合并替代显式关联。实际Casdoor租户停用与back-channel logout仍未验收。

00:38 UTC修复复验：独立实例重启加载新源码和1367键UI，Legacy Viewer进入空组织概览不再自动弹出创建Agent引导，显示“请联系组织管理员创建首个Agent”。新增setup-capabilities沿现有authorization service判定，不按客户端role猜测，未知/刷新/错误状态也不放行。此前Ctrl+C同时终止embedded PG时出现服务恢复/连接错误日志，进程最终退出并正常重新启动；不把关闭过程说成零警告。

00:43—00:50 UTC补充：无组织Member身份在中文、西班牙语页面使用真实退出按钮后返回登录页。独立OAuth客户端确认正式sign-out响应200/success、redirect=true，提供方logout仅指向固定回环IdP并带固定应用/auth回跳；随后get-session为401。高频连续登录曾触发429，停止该批并在限流窗口之后单独复验成功，没有禁用限流。Viewer的setup-capabilities为false，Owner为true。当前源API49项、路由4项、相关UI103项通过，按钮换行调整后再跑2文件25项通过；server/UI类型检查及UI构建通过。这些是当前修改的定向检查，不替代此前1331键快照的736文件8289项全量UI。

00:51 UTC邀请加载复验：从/auth携带固定邀请回跳，Member真实SSO返回新Viewer邀请后自动接受并进入西语组织概览，无此前Invite not found错误，也未弹创建Agent引导。此Member现在已有公司成员身份，后续不得再当作未邀请测试者。验收过程中与UI构建重叠导致一次index.html暂缺500；构建结束后reload完成，没有修改认证或跳过权限检查。后续浏览器验收不与同一dist目录重建重叠。邀请页未登录时仍只有密码表单，无Casdoor入口，列为下一切片修复，不能把此绕经/auth的验证算作邀请页SSO入口已完成。
