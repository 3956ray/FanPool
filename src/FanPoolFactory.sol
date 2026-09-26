// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FanPool} from "./FanPool.sol";
/// @notice Deploy once with the local MockUSDC; token is immutable for every pool.

contract FanPoolFactory {
    IERC20 public immutable token;

    event PoolCreated(address indexed organizer, address indexed pool, address indexed token);

    constructor(address token_) {
        if (token_.code.length == 0) revert FanPool.InvalidConfig();
        token = IERC20(token_);
    }

    function createPool(FanPool.Config calldata config) external returns (FanPool pool) {
        pool = new FanPool(address(token), msg.sender, config);
        emit PoolCreated(msg.sender, address(pool), address(token));
    }
}
