# FanPool 外部连接 Gate 包（准备完成，未执行）

目标唯一Supabase项目 `qygnwgovbwltffsytnje`（FREE），Vercel正式Origin `https://fan-pool-eta.vercel.app`。本地完成不授权远端写入、建用户、签名或部署。Leader确认后才执行具体Gate。

## 精确迁移
1. 认证声明文件 `server/auth/schema/auth.sql` SHA256 `9e92be830f60a5563627acc9fc30042e27e0e38c1c7740e7979cb87f11d57794`。
2. 商品资料声明文件 `server/metadata/schema/metadata.sql` SHA256 `908dbc394d7fe2f65a4073329ab5e27cf0449c7ef7fc790787a5451dd774c86d`。
3. 迁移管理员执行事务内DDL，先认证再资料；失败ROLLBACK。已有对象不自动覆盖、不DROP。两个文件均须执行前重新校验hash和人工确认差异。
4. 部署时单独创建受限登录 `fanpool_app_login`（继承fanpool_auth、fanpool_metadata_writer）及 `fanpool_read_login`（只继承fanpool_metadata_reader）。密码由项目管理员安全生成放到环境管理，不能写进SQL/Git/聊天。

## 只读预检
确认project ref、Postgres版本；盘点pg_namespace中的fanpool_private/fanpool_data、pg_roles中的角色及继承关系、pg_tables/pg_policies/pg_proc/pg_views、表owner和当前grants/default privileges。检查anon/authenticated无私有schema USAGE或写权限、无可调用SECURITY DEFINER绕过路径；检查API exposed schemas不含这两个私有schema。若已有同名对象先停止，比较结构后单独批准迁移，不使用IF EXISTS掩盖差异。

当前Leader浏览器记录：Web3 Wallet Disabled，Ethereum off/Solana off，Auth Users为空；Site URL=http://localhost:3000、无Redirect URL。OAuth控制台登录不等于应用Web3 provider启用。

## Auth 与运行配置
审批后仅启用需要的Ethereum Web3 Provider，Solana不需要。BFF直接signInWithWeb3，不需要OAuth回调跳转；但Supabase仍按Redirect URLs验证SIWE消息的URI与Domain，这项上游allowlist不能省略。[Supabase官方Web3文档](https://supabase.com/docs/guides/auth/auth-web3)

当前源码签名Domain为 `fan-pool-eta.vercel.app`，URI为 `https://fan-pool-eta.vercel.app/auth`。Gate应针对该实际URI配置精确Web3 allowlist，按官方强调的末尾斜杠规则列入 `https://fan-pool-eta.vercel.app/auth/`，并在获批托管测试中确认当前无末尾斜杠的签名URI被正确匹配。若不匹配，停止Gate并单独审查签名URI或精确配置的必要修订，不用通配符放宽，也不假定本地stub已验证上游匹配。本轮只修正文档，不改变签名源码或远端配置。

Site URL按实际站点设正式Origin。APP_ORIGIN精确检查是独立的应用边界，不能替代上游URI/Domain allowlist验证。Vercel Preview默认不获生产Origin授权，不信任任意Host或通配origin。

服务端环境：APP_ORIGIN、SUPABASE_URL、SUPABASE_PUBLISHABLE_KEY、AUTH_DATABASE_URL、AUTH_TOKEN_KEY（严格32字节hex）、METADATA_READ_DATABASE_URL；只在Vercel项目受控Server环境/本机忽略的.env或秘密管理器注入。DB连接TLS配置按托管官方连接要求验证，不关闭证书校验。AUTH_TOKEN_KEY跨实例保持一致；轮换会使旧密文会话失效，需另设迁移方案，不能静默覆盖。公开变量：Reown project ID、固定测试网RPC及Gate后真实factory/token/supplier/fulfillment，不得填本地Anvil地址。Node目标24.x。没有任何server密钥进public bundle。

## 前后核验与回退
DDL后查完整owner/grants/RLS、受限角色分别尝试SELECT/INSERT/UPDATE/DELETE、Supabase anon/authenticated真实REST/GraphQL/RPC绕过均拒绝。使用一次性专用测试EOA验证真实签名->Supabase原生session_id->BFF grant；测试过期/登出/跨实例刷新及资料发布。确认服务端固定链实际部署及创建块finalized，不能把客户端hash当权威。

两个独立设备/浏览器匿名读取同一真实托管记录、刷新/深链接；并验证创建成功保存失败及丢失响应只重试原池，资料/Auth故障仍可退款。全流程必须在相应后续Gate后做，WEB3本地结果不能代替。

回退优先关闭发布入口/撤销写登录权限，保留已有公开资料读取与直接链操作；不要删除已发布资料或链交易。紧急撤销应用会话可更新revoked_at/撤销连接角色，影响所有登录；不影响合约所有者或退款。数据库恢复需要备份与单独批准。首次不可变记录不通过“回退”改写；任何数据删除属于新授权范围。
