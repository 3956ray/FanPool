// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FanPool} from "../../src/FanPool.sol";
import {FanPoolFactory} from "../../src/FanPoolFactory.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

/// Independent per-address ledger. Expected values never read production getters.
contract ReferenceHandler is Test {
    MockUSDC public token;
    FanPool public pool;
    address public constant ORGANIZER = address(0x1100);
    address public constant SUPPLIER = address(0x1200);
    address public constant SHIPPER = address(0x1300);
    uint256 public constant INITIAL = 1e24;
    uint256 public item;
    uint256 public reserve;
    uint256 public fee;
    uint256 public minimum;
    uint256 public maximum;
    uint256 public funding;
    uint256 public purchase;
    uint256 public settlement;
    uint256 public phase;
    uint256 public reason;
    uint256 public failure;
    uint256 public locked;
    uint256 public shipping;
    bool public shipped;
    bool public paidFee;
    bool[4] public member;
    bool[4] public refunded;
    uint256[4] public wallets;
    uint256 public organizerBalance;
    uint256 public supplierBalance;
    uint256 public shipperBalance;
    uint256 public deposits;
    uint256 public exits;
    uint256 public goodsOut;
    uint256 public shippingOut;
    uint256 public refundsOut;
    uint256 public feesOut;
    uint256 public surplus;
    uint256[15] public successCount;
    uint256[15] public rejectCount;
    uint256[5] public stateVisits;

    constructor() {
        _create(0);
    }

    function actor(uint256 index) public pure returns (address) {
        return address(uint160(0x2000 + index));
    }

    function _count() internal view returns (uint256 n) {
        for (uint256 i; i < 4; i++) {
            if (member[i]) n++;
        }
    }

    function _create(uint256 seed) internal {
        item = 1 + (seed % 1000000);
        reserve = (seed / 7) % 10000;
        fee = (seed / 11) % 1000;
        maximum = 1 + (seed / 17) % 4;
        minimum = 1 + (seed / 19) % maximum;
        funding = block.timestamp + 100;
        purchase = funding + 100;
        settlement = purchase + 100;
        token = new MockUSDC();
        FanPoolFactory factory = new FanPoolFactory(address(token));
        FanPool.Config memory cfg =
            FanPool.Config(SUPPLIER, SHIPPER, item, reserve, fee, minimum, maximum, funding, purchase, settlement);
        vm.prank(ORGANIZER);
        pool = factory.createPool(cfg);
        phase = 0;
        reason = 0;
        failure = 0;
        locked = 0;
        shipping = 0;
        shipped = false;
        paidFee = false;
        deposits = 0;
        exits = 0;
        goodsOut = 0;
        shippingOut = 0;
        refundsOut = 0;
        feesOut = 0;
        surplus = 0;
        organizerBalance = 0;
        supplierBalance = 0;
        shipperBalance = 0;
        for (uint256 i; i < 4; i++) {
            member[i] = false;
            refunded[i] = false;
            wallets[i] = INITIAL;
            token.mint(actor(i), INITIAL);
            vm.prank(actor(i));
            token.approve(address(pool), type(uint256).max);
        }
        stateVisits[0]++;
    }
    // New-pool action first proves old-pool timeout drainage and compares the resulting ledger.

    function create(uint256 seed) public {
        drain();
        _create(seed);
        successCount[14]++;
        check();
    }

    function step(uint256 selector, uint256 whoSeed, uint256 amountSeed) public {
        uint256 op = selector % 14;
        uint256 who = whoSeed % 4;
        address caller = actor(who);
        uint256 commitment = item + reserve + fee;
        uint256 count = _count();
        uint256 now_ = block.timestamp;
        bytes memory data;
        bool valid;
        uint256 amount = amountSeed % (reserve + 2);
        if (op == 0) {
            data = abi.encodeCall(pool.join, ());
            valid = phase == 0 && now_ < funding && !member[who] && count < maximum;
        } else if (op == 1) {
            data = abi.encodeCall(pool.exit, ());
            valid = phase == 0 && now_ < funding && member[who];
        } else if (op == 2) {
            data = abi.encodeCall(pool.resolveFunding, ());
            valid = phase == 0 && now_ >= funding;
        } else if (op == 3) {
            caller = ORGANIZER;
            data = abi.encodeCall(pool.paySupplier, ());
            valid = phase == 1 && now_ < purchase;
        } else if (op == 4) {
            data = abi.encodeCall(pool.expirePurchase, ());
            valid = phase == 1 && now_ >= purchase;
        } else if (op == 5) {
            caller = ORGANIZER;
            data = abi.encodeCall(pool.payFulfillment, (amount));
            valid = phase == 2 && now_ < settlement && !shipped && amount <= reserve;
        } else if (op == 6) {
            caller = ORGANIZER;
            data = abi.encodeCall(pool.closeNormal, ());
            valid = phase == 2 && now_ < settlement;
        } else if (op == 7) {
            caller = ORGANIZER;
            data = abi.encodeCall(pool.abort, ());
            valid = phase == 2 && now_ < settlement;
        } else if (op == 8) {
            data = abi.encodeCall(pool.closeTimeout, ());
            valid = phase == 2 && now_ >= settlement;
        } else if (op == 9) {
            caller = address(0x9000);
            data = abi.encodeCall(pool.claimRefundFor, (actor(who)));
            valid = (phase == 3 || phase == 4) && member[who] && !refunded[who];
        } else if (op == 10) {
            data = abi.encodeCall(pool.claimFee, ());
            valid = phase == 4 && !paidFee;
        } else if (op == 11) {
            uint256 gift = amountSeed % 1000;
            token.mint(address(pool), gift);
            surplus += gift;
            successCount[op]++;
            check();
            return;
        } else if (op == 12) {
            vm.warp(now_ + amountSeed % 151);
            successCount[op]++;
            check();
            return;
        } else {
            data = abi.encodeCall(pool.paySupplier, ());
            valid = false;
        }
        vm.prank(caller);
        (bool ok,) = address(pool).call(data);
        assertEq(ok, valid, "model success/revert mismatch");
        if (!ok) {
            rejectCount[op]++;
            check();
            return;
        }
        successCount[op]++;
        if (op == 0) {
            member[who] = true;
            wallets[who] -= commitment;
            deposits += commitment;
            if (count + 1 == maximum) {
                locked = count + 1;
                phase = 1;
            }
        } else if (op == 1) {
            member[who] = false;
            wallets[who] += commitment;
            exits += commitment;
        } else if (op == 2) {
            locked = count;
            if (count < minimum) {
                phase = 3;
                failure = 1;
            } else if (now_ >= purchase) {
                phase = 3;
                failure = 2;
            } else {
                phase = 1;
            }
        } else if (op == 3) {
            phase = 2;
            for (uint256 i; i < 4; i++) {
                if (member[i]) {
                    supplierBalance += item;
                    goodsOut += item;
                }
            }
        } else if (op == 4) {
            phase = 3;
            failure = 2;
        } else if (op == 5) {
            shipped = true;
            shipping = amount;
            for (uint256 i; i < 4; i++) {
                if (member[i]) {
                    shipperBalance += amount;
                    shippingOut += amount;
                }
            }
        } else if (op >= 6 && op <= 8) {
            phase = 4;
            reason = op - 5;
        } else if (op == 9) {
            refunded[who] = true;
            uint256 refund = phase == 3 ? commitment : reserve - shipping;
            wallets[who] += refund;
            refundsOut += refund;
        } else if (op == 10) {
            paidFee = true;
            for (uint256 i; i < 4; i++) {
                if (member[i]) {
                    organizerBalance += fee;
                    feesOut += fee;
                }
            }
        }
        stateVisits[phase]++;
        check();
    }
    /// Positive-only progression picks legal actions using the independent model.

    function progress(uint256 seed) public {
        uint256 choice = seed % 4;
        if (phase == 0) {
            if (block.timestamp >= funding) {
                step(2, 0, 0);
                return;
            }
            if (choice < 2 || _count() == 0) {
                for (uint256 i; i < 4; i++) {
                    if (!member[i]) {
                        step(0, i, 0);
                        return;
                    }
                }
            }
            if (choice == 2) {
                for (uint256 i; i < 4; i++) {
                    if (member[i]) {
                        step(1, i, 0);
                        return;
                    }
                }
            }
            vm.warp(funding);
            step(2, 0, 0);
        } else if (phase == 1) {
            if (block.timestamp >= purchase || choice == 0) {
                vm.warp(block.timestamp > purchase ? block.timestamp : purchase);
                step(4, 0, 0);
            } else {
                step(3, 0, 0);
            }
        } else if (phase == 2) {
            if (block.timestamp >= settlement) {
                step(8, 0, 0);
                return;
            }
            if (!shipped && choice == 0) {
                step(5, 0, seed % (reserve + 1));
                return;
            }
            if (choice == 1) {
                step(6, 0, 0);
            } else if (choice == 2) {
                step(7, 0, 0);
            } else {
                vm.warp(settlement);
                step(8, 0, 0);
            }
        } else {
            for (uint256 i; i < 4; i++) {
                if (member[i] && !refunded[i]) {
                    step(9, i, 0);
                    return;
                }
            }
            if (phase == 4 && !paidFee) {
                step(10, 0, 0);
                return;
            }
            create(seed);
        }
    }

    // Separate negative action: arbitrary untrusted caller cannot use organizer-only APIs.

    function invalid(uint256 seed) public {
        bytes memory data = seed % 3 == 0
            ? abi.encodeCall(pool.paySupplier, ())
            : seed % 3 == 1 ? abi.encodeCall(pool.payFulfillment, (0)) : abi.encodeCall(pool.abort, ());
        vm.prank(address(0xdead));
        (bool ok,) = address(pool).call(data);
        assertFalse(ok);
        rejectCount[13]++;
        check();
    }

    function check() public view {
        assertEq(uint256(pool.state()), phase);
        assertEq(uint256(pool.closeReason()), reason);
        assertEq(uint256(pool.failureReason()), failure);
        assertEq(pool.fundedCount(), _count());
        assertEq(pool.lockedN(), locked);
        assertEq(pool.s(), shipping);
        assertEq(pool.fulfillmentExecuted(), shipped);
        assertEq(pool.feeClaimed(), paidFee);
        uint256 liabilities;
        for (uint256 i; i < 4; i++) {
            assertEq(pool.active(actor(i)), member[i]);
            assertEq(pool.claimed(actor(i)), refunded[i]);
            assertEq(token.balanceOf(actor(i)), wallets[i]);
            if (member[i]) {
                if (phase <= 1) {
                    liabilities += item + reserve + fee;
                } else if (phase == 2) {
                    liabilities += reserve - shipping + fee;
                } else if (phase == 3 && !refunded[i]) {
                    liabilities += item + reserve + fee;
                } else if (phase == 4) {
                    if (!refunded[i]) liabilities += reserve - shipping;
                    if (!paidFee) liabilities += fee;
                }
            }
        }
        uint256 balance = token.balanceOf(address(pool));
        assertEq(balance, liabilities + surplus, "independent per-address liability sum");
        assertEq(
            deposits + surplus, exits + goodsOut + shippingOut + refundsOut + feesOut + balance, "flow conservation"
        );
        assertEq(token.balanceOf(ORGANIZER), organizerBalance);
        assertEq(token.balanceOf(SUPPLIER), supplierBalance);
        assertEq(token.balanceOf(SHIPPER), shipperBalance);
        assertEq(pool.item(), item);
        assertEq(pool.reserve(), reserve);
        assertEq(pool.fee(), fee);
        assertEq(pool.commitment(), item + reserve + fee);
        assertEq(pool.min(), minimum);
        assertEq(pool.max(), maximum);
        assertEq(pool.fundingDeadline(), funding);
        assertEq(pool.purchaseDeadline(), purchase);
        assertEq(pool.settlementDeadline(), settlement);
        assertEq(pool.organizer(), ORGANIZER);
        assertEq(pool.supplier(), SUPPLIER);
        assertEq(pool.fulfillment(), SHIPPER);
        assertTrue(goodsOut == 0 || goodsOut == item * locked);
        assertLe(shippingOut, reserve * locked);
        if (phase != 4) assertEq(feesOut, 0);
        assertLe(feesOut, fee * locked);
    }

    function drain() public {
        vm.warp(block.timestamp > settlement ? block.timestamp : settlement);
        if (phase == 0) step(2, 0, 0);
        if (phase == 1) step(4, 0, 0);
        if (phase == 2) step(8, 0, 0);
        for (uint256 i; i < 4; i++) {
            if (member[i] && !refunded[i]) step(9, i, 0);
        }
        if (phase == 4 && !paidFee) step(10, 0, 0);
        check();
        assertEq(token.balanceOf(address(pool)), surplus, "terminal drain leaves only surplus");
    }
}
