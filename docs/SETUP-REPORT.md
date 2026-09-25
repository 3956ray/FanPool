# WEB4 /setup 有界修订交付

状态：COMPLETE，待独立审查与 Leader 接受；不代表发布或真实链部署完成。

独立目录 `/Users/mili/Documents/Developer/FanPool-signing`，分支 `codex/fanpool-signing-handoff`，基线 PR #1 commit `01050807c8dd6e3acf963ba27e613b114d046479`。原目录及 PR #1 的冻结100文件树未修改，PR 保持未合并。Vercel 已知事实仅预览失败，未猜原因。

新增独立 /setup AppKit 页面、固定 artifact 和控制器，修改公网构建/原生静态路由/Vercel精确路由。复用原钱包 guard，不改合约、资金、认证、索引。只提供冻结两部署与 A/B 各1000 MOCK；所有交易由A逐笔显式点击，再由钱包用户确认，value0/chain10143。准备和提交分开，90秒报价有效期、发送前再次检查账户/链/nonce/估价。无通用to/data输入。

回执验证含完整输入、from/to/value/nonce/chain、成功状态、创建地址、原区块及 finalized 一致性、runtime，Factory token绑定；mint事件和余额仅MOCK。原hash/已验地址公开持久化，恢复必须重新校验。跨标签Web Locks、持久发送意图、防双击、拒签/未知结果/存储失败分支保持有界；无后台自动发送。部署artifact来自原冻结输出，测试对照既有unsigned.mjs逐字节一致。

验证：14项 setup provider夹具测试 PASS；39项既有UI纯回归 PASS；公网构建 PASS；输出模块/秘密/本地链隔离 PASS；独立4181入口/JS/CSS/config四项HTTP PASS。测试未触真实用户钱包、外部数据库或广播。构建隔离脚本的HTTP旧入口部分读取原4174，新增setup路径另在4181验证，不能宣称真实Vercel/CDN或手机验证。已修正核验成功提示，finalized后明确成功，不再要求再次核验。

测试涵盖编码、拒签、重复提交、未知结果与刷新/手工恢复、错误receipt/runtime/来源编码/nonce/块hash/Factory绑定、异步账户变化、错误网络、存储故障、跨标签竞争、费用变化。原39项含现有PUBLIC交易与导航控制器回归；没有重跑未变资金/DB大campaign。

服务归属：独立预览 `http://127.0.0.1:4181/setup`，Node PID85227，tool session21515，原生Node handler；启动时端口空闲。该页真实AppKit但未连接/签名；现有4174/4180/8547等均未重启。Leader可进行只读浏览器验收。

交付清单 `docs/evidence/setup/manifest.json`；其中publishIncrement精确列出允许后续审查的增量源码/测试/原创文档，不含node_modules、构建产物、AGENTS或证据日志。未创建新PR、未推送、未合并。

限制：清空站点数据/换设备会失去意图，必须人工保留hash；无Web Locks停止发送；未知或已失败链交易不提供自动重发。真实AppKit/MetaMask四笔、HTTPS托管入口与Vercel现有失败原因须后续验证，不算本次本地PASS。使用说明见SETUP-HANDOFF.md。

## R1 跨标签迟到核验覆盖修订

首轮独立审查 REVISE：check 在异步RPC前读取整份记录，迟到 save 可删除另一标签已经保存的 Factory 发送意图，导致重复准备。现 submit/check 共用同一 exclusive Web Lock；启动自动恢复、手动恢复均走 check，无旁路。锁冲突立即停止并提示重试，不自动发送。

所有持久写入按单步骤合并最新存储；内存 volatile 只保存失败步骤与对应原持久记录指纹。若另一标签已更新该步骤，旧 volatile 不覆盖新记录；不同步骤一律保留最新存储。发送前 required 写失败仍停止请求，发送后的未知/返回hash仍保留恢复线索。

新增5项确定性回归含两种先后顺序：延迟启动式 check 与 Factory submit、未决钱包与同一步手动恢复、手动恢复与已准备发送、hash保存失败后另一标签恢复并提交Factory。均断言发送次数不增、原Factory hash保留、再次准备被拒。14项助手测试及重建/隔离 PASS；39项既有UI为首轮已通过证据，本次未重跑未受影响测试。没有重启预览服务或对外写入。等待独立R1复验，不自行标ACCEPTED。

Leader补充反例已处理：手工恢复在共享锁内先完成来源/回执验证再保存。格式合法但不存在或错误来源hash不会新建假发送意图，也不会覆盖原有效记录；相应反例PASS。已有awaiting-wallet/unknown意图仍保持阻止重发。
