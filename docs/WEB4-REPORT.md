# FP-WEB4-001 本地交付 · READY_FOR_GATE

2026-09-25；Developer完成本地实现与精确外部动作包，停止外部部分，等待独立审查。不是Leader ACCEPTED，不代表真实Monad最终验收或WEB5公开/手机完成。没有push、远端迁移/Auth配置/cron、部署、用户钱包签名或真实资金操作。

## 实现与资金事实

五页面的公网历史改为共享私有Postgres索引，来源目录独立metadata，Joined历史保留退出；20条分页、明示索引状态。每窗最多100块，新池同窗事件一并读取。413缩小地址批量并持久保存pending offset/events；预算结束跨调用继续，429持久退避。完整窗口的池/事件/参与者/游标一个事务提交，事件唯一键去重；25s lease和递增fence，首尾验存活，旧worker不能写继任状态。读列表/详情在同一个REPEATABLE READ只读快照，不混合旧事件与新游标。

真实资金路径不扫描目录或历史：分享保留creationTx，独立核验固定工厂创建receipt、成功/finalized/原blockHash及近期同块factory/token/organizer；无hint且索引未知会要求恢复来源，不信任池自报getter。当前本人或手工受益人的active/claimed直接读当前块。历史增强失败保留已经核验的直接权益。

历史累计退款按indexedThrough标注；当前终态负债/已清偿数仅在规范化去重后的active地址数恰等于lockedN时完整计算。退出历史地址不计，缺地址显示未知而非0；零额claimed仍与未领取分开。来源/余额/scalars/所有权益getter同块并复核blockhash。冻结三合约没有改动，采购成功后所有CLOSED的执行费不退语义不变。

PUBLIC静态文案按模板位置分支，不再全HTML替换商品标题、参考URL或输入值。空权益列表明确不代表无人拥有权益，受益人有label。AppKit挂载根节点在页面render间保持；favicon已加入两构建与MIME，字体CSP包括Reown/WalletConnect字体域。真实AppKit重复导航告警/手机行为仍属于托管后待验，不把本地测试适配器当作真实AppKit。

## 可复核结果

| 证据 | 结果与边界 |
|---|---|
| `evidence/web4-indexer-final.{log,json}`、`evidence/web4/indexer.json` | 7 PASS，真实PG+8549合约：同块创建加入、退出历史、无metadata目录、部分窗口恢复/去重、单地址413跨8次日志预算收敛、429、并发租约/旧fence、只读一致性和权限。最终复跑用独立fanpool_web4_index_regression库，未重置浏览器库或链。 |
| `evidence/web4-capacity.{log,json}`、`web4/capacity.json` | 2 PASS，真实PG但合成SQL负载：200池/2000events/2000participants实际SELECT；201池显式拒绝；事务中租约到期全回滚。不是200个实际链部署，不证明远端吞吐。 |
| `evidence/web4-boundaries.{log,json}`、`web4/boundaries.json` | 3 PASS，真实PG+确定性RPC夹具：2001日志拒写/cursor不进；慢RPC后完整pending租约到期，下一worker零getLogs恢复提交；生产transport共享截止abort。 |
| `evidence/web4-public-chain.{log,json}`、`web4/public-chain.json` | 4 PASS，生产PUBLIC交易模块+真实8549合约。近期块编号平移+2,000,000、查询tag映射回真实状态，旧receipt不变；不是物理百万块链。详情/退款零getLogs，记录所有RPC方法/tag；部分集合、大小写重复、退出再加入、零额claimed；DB/Auth不可用时真实固定受益人退款15MOCK。 |
| `evidence/web4-ui-final.{log,json}` | 42 PASS：已有UI/精确金额/路由/元数据恢复/钱包身份变化/交易结果/Auth HTTP与SDK adapter测试。VM/stub依赖边界保留，不代替真实钱包签名。含新增PUBLIC控制器3项：历史增强失败仍可退款，creationTx刷新/share，用户原文保持/未知权益label。 |
| `evidence/web4-vercel-adapter.{log,json}`、`web4/vercel-adapter.json` | 2 PASS，固定官方Node15 adapter桥接：显式rewrite与精确Host、拒Preview、原始body流、JSONUnicode/限长、两条独立Secure Set-Cookie。未接入实际Vercel CDN/构建平台。 |
| `evidence/web4-build-final.{log,json}`、`web4-isolation-final.{log,json}`、`web4/build-isolation.json` | 构建/全chunk隔离与HTTP待部署503、五路由、缺资源404 PASS；本地RPC/test入口/server secrets无进入公网bundle。favicon额外HTTP200/image-svg验证。 |

Leader实际浏览器证据保存在Leader工作区，不由Developer伪造或复制成自己的执行记录：PUBLIC=true 4180带creationTx直达/刷新/share通过；索引/Auth503时角色0手工指定accounts[2]按钮退款15MOCK成功，tx `0xb0833ca3e58b4c200d42277de122a69db4d22f3ebe99791dbc9ffdd077cf3e86`，block614，受益人余额974000000→989000000、池0；空列表文案/label刷新验证通过；390×844无横向越界，仅窄屏几何，非真实手机。

