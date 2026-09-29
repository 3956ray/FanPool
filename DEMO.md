# FanPool 本地演示：约 60 秒，真实合约回执

这是本机 Anvil / MOCK 演示，不是 Monad 测试网发布。预置、时间快进和重置均为演示辅助。没有真实商户、真实资金或实物交付承诺。

## 1. 准备与启动

先按 README 完成固定 Foundry/Solidity 与 Node/pnpm 依赖准备，然后执行：

```sh
node scripts/local/start.mjs
```

打开 [本机网页](http://127.0.0.1:4173)。保持启动终端运行；另开终端，在仓库目录执行：

```sh
node scripts/local/demo.mjs seed
```

种子脚本准备两个真实合约池，均 I=10 / R=4 / F=1 / C=15、N=3：

- A：**预置 READY**，池中45 MOCK，尚未采购。
- B：**预置 PURCHASED**，商品款30已在准备阶段支付，池中剩余15。

脚本打印含会话标识的两个池链接，并将 `.local/demo-seed.json` 保存为复跑输入。种子准备单独计时，不能说成“60秒内完成创建和全部加入”。网页可能显示“链上资金池”，因为标题是浏览器本地元数据；通过脚本输出的地址分辨A/B，资金状态来自真实链。

## 2. 演示阶段

```sh
node scripts/local/demo.mjs run
```

默认有显式讲解节奏，目标约60秒；不是最快交易基准。真实交易耗时若超出节奏，脚本会如实继续并记录更长时长，不截掉资金动作。可在网页打开A/B链接观察真实状态，页面约5秒重读一次。演示期间不要另开手动交易或时间快进。

| 目标时间 | 展示 / 真实动作 |
|---|---|
| 0–8秒 | 明确“本地MOCK、预置A READY/N3/45；10+4+1=15”。说明准备耗时另算 |
| 8–15秒 | 组织者执行精确商品款30，显示真实成功回执 |
| 15–23秒 | s=5的 **eth_call静态模拟**被拒；无广播、无失败交易hash，池余额不变 |
| 23–29秒 | 合法s=2，实际运输付款6 |
| 29–33秒 | 正常关闭；这只是资金操作结束，不是已送达 |
| 33–45秒 | 旁观者触发三人各退2，再向组织者付费3；45=30+6+6+3，池0 |
| 45–60秒 | 切预置失联池B，明确快进专用链至结算期限，旁观者关闭、三人各退4、费用3归组织者；剩余15=12+3，池0 |

共12笔演示阶段成功交易；所有回执status必须为1。静态拒绝单独标记 `broadcast=false` / `transactionHash=null`，不能拿它冒充链上失败交易。

脚本在三个时点固定区块读取余额：演示前、A清偿后、B清偿后。逐项校验三个成员、组织者、旁观者、供应商、履约方和两个池的增减，实际记录到 `.local/demo-run.json`。旁观者的MOCK余额不得增加；付款和退款只到约定地址。种子阶段商品款B的30不重复算作演示阶段支付。

完成后只读检查：

```sh
node scripts/local/demo.mjs check
```

已完成的种子不能直接再`run`（状态已关闭）；要重置并重新seed。种子超过采购期限也会拒绝，不能用过期种子伪演示。

## 3. 连续两个干净会话复跑

先停止已知FanPool启动终端（Ctrl-C），或对其打印的**Node父PID**发送SIGTERM。父进程会关闭自己启动的Anvil。不要杀不明占用端口的进程。

```sh
node scripts/local/replay-demo.mjs
```

编排器发现4173或8547已占用会直接拒绝。它只启动并停止自己的子进程；第一轮后确认两个端口都已释放，再启动第二轮。两轮会话标识和区块锚点必须不同。每轮自动seed→约60秒run，原始结果保存在 `docs/evidence/cp3/`；第二轮完成后保留网页/Anvil用于查看，打印Node PID。再次运行同一命令前，先停止这个明确的父PID。

**重置会丢失当前模拟链全部池和交易。** 地址可能因同样部署顺序被复用，因此分享链接和seed都绑定session/anchor；旧会话会被拒绝。不得绕过此检查只拼旧地址。

## 4. 不依赖前端的直接退款

先设置当前会话、池和原权益地址，再验证身份。以下变量需替换为当前启动/seed打印的值，不能使用真实网络或用户钱包：

```sh
SESSION='当前本机session'
POOL='当前本机池地址'
OWNER='原出资地址'
OBSERVER='当前配置中旁观者地址'
node scripts/local/verify-pool.mjs "$SESSION" "$POOL"
```

校验必须成功：固定loopback RPC/chain ID、Anvil、会话、anchor/code hash、当前工厂注册关系全部匹配。输出链上当前时间和三个截止时间，**按状态只选择适用的一项**：

```sh
# FUNDING 且 now >= fundingDeadline
$HOME/.foundry/bin/cast send "$POOL" 'resolveFunding()' --from "$OBSERVER" --unlocked --rpc-url http://127.0.0.1:8547
# READY 且 now >= purchaseDeadline
$HOME/.foundry/bin/cast send "$POOL" 'expirePurchase()' --from "$OBSERVER" --unlocked --rpc-url http://127.0.0.1:8547
# PURCHASED 且 now >= settlementDeadline
$HOME/.foundry/bin/cast send "$POOL" 'closeTimeout()' --from "$OBSERVER" --unlocked --rpc-url http://127.0.0.1:8547
```

到FAILED/CLOSED后可退款；CLOSED还可触发采购费，受益人均固定：

```sh
$HOME/.foundry/bin/cast send "$POOL" 'claimRefundFor(address)' "$OWNER" --from "$OBSERVER" --unlocked --rpc-url http://127.0.0.1:8547
$HOME/.foundry/bin/cast send "$POOL" 'claimFee()' --from "$OBSERVER" --unlocked --rpc-url http://127.0.0.1:8547
```

FAILED只退C，没有可领取采购费；CLOSED只退R-s，采购费在任何关闭原因下都不退。零值领取只处理权益，不代表发生token转账。上述cast路径在CP2由Leader实测；CP3新证据为种子/编排的直接RPC合约调用，不伪称本轮又执行了全部cast示例。

## 5. 已知限制

仅本机MOCK，临时链重启数据丢失；展示元数据仅当前浏览器；不保证交付/质量/商户诚实，不同地址不等于不同人。采购后fee不退，已付商品款无法由合约追回；surplus不可救援。只验证标准mock token假设，不保证任意ERC20。已有内部独立技术审查不等于外部专业安全审计；真实需求、付费与真实供应商采用均未验证。没有真实用户访谈通过证明。CP4与外部测试网部署仍未授权。
