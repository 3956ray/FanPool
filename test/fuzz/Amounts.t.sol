// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FanPool} from "../../src/FanPool.sol";
import {FanPoolFactory} from "../../src/FanPoolFactory.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

contract AmountsTest is Test {
    function testFuzzAllCloseReasons(uint96 rawI, uint96 rawR, uint96 rawF, uint8 rawN, uint256 rawS, uint8 rawReason)
        public
    {
        uint256 item = uint256(rawI) + 1;
        uint256 reserve = rawR;
        uint256 fee = rawF;
        uint256 n = 1 + rawN % 8;
        uint256 s = rawS % (reserve + 1);
        uint256 reason = rawReason % 3;
        MockUSDC token = new MockUSDC();
        FanPoolFactory factory = new FanPoolFactory(address(token));
        FanPool.Config memory cfg = FanPool.Config(
            address(0x123),
            address(0x456),
            item,
            reserve,
            fee,
            n,
            n,
            block.timestamp + 100,
            block.timestamp + 200,
            block.timestamp + 300
        );
        FanPool pool = factory.createPool(cfg);
        uint256 commitment = item + reserve + fee;
        for (uint256 i; i < n; i++) {
            address a = address(uint160(0x2000 + i));
            token.mint(a, commitment);
            vm.startPrank(a);
            token.approve(address(pool), commitment);
            pool.join();
            vm.stopPrank();
        }
        pool.paySupplier();
        pool.payFulfillment(s);
        if (reason == 0) {
            pool.closeNormal();
        } else if (reason == 1) {
            pool.abort();
        } else {
            vm.warp(block.timestamp + 300);
            pool.closeTimeout();
        }
        for (uint256 i; i < n; i++) {
            address a = address(uint160(0x2000 + i));
            pool.claimRefundFor(a);
            assertEq(token.balanceOf(a), reserve - s);
        }
        pool.claimFee();
        assertEq(token.balanceOf(address(this)), fee * n);
        assertEq(token.balanceOf(address(0x123)), item * n);
        assertEq(token.balanceOf(address(0x456)), s * n);
        assertEq(token.balanceOf(address(pool)), 0);
    }
}
