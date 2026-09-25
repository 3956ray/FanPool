// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FanPool} from "../../src/FanPool.sol";
import {FanPoolFactory} from "../../src/FanPoolFactory.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

contract FanPoolTest is Test {
    MockUSDC internal token;
    FanPoolFactory internal factory;
    FanPool internal pool;
    address internal organizer = address(0x100);
    address internal supplier = address(0x200);
    address internal fulfillment = address(0x300);
    address internal alice = address(0x400);
    address internal bob = address(0x500);
    address internal stranger = address(0x600);
    uint256 internal constant C = 15e6;

    function config() internal view returns (FanPool.Config memory) {
        return FanPool.Config(supplier, fulfillment, 10e6, 4e6, 1e6, 2, 3, 100, 200, 300);
    }

    function setUp() public {
        vm.warp(1);
        token = new MockUSDC();
        factory = new FanPoolFactory(address(token));
        vm.prank(organizer);
        pool = factory.createPool(config());
        fund(alice);
        fund(bob);
        fund(organizer);
    }

    function fund(address who) internal {
        token.mint(who, 1000e6);
        vm.prank(who);
        token.approve(address(pool), type(uint256).max);
    }

    function join(address who) internal {
        vm.prank(who);
        pool.join();
    }

    function ready() internal {
        join(alice);
        join(bob);
        vm.warp(100);
        pool.resolveFunding();
    }

    function purchased() internal {
        ready();
        vm.prank(organizer);
        pool.paySupplier();
    }

    function assertState(FanPool.State s) internal view {
        assertEq(uint256(pool.state()), uint256(s));
    }

    function testCommitmentAndMock() public view {
        assertEq(pool.commitment(), C);
        assertEq(token.decimals(), 6);
        assertEq(token.name(), "MOCK USDC - NO REAL VALUE");
        assertEq(address(factory.token()), address(token));
        assertEq(pool.organizer(), organizer);
    }

    function testFullLockAndExitRejoin() public {
        join(alice);
        vm.prank(alice);
        pool.exit();
        assertFalse(pool.active(alice));
        join(alice);
        join(bob);
        join(organizer);
        assertState(FanPool.State.READY);
        assertEq(pool.lockedN(), 3);
        vm.expectRevert();
        vm.prank(alice);
        pool.exit();
        vm.expectRevert();
        pool.join();
    }

    function testDoubleJoinAndInactiveExit() public {
        join(alice);
        vm.expectRevert();
        vm.prank(alice);
        pool.join();
        vm.expectRevert();
        vm.prank(bob);
        pool.exit();
        assertEq(pool.fundedCount(), 1);
    }

    function testFundingBoundaryAndDelayedResolution() public {
        vm.warp(99);
        join(alice);
        vm.prank(alice);
        pool.exit();
        join(alice);
        join(bob);
        vm.expectRevert();
        pool.resolveFunding();
        vm.warp(100);
        vm.expectRevert();
        vm.prank(alice);
        pool.exit();
        vm.expectRevert();
        pool.join();
        vm.warp(400);
        pool.resolveFunding();
        assertState(FanPool.State.FAILED);
        assertEq(uint256(pool.failureReason()), uint256(FanPool.FailureReason.PURCHASE_TIMEOUT));
        pool.claimRefundFor(alice);
        pool.claimRefundFor(bob);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function testBelowMinAndEmptyFailure() public {
        join(alice);
        vm.warp(100);
        pool.resolveFunding();
        assertState(FanPool.State.FAILED);
        assertEq(pool.lockedN(), 1);
        assertEq(uint256(pool.failureReason()), 1);
        pool.claimRefundFor(alice);
        assertEq(token.balanceOf(alice), 1000e6);
        vm.expectRevert();
        pool.claimRefundFor(alice);
        vm.expectRevert();
        pool.claimFee();
    }

    function testEmptyFailure() public {
        vm.warp(100);
        pool.resolveFunding();
        assertEq(pool.lockedN(), 0);
        vm.expectRevert();
        pool.claimRefundFor(alice);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function testExactPurchaseAndAuthorization() public {
        ready();
        vm.expectRevert();
        pool.paySupplier();
        vm.warp(199);
        vm.prank(organizer);
        pool.paySupplier();
        assertEq(token.balanceOf(supplier), 20e6);
        assertState(FanPool.State.PURCHASED);
        vm.expectRevert();
        vm.prank(organizer);
        pool.paySupplier();
        vm.expectRevert();
        pool.claimFee();
        vm.expectRevert();
        pool.claimRefundFor(alice);
    }

    function testPurchaseBoundary() public {
        ready();
        vm.warp(199);
        vm.expectRevert();
        pool.expirePurchase();
        vm.warp(200);
        vm.expectRevert();
        vm.prank(organizer);
        pool.paySupplier();
        pool.expirePurchase();
        pool.claimRefundFor(alice);
        pool.claimRefundFor(bob);
        assertEq(token.balanceOf(address(pool)), 0);
        vm.expectRevert();
        pool.expirePurchase();
    }

    function testNormalCloseAndThirdPartyClaims() public {
        purchased();
        vm.prank(organizer);
        pool.payFulfillment(2e6);
        vm.prank(organizer);
        pool.closeNormal();
        assertEq(uint256(pool.closeReason()), 1);
        vm.prank(stranger);
        pool.claimFee();
        vm.prank(stranger);
        pool.claimRefundFor(alice);
        pool.claimRefundFor(bob);
        assertEq(token.balanceOf(alice), 987e6);
        assertEq(token.balanceOf(organizer), 1002e6);
        assertEq(token.balanceOf(fulfillment), 4e6);
        assertEq(token.balanceOf(stranger), 0);
        assertEq(token.balanceOf(address(pool)), 0);
        vm.expectRevert();
        pool.claimFee();
        vm.expectRevert();
        pool.claimRefundFor(alice);
        vm.expectRevert();
        vm.prank(organizer);
        pool.closeNormal();
    }

    function testCapRejectedAbortAndFee() public {
        purchased();
        vm.expectRevert();
        vm.prank(organizer);
        pool.payFulfillment(4e6 + 1);
        vm.expectRevert();
        vm.prank(organizer);
        pool.payFulfillment(type(uint256).max);
        assertFalse(pool.fulfillmentExecuted());
        assertEq(token.balanceOf(address(pool)), 10e6);
        vm.prank(organizer);
        pool.abort();
        assertEq(uint256(pool.closeReason()), 2);
        pool.claimRefundFor(alice);
        pool.claimRefundFor(bob);
        pool.claimFee();
        assertEq(token.balanceOf(alice), 989e6);
        assertEq(token.balanceOf(organizer), 1002e6);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function testSettlementBoundaryAndFullReserve() public {
        purchased();
        vm.warp(299);
        vm.expectRevert();
        pool.closeTimeout();
        vm.prank(organizer);
        pool.payFulfillment(4e6);
        vm.expectRevert();
        vm.prank(organizer);
        pool.payFulfillment(0);
        vm.warp(300);
        vm.expectRevert();
        vm.prank(organizer);
        pool.closeNormal();
        vm.expectRevert();
        vm.prank(organizer);
        pool.abort();
        vm.expectRevert();
        vm.prank(organizer);
        pool.payFulfillment(0);
        vm.prank(stranger);
        pool.closeTimeout();
        assertEq(uint256(pool.closeReason()), 3);
        pool.claimRefundFor(alice);
        assertTrue(pool.claimed(alice));
        vm.expectRevert();
        pool.claimRefundFor(alice);
        pool.claimRefundFor(bob);
        pool.claimFee();
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function testZeroFulfillmentConsumesSlotAndSurplus() public {
        token.mint(address(pool), 7);
        purchased();
        vm.prank(organizer);
        pool.payFulfillment(0);
        assertTrue(pool.fulfillmentExecuted());
        vm.expectRevert();
        vm.prank(organizer);
        pool.payFulfillment(1);
        token.mint(address(pool), 11);
        vm.warp(301);
        pool.closeTimeout();
        pool.claimRefundFor(alice);
        token.mint(address(pool), 13);
        pool.claimRefundFor(bob);
        pool.claimFee();
        assertEq(token.balanceOf(address(pool)), 31);
    }

    function testZeroFeeAndReserve() public {
        FanPool.Config memory cfg = config();
        cfg.reserve = 0;
        cfg.fee = 0;
        cfg.min = 1;
        cfg.max = 1;
        vm.prank(organizer);
        pool = factory.createPool(cfg);
        fund(alice);
        join(alice);
        vm.prank(organizer);
        pool.paySupplier();
        vm.prank(organizer);
        pool.abort();
        pool.claimRefundFor(alice);
        pool.claimFee();
        assertTrue(pool.claimed(alice));
        assertTrue(pool.feeClaimed());
        vm.expectRevert();
        pool.claimFee();
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function testInvalidConstruction() public {
        FanPool.Config memory c = config();
        c.supplier = address(0);
        reject(c);
        c = config();
        c.supplier = organizer;
        reject(c);
        c = config();
        c.fulfillment = organizer;
        reject(c);
        c = config();
        c.fulfillment = address(0);
        reject(c);
        c = config();
        c.item = 0;
        reject(c);
        c = config();
        c.min = 0;
        reject(c);
        c = config();
        c.min = 4;
        reject(c);
        c = config();
        c.max = 1001;
        reject(c);
        c = config();
        c.max = 0;
        reject(c);
        c = config();
        c.fundingDeadline = 1;
        reject(c);
        c = config();
        c.purchaseDeadline = 100;
        reject(c);
        c = config();
        c.settlementDeadline = 200;
        reject(c);
        c = config();
        c.item = type(uint256).max;
        reject(c);
        c = config();
        c.item = type(uint256).max / 2;
        c.reserve = 0;
        c.fee = 0;
        reject(c);
        vm.expectRevert();
        new FanPoolFactory(address(0));
        vm.expectRevert();
        new FanPoolFactory(alice);
    }

    function reject(FanPool.Config memory cfg) internal {
        vm.expectRevert();
        vm.prank(organizer);
        factory.createPool(cfg);
    }

    function testSharedRecipientsAndOrganizerAsJoiner() public {
        FanPool.Config memory c = config();
        c.fulfillment = c.supplier;
        vm.prank(organizer);
        pool = factory.createPool(c);
        fund(organizer);
        join(organizer);
        assertTrue(pool.active(organizer));
    }

    function testNoAllowanceNoSlot() public {
        vm.prank(alice);
        token.approve(address(pool), 0);
        vm.expectRevert();
        vm.prank(alice);
        pool.join();
        assertEq(pool.fundedCount(), 0);
        assertFalse(pool.active(alice));
    }

    function testPoolSelfRecipientAndZeroOrganizerRejected() public {
        FanPool.Config memory c = config();
        c.supplier = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        reject(c);
        c = config();
        c.fulfillment = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        reject(c);
        c = config();
        vm.expectRevert();
        new FanPool(address(token), address(0), c);
        vm.expectRevert();
        vm.prank(alice);
        new FanPool(address(token), organizer, c);
    }

    function testMaxBoundAndIdenticalRecipientsActualPayment() public {
        FanPool.Config memory c = config();
        c.max = 1000;
        c.min = 1;
        c.fulfillment = supplier;
        vm.prank(organizer);
        pool = factory.createPool(c);
        fund(alice);
        join(alice);
        vm.warp(100);
        pool.resolveFunding();
        vm.prank(organizer);
        pool.paySupplier();
        vm.prank(organizer);
        pool.payFulfillment(1e6);
        assertEq(token.balanceOf(supplier), 11e6);
        assertEq(pool.lockedN(), 1);
    }

    function testUnauthorizedAllOrganizerOperationsAndMissingArbitraryPaymentABI() public {
        purchased();
        vm.expectRevert();
        pool.payFulfillment(0);
        vm.expectRevert();
        pool.closeNormal();
        vm.expectRevert();
        pool.abort();
        vm.prank(organizer);
        (bool ok,) = address(pool).call(abi.encodeWithSignature("paySupplier(uint256,address)", 1, organizer));
        assertFalse(ok);
        vm.prank(organizer);
        (ok,) = address(pool).call(abi.encodeWithSignature("withdraw(address,uint256)", organizer, 1));
        assertFalse(ok);
        (ok,) = address(pool).call("");
        assertFalse(ok);
    }

    function testDeadlinePlusOneCannotAct() public {
        vm.warp(101);
        vm.expectRevert();
        pool.join();
        vm.expectRevert();
        vm.prank(alice);
        pool.exit();
        pool.resolveFunding();
        vm.warp(1);
        FanPool.Config memory c = config();
        vm.prank(organizer);
        pool = factory.createPool(c);
        fund(alice);
        fund(bob);
        ready();
        vm.warp(201);
        vm.expectRevert();
        vm.prank(organizer);
        pool.paySupplier();
        pool.expirePurchase();
    }

    function testDirectTransferDoesNotGrantRights() public {
        token.mint(stranger, 99);
        vm.prank(stranger);
        token.transfer(address(pool), 99);
        assertEq(pool.fundedCount(), 0);
        assertFalse(pool.active(stranger));
        purchased();
        vm.warp(300);
        pool.closeTimeout();
        vm.expectRevert();
        pool.claimRefundFor(stranger);
        pool.claimRefundFor(alice);
        pool.claimRefundFor(bob);
        pool.claimFee();
        assertEq(token.balanceOf(address(pool)), 99);
    }

    function testRoleOverlapSupplierFulfillmentAndFundedOrganizerSettlesExactly() public {
        FanPool.Config memory c = config();
        c.supplier = alice;
        c.fulfillment = alice;
        vm.prank(organizer);
        pool = factory.createPool(c);
        fund(alice);
        fund(bob);
        fund(organizer);
        // fund() adds 1000 to existing 1000 balances in this fixture.
        join(alice);
        join(bob);
        join(organizer);
        vm.prank(organizer);
        pool.paySupplier();
        vm.prank(organizer);
        pool.payFulfillment(2e6);
        vm.prank(organizer);
        pool.closeNormal();
        vm.startPrank(stranger);
        pool.claimRefundFor(alice);
        pool.claimRefundFor(bob);
        pool.claimRefundFor(organizer);
        pool.claimFee();
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 2023e6);
        assertEq(token.balanceOf(bob), 1987e6);
        assertEq(token.balanceOf(organizer), 1990e6);
        assertEq(token.balanceOf(address(pool)), 0);
    }
}
