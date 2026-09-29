// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReferenceHandler} from "../helpers/ReferenceHandler.sol";

contract SequencesTest is Test {
    function testFuzzIndependentSequence(uint256 seed) public {
        ReferenceHandler h = new ReferenceHandler();
        h.create(seed);
        for (uint256 i; i < 32; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            h.step(seed, seed >> 32, seed >> 64);
        }
        h.drain();
    }

    function testDirectedCoverageAllStatesAndActions() public {
        ReferenceHandler h = new ReferenceHandler();
        // One-slot full order, fulfillment, normal close, fee/refund and surplus.
        h.step(0, 0, 0);
        h.step(3, 0, 0);
        h.step(5, 0, 0);
        h.step(6, 0, 0);
        h.step(9, 0, 0);
        h.step(10, 0, 0);
        h.step(11, 0, 7);
        // max=3/min=2: exit/rejoin, deadline lock, then procurement timeout.
        h.create(35);
        h.step(0, 0, 0);
        h.step(1, 0, 0);
        h.step(0, 0, 0);
        h.step(0, 1, 0);
        h.step(12, 0, 100);
        h.step(2, 0, 0);
        h.step(12, 0, 100);
        h.step(4, 0, 0);
        h.drain();
        h.create(0);
        h.step(0, 0, 0);
        h.step(3, 0, 0);
        h.step(7, 0, 0);
        h.drain();
        h.create(0);
        h.step(0, 0, 0);
        h.step(3, 0, 0);
        h.step(12, 0, 150);
        h.step(12, 0, 150);
        h.step(8, 0, 0);
        h.drain();
        h.invalid(0);
        h.step(13, 0, 0);
        for (uint256 i; i < 5; i++) {
            assertGt(h.stateVisits(i), 0);
            emit log_named_uint(string(abi.encodePacked("state ", vm.toString(i))), h.stateVisits(i));
        }
        for (uint256 i; i < 15; i++) {
            emit log_named_uint(string(abi.encodePacked("success action ", vm.toString(i))), h.successCount(i));
            if (i != 13) assertGt(h.successCount(i), 0);
        }
        assertGt(h.rejectCount(13), 0);
    }

    function testDrainFromEveryIntermediateSnapshot() public {
        ReferenceHandler h = new ReferenceHandler();
        h.create(35);
        verifyDrainAndRestore(h);
        h.step(0, 0, 0);
        verifyDrainAndRestore(h);
        h.step(0, 1, 0);
        h.step(12, 0, 100);
        h.step(2, 0, 0);
        verifyDrainAndRestore(h);
        h.step(3, 0, 0);
        verifyDrainAndRestore(h);
        h.step(5, 0, 1);
        verifyDrainAndRestore(h);
        h.step(7, 0, 0);
        verifyDrainAndRestore(h);
        h.step(9, 0, 0);
        verifyDrainAndRestore(h);
        h.step(10, 0, 0);
        verifyDrainAndRestore(h);
        h.create(35);
        h.step(0, 0, 0);
        h.step(12, 0, 100);
        h.step(2, 0, 0);
        verifyDrainAndRestore(h);
    }

    function verifyDrainAndRestore(ReferenceHandler h) internal {
        uint256 snap = vm.snapshotState();
        h.drain();
        assertTrue(vm.revertToState(snap));
        h.check();
    }
}
