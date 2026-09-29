# WEB4 可审阅外部 Gate 包（未执行）

本包仅准备完成。执行顺序与每一类外部写入须获 Leader 明确批准；本地 PASS 不代表真实 Monad/Vercel/Supabase 已验收。无远端迁移、用户签名、广播、push、PR 或实际 cron。

## 1. 固定部署交易与用户签名

唯一链 Monad Testnet 10143（0x279f），RPC https://testnet-rpc.monad.xyz。`deployment/contracts.json` 包含三个冻结合约的完整 ABI、creation bytecode、keccak256、源码 SHA256、immutable references；solc 0.8.30 / optimizer 200 / shanghai，依赖和复现见 bootstrap。Factory 和 Token 两次部署；FanPool 由 Factory 创建，不单独部署。运行 `node scripts/release/prepare.mjs` 只读本机8549估算并生成包，不广播。重新编译后必须重新比对所有哈希，不用文件名代替版本确认。

1. 用户指定测试钱包 A（已有 faucet，无需再查询）及第二个独立钱包 B。另确认商品、物流 MOCK 模拟收款地址，均清楚标注未验证，无真实商品履约。不得用 Anvil 公开密钥操作测试网，不请求私钥。
2. 获批后连接用户钱包并确认账户/chainId10143。`node scripts/release/unsigned.mjs token` 离线生成创建交易：无 to，value0，data 为 MockUSDC creation bytecode，无构造参数。用户审阅钱包费用后自行签名。
3. 记录 status1 receipt、from、contractAddress、tx input、blockNumber/hash；等 receipt 块 finalized 且原 blockHash 一致。Token runtime 应与包内 runtime template keccak 匹配，name 为 MOCK USDC - NO REAL VALUE，decimals6。确认后才生成下一笔。
4. `node scripts/release/unsigned.mjs factory <verified-token>`：无 to，value0，data 为 Factory creation bytecode + ABI编码 token 地址（唯一构造参数）。用户再次签名；核验成功receipt/input/部署块/hash/finalized。Factory.token() 等于上步token；runtime 的 immutableReferences 各32字节位置替换为左补零token地址后，与实际code匹配，不把未替换模板hash误作最终runtimehash。
5. `node scripts/release/unsigned.mjs mint <verified-token> <wallet-A/B>` 分别输出两笔：to=固定token，value0，mint(wallet,1000000000)，即每钱包1000 MOCK。确认网络/收款人后由用户逐笔签名；MOCK任意人可mint，无真实价值。需要gas的是发送签名的钱包，不能让未签名的自动工具操作用户资金。
6. 每笔发送前重新读取钱包地址/chain；估算完整交易 gas 与当前 fee，用户拒签就停止该笔。已获得 tx hash 但结果未知时只核验原 hash，不自动重发部署。部署完成登记 token/factory、部署receipt/hash/block、模拟收款人到环境；不得填入本地地址替代。

`deployment/local-gas.json` 仅本机真实 eth_estimateGas：两部署+两个零余额钱包mint的总gas和以100gwei、2倍余量计算的示意MON预算。100gwei是明确假设，非实时Monad报价，未查询用户余额。Gate时对同一待签data重新估算并以钱包显示为准；正常/失败/超时池的加入/结算/退款另需测试MON，不能把部署预算称全部流程费用。

## 2. 数据库/Auth 精确变更

继承 `WEB3-EXTERNAL-GATE.md` 的身份与不可变metadata规则。目标 Supabase ref `qygnwgovbwltffsytnje`；先只读核查实际 PG17+（新增 transaction_timeout 依赖PG17）、同名对象/角色、API exposed schemas、owner/grants/RLS。若版本/同名对象不符停止比较，不盲目运行重复DDL。

获批后以管理员按顺序事务执行：`server/auth/schema/auth.sql`、`server/metadata/schema/metadata.sql`、`server/indexer/schema/index.sql`。精确hash见最终manifest。创建不同受限登录并安全注入密码：app继承fanpool_auth+fanpool_metadata_writer；metadata read仅fanpool_metadata_reader；index read仅fanpool_index_reader；index worker仅fanpool_index_worker。不得给anon/authenticated私有schema权限，不将schema加入PostgREST暴露列表。索引reader只有SELECT，worker只有SELECT/INSERT及cursor UPDATE，无events/pools删除更新权限。

Auth使用会话级 advisory lock，AUTH_DATABASE_URL 必须是可保持同连接的直连/Session pooler，不使用transaction pooler。连接TLS按官方连接信息验证，禁止关闭证书校验。小连接池max2，worker max1；托管连接限额要在Gate实测，不承诺免费方案无限并发。

启用Ethereum Web3 provider（当前未开启），Solana不需要；Site URL 精确正式Origin；SIWE URI是 `https://fan-pool-eta.vercel.app/auth`，Redirect URLs 按官方末尾slash规则列 `https://fan-pool-eta.vercel.app/auth/` 并实际签名验证匹配。无OAuth回调跳转仍需上游URI/Domain allowlist，不用通配符规避。真实托管Auth session_id、撤销/刷新、元数据首次写入及匿名跨设备读取须在Gate后实测。

