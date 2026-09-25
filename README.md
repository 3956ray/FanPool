# FanPool — local Hackathon mechanism prototype

Run a group order without becoming the bank.

本仓库包含已接受的 CP1 合约资金内核、CP2 本机网页与 CP3 本地演示脚本。没有公开部署、真实供应商集成或真实资金支持。`MockUSDC` 可免费 mint，**没有真实价值**。需求、付费意愿和供应商采用尚未验证。

## 固定政策

每个地址加入一份，最高承诺 `C = item + reserve + fee`。实际锁定地址数 N 决定一次商品款 `item*N`，运输最多一次按每地址 s 支付 `s*N`。所有收款地址、上限和期限创建后不可修改。

商品付款前失败全退 C。商品付款后只能退未花 reserve；采购执行费在商品付款成功后赚取，所有关闭原因（正常/主动终止/超时）均不退 fee，关闭后才能支付给组织者。超时关闭与两种领取均可由任何人触发，资金只能去固定权益地址。不需要组织者保持在线，但需要有人提交交易。

资金规则不证明实物送达、质量或地址归属；不同钱包可能由同一人控制。`NORMAL` 是结束操作的事实，不是履约认证。不要直接转币到池；额外转入会永久留作 surplus，没有救援或提款接口。

## 本地复现

验证环境是 macOS arm64，Foundry 1.3.1；Solidity 官方 macOS amd64 构建已在本机验证可运行。完整来源与SHA见 `dependencies.lock.json`。其他 OS 未实测，需要获取同一编译版本的对应官方二进制，不应使用本仓库 macOS 二进制。

安装 Foundry 1.3.1 后，在仓库根目录执行：

```sh
sh scripts/bootstrap-macos.sh
export FORGE_BIN="$HOME/.foundry/bin/forge"
"$FORGE_BIN" fmt --check
"$FORGE_BIN" build --sizes
"$FORGE_BIN" test --match-path 'test/unit/*' -vvv
"$FORGE_BIN" test --match-path 'test/fuzz/*' --fuzz-runs 10000 --fuzz-seed 0x000000000000000000000000000000000000000000000000000000000000f003 -vvv
"$FORGE_BIN" test --match-path 'test/differential/*' --fuzz-runs 10000 --fuzz-seed 0x000000000000000000000000000000000000000000000000000000000000f004 -vvv
FOUNDRY_PROFILE=ci "$FORGE_BIN" test --match-path 'test/invariant/*' --fuzz-seed 0x000000000000000000000000000000000000000000000000000000000000f001 -vvv
FOUNDRY_PROFILE=ci "$FORGE_BIN" test --match-path 'test/invariant/*' --fuzz-seed 0x000000000000000000000000000000000000000000000000000000000000f002 -vvv
```

CI profile 每 seed 10,000 序列、depth 64、fail_on_revert=true。默认100序列仅方便本地快速检查；不能用它代替验收。新机器缺少 Foundry 时，从官方 `foundry-rs/foundry` v1.3.1 release 获取对应平台包并校验官方哈希；不要运行来自不明镜像的安装脚本。

`test/helpers/ReferenceHandler.sol` 使用独立逐地址账本；预期权益不从合约 getter 推导。正向 handler 使用模型选取合法动作，负向 handler 检验失败，无效随机调用必须保持账本不变。每个序列末尾推进时间并清偿所有权益，只留下 surplus。定向测试覆盖全部状态、合法动作以及每个中间态的退款可达性。

`docs/CP1-REPORT.md` 包含验收状态；`docs/evidence/` 保留原始命令输出、退出码、seed和耗时。`scripts/run-check.py` 可为上述命令生成同样的证据记录。产品部署、发布、真实资金和新阶段均需 Leader 的后续 Gate。


## CP2 本机网页

Node 24.19.0 / pnpm 11.25.0，ethers 6.15.0、esbuild 0.25.10；依赖固定在 package.json / pnpm-lock.yaml。首次准备执行 `pnpm install --frozen-lockfile --ignore-scripts`，合约工具链按上文准备。

一条命令启动：

```sh
node scripts/local/start.mjs
```

