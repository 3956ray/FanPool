// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FanPool} from "../../src/FanPool.sol";
import {FanPoolFactory} from "../../src/FanPoolFactory.sol";

contract HostileToken is ERC20 {
    // 0 normal, 1 false, 2 revert, 3 no-op true, 4 tax, 5 no-return correct, 6 no-return no-op.
    uint256 public mode;
    address public callbackTarget;
    bytes[] internal calls;
    uint256 public blocked;

    constructor() ERC20("TEST HOSTILE", "BAD") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function setMode(uint256 m) external {
        mode = m;
    }

    function setCallbacks(address target, bytes[] memory data) external {
        callbackTarget = target;
        calls = data;
    }

    function transfer(address to, uint256 a) public override returns (bool) {
        return _act(msg.sender, to, a);
    }

    function transferFrom(address from, address to, uint256 a) public override returns (bool) {
        _spendAllowance(from, msg.sender, a);
        return _act(from, to, a);
    }

    function _act(address from, address to, uint256 a) internal returns (bool) {
        if (mode == 1) return false;
        if (mode == 2) revert("TOKEN_REJECTED");
        if (mode == 3) return true;
        if (mode == 6) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (mode == 4 && a > 0) {
            _transfer(from, to, a - 1);
            _burn(from, 1);
        } else {
            _transfer(from, to, a);
        }
        if (callbackTarget != address(0)) {
            for (uint256 i; i < calls.length; i++) {
                (bool ok, bytes memory reason) = callbackTarget.call(calls[i]);
                require(
                    !ok && reason.length == 4 && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")),
                    "callback not rejected by guard"
                );
                blocked++;
            }
        }
        if (mode == 5) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return true;
    }
}

contract HostileTokenTest is Test {
    address internal constant ALICE = address(0x400);
    address internal constant SUPPLIER = address(0x200);
    address internal constant SHIPPER = address(0x300);
    HostileToken internal token;
    FanPool internal pool;

    function setupPool() internal {
        token = new HostileToken();
        FanPoolFactory f = new FanPoolFactory(address(token));
        pool = f.createPool(
            FanPool.Config(
                SUPPLIER, SHIPPER, 10, 4, 1, 1, 2, block.timestamp + 100, block.timestamp + 200, block.timestamp + 300
            )
        );
        token.mint(ALICE, 100);
        vm.prank(ALICE);
        token.approve(address(pool), 100);
    }

    function joinAlice() internal {
        vm.prank(ALICE);
        pool.join();
    }

    function toReady() internal {
        joinAlice();
        vm.warp(pool.fundingDeadline());
        pool.resolveFunding();
    }

    function toPurchased() internal {
        toReady();
        pool.paySupplier();
    }

    function digest() internal view returns (bytes32) {
        bytes32 control = keccak256(
            abi.encode(
                uint256(pool.state()),
                uint256(pool.closeReason()),
                uint256(pool.failureReason()),
                pool.fundedCount(),
                pool.lockedN()
            )
        );
        bytes32 rights = keccak256(
            abi.encode(pool.active(ALICE), pool.claimed(ALICE), pool.fulfillmentExecuted(), pool.s(), pool.feeClaimed())
        );
        bytes32 balances = keccak256(
            abi.encode(
                token.balanceOf(address(pool)),
                token.balanceOf(ALICE),
                token.balanceOf(SUPPLIER),
                token.balanceOf(SHIPPER),
                token.balanceOf(address(this)),
                token.allowance(ALICE, address(pool))
            )
        );
        return keccak256(abi.encode(control, rights, balances));
    }

    function callOperation(uint256 op) internal returns (bool ok) {
        bytes memory data;
        if (op == 0) data = abi.encodeCall(pool.join, ());
        else if (op == 1) data = abi.encodeCall(pool.exit, ());
        else if (op == 2) data = abi.encodeCall(pool.paySupplier, ());
        else if (op == 3) data = abi.encodeCall(pool.payFulfillment, (2));
        else if (op == 4) data = abi.encodeCall(pool.claimRefundFor, (ALICE));
        else data = abi.encodeCall(pool.claimFee, ());
        if (op < 2) vm.prank(ALICE);
        (ok,) = address(pool).call(data);
    }

    function prepare(uint256 op) internal {
        setupPool();
        if (op == 1) {
            joinAlice();
        } else if (op == 2) {
            toReady();
        } else if (op >= 3) {
            toPurchased();
            if (op >= 4) pool.closeNormal();
        }
    }

    function testEveryTransferFailureRollsBackEveryMoneyPath() public {
        for (uint256 mode = 1; mode <= 6; mode++) {
            if (mode == 5) continue;
            for (uint256 op; op < 6; op++) {
                prepare(op);
                token.setMode(mode);
                bytes32 beforeState = digest();
                assertFalse(callOperation(op));
                assertEq(digest(), beforeState);
                token.setMode(0);
                assertTrue(callOperation(op), "healthy retry succeeds");
            }
        }
    }

    function testNoReturnExactTokenAllMoneyPaths() public {
        for (uint256 op; op < 6; op++) {
            prepare(op);
            token.setMode(5);
            assertTrue(callOperation(op));
        }
    }

    function testGuardRejectsEveryEntrypointDuringEveryTransfer() public {
        for (uint256 op; op < 6; op++) {
            prepare(op);
            bytes[] memory data = new bytes[](11);
            data[0] = abi.encodeCall(pool.join, ());
            data[1] = abi.encodeCall(pool.exit, ());
            data[2] = abi.encodeCall(pool.resolveFunding, ());
            data[3] = abi.encodeCall(pool.paySupplier, ());
            data[4] = abi.encodeCall(pool.expirePurchase, ());
            data[5] = abi.encodeCall(pool.payFulfillment, (0));
            data[6] = abi.encodeCall(pool.closeNormal, ());
            data[7] = abi.encodeCall(pool.abort, ());
            data[8] = abi.encodeCall(pool.closeTimeout, ());
            data[9] = abi.encodeCall(pool.claimRefundFor, (ALICE));
            data[10] = abi.encodeCall(pool.claimFee, ());
            token.setCallbacks(address(pool), data);
            assertTrue(callOperation(op));
            assertEq(token.blocked(), 11);
        }
    }
}
