// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed local-test purchasing policy. No guarantee of physical delivery.
contract FanPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        FUNDING,
        READY,
        PURCHASED,
        FAILED,
        CLOSED
    }
    enum CloseReason {
        NONE,
        NORMAL,
        ORGANIZER_ABORT,
        SETTLEMENT_TIMEOUT
    }
    enum FailureReason {
        NONE,
        BELOW_MIN,
        PURCHASE_TIMEOUT
    }

    struct Config {
        address supplier;
        address fulfillment;
        uint256 item;
        uint256 reserve;
        uint256 fee;
        uint256 min;
        uint256 max;
        uint256 fundingDeadline;
        uint256 purchaseDeadline;
        uint256 settlementDeadline;
    }

    error InvalidConfig();
    error WrongState();
    error WrongTime();
    error Unauthorized();
    error InvalidMember();
    error AlreadyClaimed();
    error FulfillmentRejected();
    error InexactTransfer();

    IERC20 public immutable token;
    address public immutable factory;
    address public immutable organizer;
    address public immutable supplier;
    address public immutable fulfillment;
    uint256 public immutable item;
    uint256 public immutable reserve;
    uint256 public immutable fee;
    uint256 public immutable commitment;
    uint256 public immutable min;
    uint256 public immutable max;
    uint256 public immutable fundingDeadline;
    uint256 public immutable purchaseDeadline;
    uint256 public immutable settlementDeadline;
    State public state;
    CloseReason public closeReason;
    FailureReason public failureReason;
    mapping(address => bool) public active;
    mapping(address => bool) public claimed;
    uint256 public fundedCount;
    uint256 public lockedN;
    uint256 public s;
    bool public fulfillmentExecuted;
    bool public feeClaimed;

    event Joined(address indexed owner, uint256 amount, uint256 fundedAddresses);
    event Exited(address indexed owner, uint256 amount, uint256 fundedAddresses);
    event Resolved(address indexed actor, State state, uint256 lockedN, FailureReason reason);
    event SupplierPaid(address indexed actor, address indexed recipient, uint256 amount, uint256 lockedN);
    event FulfillmentPaid(
        address indexed actor, address indexed recipient, uint256 amount, uint256 perAddressCost, uint256 lockedN
    );
    event Closed(address indexed actor, CloseReason reason, uint256 lockedN);
    event RefundClaimed(address indexed actor, address indexed owner, uint256 amount);
    event FeeClaimed(address indexed actor, address indexed organizer, uint256 amount);

    constructor(address token_, address organizer_, Config memory c) {
        if (
            msg.sender.code.length == 0 || token_.code.length == 0 || organizer_ == address(0)
                || c.supplier == address(0) || c.fulfillment == address(0) || c.supplier == organizer_
                || c.fulfillment == organizer_ || c.supplier == address(this) || c.fulfillment == address(this)
                || c.item == 0 || c.min == 0 || c.min > c.max || c.max > 1000 || block.timestamp >= c.fundingDeadline
                || c.fundingDeadline >= c.purchaseDeadline || c.purchaseDeadline >= c.settlementDeadline
        ) revert InvalidConfig();
        uint256 cap = c.item + c.reserve + c.fee;
        // Explicitly bound the maximum pool commitment; subsequent individual products fit.
        if (cap > type(uint256).max / c.max) revert InvalidConfig();
        token = IERC20(token_);
        factory = msg.sender;
        organizer = organizer_;
        supplier = c.supplier;
        fulfillment = c.fulfillment;
        item = c.item;
        reserve = c.reserve;
        fee = c.fee;
        commitment = cap;
        min = c.min;
        max = c.max;
        fundingDeadline = c.fundingDeadline;
        purchaseDeadline = c.purchaseDeadline;
        settlementDeadline = c.settlementDeadline;
    }

    modifier inState(State expected) {
        if (state != expected) revert WrongState();
        _;
    }

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert Unauthorized();
        _;
    }

    function join() external nonReentrant inState(State.FUNDING) {
        if (block.timestamp >= fundingDeadline) revert WrongTime();
        if (active[msg.sender] || fundedCount >= max) revert InvalidMember();
        active[msg.sender] = true;
        fundedCount++;
        if (fundedCount == max) {
            lockedN = fundedCount;
            state = State.READY;
        }
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), commitment);
        if (token.balanceOf(address(this)) != beforeBalance + commitment) revert InexactTransfer();
        emit Joined(msg.sender, commitment, fundedCount);
        if (state == State.READY) emit Resolved(msg.sender, state, lockedN, FailureReason.NONE);
    }

    function exit() external nonReentrant inState(State.FUNDING) {
        if (block.timestamp >= fundingDeadline) revert WrongTime();
        if (!active[msg.sender]) revert InvalidMember();
        active[msg.sender] = false;
        fundedCount--;
        _send(msg.sender, commitment);
        emit Exited(msg.sender, commitment, fundedCount);
    }

    function resolveFunding() external nonReentrant inState(State.FUNDING) {
        if (block.timestamp < fundingDeadline) revert WrongTime();
        lockedN = fundedCount;
        if (lockedN < min) {
            state = State.FAILED;
            failureReason = FailureReason.BELOW_MIN;
        } else if (block.timestamp >= purchaseDeadline) {
            state = State.FAILED;
            failureReason = FailureReason.PURCHASE_TIMEOUT;
        } else {
            state = State.READY;
        }
        emit Resolved(msg.sender, state, lockedN, failureReason);
    }

    function paySupplier() external nonReentrant onlyOrganizer inState(State.READY) {
        if (block.timestamp >= purchaseDeadline) revert WrongTime();
        state = State.PURCHASED;
        uint256 amount = item * lockedN;
        _send(supplier, amount);
        emit SupplierPaid(msg.sender, supplier, amount, lockedN);
    }

    function expirePurchase() external nonReentrant inState(State.READY) {
        if (block.timestamp < purchaseDeadline) revert WrongTime();
        state = State.FAILED;
        failureReason = FailureReason.PURCHASE_TIMEOUT;
        emit Resolved(msg.sender, state, lockedN, failureReason);
    }

    function payFulfillment(uint256 cost) external nonReentrant onlyOrganizer inState(State.PURCHASED) {
        if (block.timestamp >= settlementDeadline) revert WrongTime();
        if (fulfillmentExecuted || cost > reserve) revert FulfillmentRejected();
        fulfillmentExecuted = true;
        s = cost;
        uint256 amount = cost * lockedN;
        _send(fulfillment, amount);
        emit FulfillmentPaid(msg.sender, fulfillment, amount, cost, lockedN);
    }

    function closeNormal() external nonReentrant onlyOrganizer inState(State.PURCHASED) {
        if (block.timestamp >= settlementDeadline) revert WrongTime();
        _close(CloseReason.NORMAL);
    }

    function abort() external nonReentrant onlyOrganizer inState(State.PURCHASED) {
        if (block.timestamp >= settlementDeadline) revert WrongTime();
        _close(CloseReason.ORGANIZER_ABORT);
    }

    function closeTimeout() external nonReentrant inState(State.PURCHASED) {
        if (block.timestamp < settlementDeadline) revert WrongTime();
        _close(CloseReason.SETTLEMENT_TIMEOUT);
    }

    function claimRefundFor(address owner) external nonReentrant {
        if (state != State.FAILED && state != State.CLOSED) revert WrongState();
        if (!active[owner]) revert InvalidMember();
        if (claimed[owner]) revert AlreadyClaimed();
        claimed[owner] = true;
        uint256 amount = state == State.FAILED ? commitment : reserve - s;
        _send(owner, amount);
        emit RefundClaimed(msg.sender, owner, amount);
    }

    function claimFee() external nonReentrant inState(State.CLOSED) {
        if (feeClaimed) revert AlreadyClaimed();
        feeClaimed = true;
        uint256 amount = fee * lockedN;
        _send(organizer, amount);
        emit FeeClaimed(msg.sender, organizer, amount);
    }

    function _close(CloseReason reason) internal {
        state = State.CLOSED;
        closeReason = reason;
        emit Closed(msg.sender, reason, lockedN);
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        uint256 beforePool = token.balanceOf(address(this));
        uint256 beforeRecipient = token.balanceOf(to);
        token.safeTransfer(to, amount);
        if (token.balanceOf(address(this)) + amount != beforePool || token.balanceOf(to) != beforeRecipient + amount) {
            revert InexactTransfer();
        }
    }
}