## 3. 托管、变量与部署树

Vercel项目 `mangsengs-projects/fan-pool` / Node24 /正式Origin `https://fan-pool-eta.vercel.app`。使用 `vercel.json` 的固定pnpm lock安装与public构建，静态五页面deep link，缺png/json/map不回HTML；API映射到 `api/server.mjs`。显式 `__fp_path` 载体恢复API路径，避免依赖CDN是否保留原pathname。应用校验精确Host；不授权任意Preview域名。

`NODEJS_HELPERS=0` 在 build.env 中禁用官方Node helpers预消费请求体，BFF继续使用有界 async iterator。官方 @vercel/node15.0.0 桥接模块已本地验证原路径/映射路径、正确Host与拒绝Preview、Auth/metadata Unicode body、Auth8192及worker1024大小限制。测试只导出固定官方bundle现有桥接函数、屏蔽其CLI启动，无产品替代实现；外层测试显式模拟CDN forwarded-host。它不验证真实CDN重写/构建平台，因此Gate后仍必须冒烟检查实际URL、Host、body、cookies、503/403/404。官方依据：[Node runtime](https://vercel.com/docs/functions/runtimes/node-js)、[builder helpers 开关](https://github.com/vercel/vercel/blob/main/packages/node/src/build.ts)。

变量完整清单在 `.env.example`：公开RPC/Reown projectID/chain固定地址/Factory部署block与hash；服务端APP_ORIGIN、Supabase URL/publishable key、Auth token key、四类数据库连接、INDEX_WORKER_SECRET。随机密钥只注入受控服务器环境/Vault，不进Git或聊天。AUTH_TOKEN_KEY固定32字节；修改会使旧会话密文失效，不能随意轮换。REOWN域名allowlist需配置正式Origin，真实AppKit连接及手机仍待后续Gate。

精确待发布列表见 `deployment/publish-manifest.json`。只按清单创建审核树，不能 `git add .` 上传全部证据。排除 .env/.local、构建物、node_modules/lib缓存、第三方全文抓取和旧外部研究镜像；保留自有测试fixture（含CP3测试需要的五个JSON）。README、原创实现/迁移/测试/部署包可发布。GitHub push 会触发既有Vercel构建，因此它本身属于外部Gate，不能先push再批准部署。

## 4. 共享索引与 Cron

候选 `deployment/cron.sql` 仅文件，未执行。批准后启用已核实可用的pg_cron/pg_net，管理员安全写Vault命名secret，与Vercel INDEX_WORKER_SECRET相同。每分钟一次POST固定正式URL；无有效Bearer拒绝，不从匿名GET触发worker。pg_net timeout30s；cron成功只表示排队，要检查HTTP响应和cursor进展。[Cron官方](https://supabase.com/docs/guides/cron/quickstart)、[pg_net官方](https://supabase.com/docs/guides/database/extensions/pg_net)

每次最多20窗，每窗≤100块，最多80 RPC/40日志调用；池数≤200、每窗事件≤2000，明确超限状态而非截断。多地址413批量收缩持久保存，429/其他RPC失败30秒退避；cursor.pending记录窗口及完成子批，完整提交才发布游标。超过容量时保留原权益直读，人工审查扩大限额或离线分段重建需另批；不可静默清cursor丢历史。

14秒是从调用起算的RPC调度预算，生产transport每fetch最多4秒且共享14秒截止。PG17批量提交有5秒transaction_timeout，语句/连接/锁也有界；留出提交及release余量，持久lease25s+fence。Vercel函数配置maxDuration30s才是托管硬截断，不能把14秒或本机39–60msSQL称全调用硬上限/远端容量保证。极慢DB/进程终止可能不回复，租约自动过期，完整pending下一轮恢复；托管时须实测时限与pool连接。若配置maxDuration不被方案接受，Gate停止，不静默购买升级。[函数时限](https://vercel.com/docs/functions/configuring-functions/duration)

## 5. 发布后验证与回退

先只读/少量测试：真实receipt固定来源、五页面、metadata发布、同块参与/退出目录；两个访客共用cursor，日志窗口≤100。验证正文/CSRF/cookie，匿名索引/资料读取，授权失败403与服务停用503。已知池带creationTx时禁DB/Auth/index仍能为本人或指定受益人发退款，记录真实receipt归属；不通过全体成员枚举才能退款。当前/历史block标签区分准确。

接着用户自行签名正常、FAILED、采购/运输超时流程，等待真实时间，不存在公网快进端点。冻结会计、采购后执行费不退与零额claimed不变。真实双钱包/手机以及正式公开分享在WEB5，不以当前本机适配器冒充。

回退：停止cron job；撤销worker写登录或关闭worker secret；保留cursor/pending和既有资料。应用回退可切前版本，但当前链合约与已发送交易不可撤销，继续保留已知池直读退款入口和creationTx。关Auth/metadata写入口不应关链退款；不得DROP数据或改变合约/费用。密钥泄露需撤销相关登录/会话并另批轮换；不要输出密钥做“验证”。所有外部写入按精确清单记录结果与Gate新hash。