该命令先本地构建已接受合约与网页，再启动仅监听 `127.0.0.1:8547` 的 Anvil（chain ID 31338、每秒出块），在专用模拟链部署 MOCK/Factory、为五个演示角色发币，最后提供 `http://127.0.0.1:4173`。有端口冲突时拒绝连接未知服务。使用 Node 的当前可执行路径即可；本机已验证的绝对路径为 `/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。

界面上切换组织者、三个加入者和旁观者；这些是 Anvil 公开测试账户，不连接浏览器钱包，不需要用户账号/API key或私钥。供应商和履约方另用两个固定模拟账户。加入前必须勾选资金政策同意；授权和存入是真实模拟链交易。任意角色可推进已到期状态或替原地址触发退款/采购费领取。

池链接含地址与模拟会话标识；刷新从合约重新读，不依赖localStorage。标题和参考链接只是本浏览器展示数据。元数据缺失时仍可操作资金。每份池快照固定同一区块，包括事件、成员、余额和权益；页面显示该区块编号。

模拟时间工具会影响该链所有池，且不会自动关闭/退款。演示币没有价值；不要直接向池转币，额外转入没有退款权益。正常关闭不表示实物送达。服务无需外部账号、托管或RPC服务。

**停止与重置：** 在启动终端按 Ctrl-C，或对启动进程发送 SIGTERM。父进程同时停止专用 Anvil。重新启动会清除该链全部交易和池，并生成新的会话与锚点；旧分享链接会被拒绝。不要在他人正在验收交易时重置。没有公网部署或广播。

验证命令：

```sh
node --test test/ui/domain.test.mjs
node scripts/local/build.mjs
# 以下会在当前专用链创建测试池和快进时间。先停止浏览器交易，测试后重启以清理数据。
node test/ui/integration.mjs
```

不依赖前端的本地退款示例（只填写当前模拟链地址，先以链配置验证RPC/会话）：

```sh
$HOME/.foundry/bin/cast call "$POOL" 'state()(uint8)' --rpc-url http://127.0.0.1:8547
# 条件满足时，旁观者用Anvil已解锁的公开测试账户触发；不使用真实私钥。
$HOME/.foundry/bin/cast send "$POOL" 'resolveFunding()' --from "$OBSERVER" --unlocked --rpc-url http://127.0.0.1:8547
$HOME/.foundry/bin/cast send "$POOL" 'claimRefundFor(address)' "$OWNER" --from "$OBSERVER" --unlocked --rpc-url http://127.0.0.1:8547
```

READY到期改用`expirePurchase()`，PURCHASED结算到期改用`closeTimeout()`。本轮直接合约路径已在 integration.mjs 中实际验证；上方cast命令供人工复核，未冒充本轮执行日志。CP2报告、进程信息与验证边界见 docs/CP2-REPORT.md；浏览器验收由Leader独立完成。当前包含CP3本地演示，仍没有外部发布。


## CP3：约 60 秒演示与两轮复跑

完整讲解、种子阶段披露、实际动作、直接CLI退款和限制见 [DEMO.md](DEMO.md)。保留全部CP2手动网页功能；没有新增外部服务或网页自动操作入口。

在运行的本机服务上执行：

```sh
node scripts/local/demo.mjs seed
node scripts/local/demo.mjs run
node scripts/local/demo.mjs check
```

`seed`单独计时，真实准备READY/N3/45与采购后失联/N3/15两个池。`run`默认按约60秒讲解节奏执行12笔真实成功交易，并明确s5拒绝为无广播的eth_call模拟，不提供虚构失败hash。每个成员、组织者、旁观者和两类收款人的余额增减均断言。结果在`.local/demo-run.json`。

要从两个干净会话连续复跑，先Ctrl-C停止已知启动终端，再执行：

```sh
node scripts/local/replay-demo.mjs
```

编排器仅管理自己spawn的服务，已有端口占用则拒绝；第一轮后确认端口释放，第二轮结束保留预览。中途Ctrl-C/SIGTERM会清理其仍拥有的网页和Anvil；成功交付预览后用输出的Node父PID停止。全部种子、回执、受益人余额及耗时在`docs/evidence/cp3/`。重置会丢失模拟链数据，旧session链接/种子会拒绝。

适当回归（资金合约未改，不重跑CP1大campaign）：

```sh
node --test test/ui/domain.test.mjs test/ui/cp3-evidence.test.mjs
# 生命周期验证需要4173/8547空闲，会启动/停止其自建本机服务：
node test/local/lifecycle.mjs
```

演示阶段时长与种子准备分开计时；不能宣称已在60秒完成此前的创建/加入。CP3内部验证不等于外部安全审计、需求验证或供应商认证，CP4仍未授权。

## WEB1：本地多页面 Web App

当前五路径为 `/`、`/create`、`/pools/:address`、`/my`、`/manage`。启动方式不变；静态服务支持页面深链接刷新与浏览器历史导航。站内链接自动带当前 `session`；旧 `/?pool=...&session=...` 链接经校验后转为详情路径。任何路径上的旧 session 都被拒绝，明确返回首页才进入当前链。

“我的参与”包括加入、退出、退款和零额权益历史；“团主管理”只列当前选择地址创建的池，详情执行原合约操作。本地角色保存在本标签页会话中，刷新保留；选择地址不是钱包身份认证。池资料仍只在当前浏览器 localStorage，不是跨浏览器持久化。没有 AppKit/Supabase/公网部署。

新增回归：`node --test test/ui/routes.test.mjs test/ui/navigation.test.mjs`。`node test/ui/web1-integration.mjs` 在当前专用模拟链产生真实测试交易，请避开浏览器交易验收窗口。WEB1 实现与未完成的浏览器验收边界见 `docs/WEB1-REPORT.md`。

## WEB2：钱包与认证准备

公开测试网模式单独运行 `node scripts/build-public.mjs`、`node server/public.mjs`，预览4174；它使用真实AppKit Ethers组件，保留4173本地演示作为独立入口。合约未配置显示部署待配置，身份服务未配置返回503。`.env.example`区分公开与服务端配置，复制到本地环境后由Node `--env-file`加载；不要把任何数据库凭证/加密key放入前端或提交。

认证为EOA单签名、Supabase原生sid授权门和HttpOnly随机句柄；token加密保存在私有Postgres表，公开浏览和资金退款不依赖登录。浏览器登录要求Web Locks以安全初始化跨标签上下文。详细协议及验证边界见 [WEB2-AUTH-ARCHITECTURE.md](docs/WEB2-AUTH-ARCHITECTURE.md) 与 [WEB2-REPORT.md](docs/WEB2-REPORT.md)。公开构建可运行不表示已部署或真实用户登录已完成。

### WEB3 首次资料发布（本地已实现，托管服务未连接）
资料匿名读取，组织者经BFF认证后仅首次保存标题/参考链接；资金及退款仍由合约独立处理。创建成功而资料失败时只重试原池资料，不再创建。

- 规范、schema及权限：[WEB3-DATA-ARCHITECTURE](docs/WEB3-DATA-ARCHITECTURE.md)
- 尚未执行的外部步骤：[WEB3-EXTERNAL-GATE](docs/WEB3-EXTERNAL-GATE.md)
- 独立本机验收：保持既有55473专用Postgres进程，运行 `node test/metadata/fixture/start.mjs`（4175/8548须空闲），另终端 `node --test test/metadata/core.test.mjs`。夹具会重建**仅**fanpool_web3_test库里的私有schema，Auth为明确stub；不连接用户钱包或托管Supabase。
- `node test/metadata/refund.mjs` 会在专用测试链执行真实资金流程并快进；不得与浏览器验收并行。
- 生产入口仍 `node server/public.mjs`；没有配置真实部署时显示待部署，没有Auth配置时身份503，不会拿测试夹具代替。

## WEB4：共享索引与待部署包

本地准备完成不代表已上线。外部执行前阅读 `docs/WEB4-GATE.md`；当前部署候选见 `vercel.json`、`api/server.mjs` 和 `docs/deployment/publish-manifest.json`。不要直接发布工作区所有文件。合约资金规则未改。

生产历史来自私有 PostgreSQL 共享增量索引，匿名GET只读；每窗≤100块、可恢复子批、lease/fence保护提交。已知池使用分享链接creationTx独立核验来源和当前受益人权益，索引/Auth故障不阻断链上退款。历史金额明确截至indexedThrough，不伪装当前完整账本。

本地专用验证（需已准备 Foundry构建与PG17专用55473）：`node test/indexer/start.mjs` 启动4180/8549，PUBLIC=true并仅替换测试钱包/loopback RPC；该适配器不能发布为真实钱包。启动会拒绝已有端口，并重建指定测试库schema；须先确认无其他验收在使用。`node --test test/indexer/core.test.mjs` 验证索引；capacity/boundaries为真实PG配合明确合成容量/RPC夹具；public-chain为真实合约交易。源码改后可单独 `node test/indexer/build.mjs` 重建预览，不重置链。

`test/indexer/vercel-adapter.test.mjs` 使用临时目录固定 `@vercel/node@15.0.0` 官方桥接器，见报告复现命令；它不是已部署Vercel CDN证据。`node scripts/build-public.mjs` 生成公网构建；生产构建不需要Foundry，不含测试钱包、loopback RPC、时间推进或服务端密钥。
