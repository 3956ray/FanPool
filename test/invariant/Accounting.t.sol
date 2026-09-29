// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ReferenceHandler} from "../helpers/ReferenceHandler.sol";

contract AccountingInvariant is StdInvariant, Test {
    ReferenceHandler internal h;

    function setUp() public {
        h = new ReferenceHandler();
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = h.step.selector;
        selectors[1] = h.create.selector;
        selectors[2] = h.invalid.selector;
        selectors[3] = h.progress.selector;
        targetSelector(FuzzSelector(address(h), selectors));
        targetContract(address(h));
    }

    function invariantIndependentLedger() public view {
        h.check();
    }

    function afterInvariant() public {
        h.drain();
    }
}