初次边界测试曾缺Joined的fundedAddresses事件参数，修正夹具后3PASS；PUBLIC原文URL断言按合法percent编码等价修正后PASS；adapter探针最初截取CLI范围/测试Host信封不正确，修正仅导出原桥接与显式CDN测试信封后PASS。没有删掉失败资金断言或用等待替代根因。旧WEB3 RPC missing-revert-data底层原因未证实仍为历史限制，本轮不扩大声称已消除所有远端瞬态。

## 预算、容量与托管边界

14s是RPC调度软预算，真实transport有每次≤4s且同一14s总截止；PG17 commit采用5s事务超时（不是仅每语句5s），lease25s/fence保证失败不发布。连接/语句/锁也有限制，给提交/release留余量。Vercel maxDuration30s是托管硬截止候选；未在真实平台证明所有调用必在14s完成。极慢DB、平台终止或网络故障可能导致失败响应/lease自然过期，pending可由下一轮恢复。200池/每窗2000事件是明确容量限制；超限显示错误与退避，进一步扩容须审查，不静默截断。近乎空的Monad多地址协议接受不当作最大容量证明。

官方adapter测试复现：`npm install --prefix /private/tmp/fanpool-vercel-runtime --ignore-scripts --no-audit --no-fund @vercel/node@15.0.0` 后 `node --test test/indexer/vercel-adapter.test.mjs`。原固定package bundle hash写证据；只在/tmp创建模块导出用于测试，不将第三方全文加入发布清单。`NODEJS_HELPERS=0` 通过候选build.env供builder读取；真实部署后的helpers开关/CDN路由/Host/body/cookies仍是Gate必须验证项。

## 部署包与服务归属

`WEB4-GATE.md` 是唯一汇总外部动作清单：两合约精确bytecode/hash/constructor、离线unsigned编码、实际部署receipt/finalized/runtime immutable校验、两钱包mint、SQL角色/权限、Auth allowlist、环境、Vercel入口、Cron与回退。`deployment/local-gas.json` 部署+两新钱包mint本机估算2,635,565 gas；100gwei和2倍余量仅示意0.527113测试MON，非实时Monad费用或全流程预算。

发布只使用 `deployment/publish-manifest.json` 精确白名单。源码/原始证据的交付hash另在 `evidence/web4/manifest.json`（不含其自身）；它与发布清单目的不同。第三方研究全文、密钥、.local、构建缓存不发布；源码测试所需原创CP3 fixture保留。

保留服务：4180 Node74302 / Anvil74314，tool91264，RPC8549/chain10143，本地专用测试适配器，session `WEB4-TEST-2ab2c7f9-fb4d-4057-bc61-871ed9f572d3`，库fanpool_web4_test；最终索引复跑库fanpool_web4_index_regression。4174 Node78145/tool77407为真实公网构建待部署预览（deployed=false/Auth未配置）。旧4173/8547未重置。PG17专用55473沿用原本机实例；没有brew全局服务。

待Gate集中输入：第二独立测试钱包、两个MOCK模拟收款地址及具体用户签名窗口；已有钱包faucet无需重复。真实托管凭据只经受控配置渠道，不能发聊天。Developer到此停止外部动作并交独立Reviewer/Leader，保持预览服务供复验；不进入WEB5。

## 同Checkpoint修订 R1：真实事务超时连接生命周期

独立审查发现P2并由Leader要求REVISE：PG17 `transaction_timeout` 不是普通statement取消，它会终止已借出的Client连接。query先以25P04失败，随后连接仍可能异步发出error；Pool只保护idle Client，原IndexStore没有checked-out Client监听，可能导致整个Node退出。原缩短lease测试不能证明这个路径安全。

本次只改IndexStore连接生命周期：checkout后立即绑定Client error监听；错误仍由query/事务向worker传播，不改为成功；失败事务通过`release(error)`销毁连接，保留监听至socket end防止延迟error成为未捕获异常；成功归还后去掉本次监听。commit和只读一致事务共用该保护，5秒transaction_timeout保留，未移除超时。测试包装器转发真实Client事件/错误释放接口，没有用Pool/process级吞错掩盖问题。

`evidence/web4-transaction-timeout.{log,json}` 与 `evidence/web4/transaction-timeout.json`：真实PG17.11专用 `fanpool_web4_timeout_revision`，首INSERT后同连接`pg_sleep(6)`触发真实25P04，1 PASS。实际HTTP worker约5秒后受控返回RPC_OR_STORAGE_ERROR，Node仍存活；cursor9、events0、完整pending保留并释放lease。仅在测试中把30秒退避时间推进为已过，第二HTTP请求获得新lease与不同backend PID（79338→79343），无需getLogs完成cursor10提交；后续SQL及4次只读一致事务正常，归还连接未残留额外error监听。

`evidence/web4-timeout-affected.{log,json}` 5 PASS：同独立修订库重跑受影响200池/2000事件、2001拒写、租约过期回滚、完整pending恢复及RPC截止。没有操作Reviewer库、8549/8547链或重跑已通过资金大campaign；合约三份SHA256保持冻结值。核心UI和public bundle未改，无需重跑无关构建。当前保留的预览进程没有重启；本次服务端修订由独立测试直接加载，托管候选以新manifest源码为准。

修订后重新生成报告、99→100文件发布清单及完整交付manifest，等待Reviewer独立复验；READY_FOR_GATE仍只表示本地包准备，不表示Leader接受或外部授权。
