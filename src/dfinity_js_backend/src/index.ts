import { StableBTreeMap, Principal, nat64, ic, Opt, int8, int32, Vec, text, None, Canister, init, query, Some, update, Result, Err, Ok, Duration, bool, AzleVec } from 'azle';
import {
    Ledger, binaryAddressFromAddress, binaryAddressFromPrincipal, hexAddressFromPrincipal
} from "azle/canisters/ledger";
import { Lottery, LotteryPayload, BuyTicketPayload, LotteryConfiguration, Message, Order, Player } from './types';
import { hashCode } from "hashcode";
import { v4 as uuidv4 } from 'uuid';

// Mapping to hold storage information 
const lotteryStorage = StableBTreeMap(0, int32, Lottery);

// Player index mapping to show which lottery they participated in and the tickets they hold
let playerIndexMap = StableBTreeMap(1, Principal, Vec(text));

// Mapping that connects the player unique id to player position in lotteries
let indexToPosnMap = StableBTreeMap(2, text, int32);

// Orders for mapping
const persistedOrders = StableBTreeMap(3, Principal, Order);
const pendingOrders = StableBTreeMap(4, nat64, Order);

const ORDER_RESERVATION_PERIOD = 120n; // Reservation period in seconds

// Custom configuration settings
let nextLotteryId: Opt<int32> = None;
let lotteryState: Opt<int8> = None;
let ticketPrice: Opt<nat64> = None;
let lotteryDuration: Opt<nat64> = None;
let prizePool: Opt<nat64> = None;

// Initialization of the Ledger canister. The principal text value is hardcoded because 
// we set it in the `dfx.json`
const icpLedgerCanister = Ledger(Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai"));

export default Canister({
    initializeLottery: init([LotteryPayload], (payload) => {
        // Check lottery state, and fail if state is already initialized
        if (!('None' in lotteryState)) {
            ic.trap(`Lottery already initialized and is in state ${lotteryState}`);
        }

        // Check payload
        if (typeof payload !== "object" || Object.keys(payload).length === 0) {
            ic.trap("Invalid payload");
        }

        // Set lottery config parameters
        lotteryState = Some(0);
        ticketPrice = Some(payload.ticketPrice);

        // Lottery duration is passed in minutes for testing
        const timeInNanoSeconds = BigInt(60 * 1000000000);
        lotteryDuration = Some(payload.lotteryDuration * timeInNanoSeconds);
    }),

    startLottery: update([], Result(Lottery, Message), () => {
        // Check lottery state, and fail if state is not initialized
        if ('None' in lotteryState) {
            return Err({ ConfigError: "Lottery not yet initialized" });
        }

        // Only start lottery if state has been set to 0 i.e. ended
        if (lotteryState.Some !== 0) {
            return Err({ StateError: "Cannot start new lottery, check lottery state" });
        }

        // Get current lottery id
        let id: int32 = getCurrentLotteryId();

        // Check if lottery duration is set
        if ('None' in lotteryDuration) {
            return Err({ ConfigError: "Cannot start lottery, duration not set" });
        }

        // Create new lottery record
        const lottery = {
            id: id,
            startTime: ic.time(),
            endTime: ic.time() + lotteryDuration.Some,
            noOfTickets: 0,
            winner: None,
            winningTicket: None,
            reward: None,
            players: [],
            lotteryCompleted: 1
        };

        // Store lottery
        lotteryStorage.insert(lottery.id, lottery);

        // Update lottery state to 1 i.e. started
        lotteryState = Some(1);

        // Update next lottery
        nextLotteryId = Some(id + 1);

        return Ok(lottery);
    }),

    createTicketOrder: update([BuyTicketPayload], Result(Order, Message), (payload) => {
        // Check payload data
        if (typeof payload !== "object" || Object.keys(payload).length === 0) {
            return Err({ NotFound: "Invalid payload" });
        }

        // Check lottery state, and fail if state is not initialized
        if ('None' in lotteryState) {
            return Err({ ConfigError: "Lottery not yet initialized" });
        }

        // Only buy ticket if state has been set to 1 i.e. started
        if (lotteryState.Some !== 1) {
            return Err({ StateError: "Cannot buy ticket, check lottery state" });
        }

        // Get ticket price and amount to pay
        if ('None' in ticketPrice) {
            return Err({ ConfigError: 'Cannot buy tickets, price not set' });
        }

        // Get lottery
        const lotteryOpt = lotteryStorage.get(payload.lotteryId);
        if ("None" in lotteryOpt) {
            return Err({ NotFound: `Cannot create the order: Lottery session with id=${payload.lotteryId} not found` });
        }
        const lottery = lotteryOpt.Some;

        // Check that lottery hasn't ended
        if (lottery.endTime < ic.time()) {
            return Err({ StateError: "Lottery over, can't buy tickets" });
        }

        // Compute amount to be paid
        const amountToPay = BigInt(payload.noOfTickets) * ticketPrice.Some;

        // Create order
        const order: Order = {
            lotteryId: lottery.id,
            amount: amountToPay,
            status: { PaymentPending: "PAYMENT_PENDING" },
            ticketBuyer: ic.caller(),
            paid_at_block: None,
            memo: generateCorrelationId(lottery.id)
        };

        // Store and return order
        pendingOrders.insert(order.memo, order);
        discardByTimeout(order.memo, ORDER_RESERVATION_PERIOD);
        return Ok(order);
    }),

    registerTickets: update([int32, int32, nat64, nat64, nat64], Result(Order, Message), async (id, noOfTickets, amountPaid, block, memo) => {
        // Check lottery state, and fail if state is not initialized
        if ('None' in lotteryState) {
            return Err({ ConfigError: "Lottery not yet initialized" });
        }

        // Get transaction sender
        const caller = ic.caller();

        // Confirm payment verification else fail
        const paymentVerified = await verifyPaymentInternal(caller, amountPaid, block, memo);

        if (!paymentVerified) {
            return Err({ NotFound: `Cannot complete the purchase: Cannot verify the payment, memo=${memo}` });
        }

        // Get pending order and update
        const pendingOrderOpt = pendingOrders.remove(memo);
        if ("None" in pendingOrderOpt) {
            return Err({ NotFound: `Cannot complete the purchase: There is no pending order with memo=${memo}` });
        }
        const order = pendingOrderOpt.Some;
        const updatedOrder = { ...order, status: { Completed: "COMPLETED" }, paid_at_block: Some(block) };

        // Get and update prize pool
        if ('None' in prizePool) {
            prizePool = Some(amountPaid);
        } else {
            prizePool = Some(prizePool.Some + amountPaid);
        }

        // Get lottery and add tickets
        const lotteryOpt = lotteryStorage.get(id);
        if ("None" in lotteryOpt) {
            return Err({ NotFound: `Lottery session with id=${id} not found` });
        }

        const lottery = lotteryOpt.Some;

        // Generate ticket numbers and assign tickets to their ticket IDs
        const ticketNumbers: Vec<int32> = [];
        let newTicketId = lottery.noOfTickets;
        for (let i = 0; i < noOfTickets; i++) {
            ticketNumbers.push(newTicketId++);
        }

        // Generate lottery track identifier
        const idTrack = `#${id}#`;

        // Check mapping to get player lottery participation unique ID arrays
        let playerIdMap = playerIndexMap.get(caller);
        let playerInfos = lottery.players;

        if ("None" in playerIdMap) {
            // If empty, create new information for player
            let newId = `${uuidv4()}${idTrack}`;
            let newPlayerPosn = playerInfos.length + 1;

            // Create an empty array
            let newEntry: Vec<text> = [newId];
            playerIndexMap.insert(caller, newEntry);
            indexToPosnMap.insert(newId, newPlayerPosn);

            // Get player info and add to lottery player array
            let playerInfo = generatePlayerInformation(id, caller, newPlayerPosn, ticketNumbers);
            playerInfos.push(playerInfo);
        } else {
            let playerPosn: int32;
            let uniqueId: text = "";

            // Check if player already has unique ID 
            for (let i of playerIdMap.Some) {
                if (i.includes(idTrack)) {
                    uniqueId = i;
                    break;
                }
            }

            // Then get the player position
            let playerPosnOpt = indexToPosnMap.get(uniqueId);

            if ('None' in playerPosnOpt) {
                playerPosn = 0;
            } else {
                playerPosn = playerPosnOpt.Some;
            }

            // Check if unique ID not present or playerPosn is 0 i.e. hasn't bought a ticket in this lottery session
            if (uniqueId == "" && playerPosn == 0) {
                // Generate new ID and update the player mapping information
                let newId = `${uuidv4()}${idTrack}`;
                let newPlayerPosn = playerInfos.length + 1;
                let playerMaps = playerIdMap.Some;
                playerMaps.push(newId);
                playerIndexMap.insert(caller, playerMaps);
                indexToPosnMap.insert(newId, newPlayerPosn);
                let playerInfo = generatePlayerInformation(id, caller, newPlayerPosn, ticketNumbers);
                playerInfos.push(playerInfo);
            } else {
                // Else just add ticketNumbers to player tickets array
                let playerTickets = playerInfos[playerPosn - 1].tickets;
                playerInfos[playerPosn - 1].tickets = [...playerTickets, ...ticketNumbers];
            }
        }

        // Update record in storage
        const updatedLottery = {
            ...lottery,
            noOfTickets: lottery.noOfTickets + noOfTickets,
            players: playerInfos
        };

        persistedOrders.insert(ic.caller(), updatedOrder);
        lotteryStorage.insert(id, updatedLottery);
        return Ok(updatedOrder);
    }),

    endLottery: update([int32], Result(text, Message), (id) => {
        // Check lottery state, and fail if state is not initialized
        if ('None' in lotteryState) {
            return Err({ ConfigError: "Lottery not yet initialized" });
        }

        // Only end lottery if state has been set to 1 i.e. started
        if (lotteryState.Some !== 1) {
            return Err({ StateError: "Cannot end lottery, check lottery state" });
        }

        // Get lottery
        const lotteryOpt = lotteryStorage.get(id);
        if ("None" in lotteryOpt) {
            return Err({ NotFound: `Lottery session with id=${id} not found` });
        }

        const lottery = lotteryOpt.Some;

        // Check that lottery has ended
        if (lottery.endTime > ic.time()) {
            return Err({ StateError: "Lottery not yet over" });
        }

        // Check that the lottery has not been completed
        if (lottery.lotteryCompleted !== 1) {
            return Err({ StateError: "Lottery not yet completed" });
        }

        // Get and update prize pool
        if ('None' in prizePool) {
            return Err({ ConfigError: "Lottery pool is empty, please try again later." });
        }

        // Check if tickets are sold, then calculate rewards
        if (lottery.noOfTickets > 1) {
            const pool = prizePool.Some;
            // Calculate winner's reward
            const winnersReward = pool / 2n;

            prizePool = Some(pool - winnersReward);
            // Get random number as winning ticket
            const winningTicket = Math.floor(Math.random() * lottery.noOfTickets);

            // Update record in storage and set lottery completed status to 2 i.e. waiting for payouts
            const updatedLottery = {
                ...lottery,
                winningTicket: Some(winningTicket),
                lotteryCompleted: 2,
                reward: Some(winnersReward)
            };

            // Update records
            lotteryStorage.insert(lottery.id, updatedLottery);
        } else {
            // Update record in storage and set lottery completed status to 2 i.e. waiting for payouts
            const updatedLottery = {
                ...lottery,
                lotteryCompleted: 2,
            };

            // Update records
            lotteryStorage.insert(lottery.id, updatedLottery);
        }

        // Reset lottery state so new lottery can be started
        lotteryState = Some(0);

        return Ok("Lottery ended");
    }),

    checkIfWinner: update([int32], Result(text, Message), async (id) => {
        // Check lottery state, and fail if state is not initialized
        if ('None' in lotteryState) {
            return Err({ ConfigError: "Lottery not yet initialized" });
        }

        // Get caller
        const caller = ic.caller();

        // Get lottery
        const lotteryOpt = lotteryStorage.get(id);
        if ("None" in lotteryOpt) {
            return Err({ NotFound: `Lottery session with id=${id} not found` });
        }

        const lottery = lotteryOpt.Some;

        // Check if reward is set
        if ('None' in lottery.reward) {
            return Err({ LotteryError: "Reward not set" });
        }
        const reward = lottery.reward.Some;

        if (lottery.lotteryCompleted !== 2) {
            return Err({ StateError: "Cannot check if winner yet" });
        }

        let playerPosn: int32;
        let uniqueId: text = "";

        // Generate lottery track identifier
        const idTrack = `#${id}#`;

        // Check mapping to get player lottery participation unique ID arrays
        let playerIdMap = playerIndexMap.get(caller);

        if ('None' in playerIdMap) {
            return Err({ NotFound: "No lottery information" });
        }

        // Check player unique ID mapping for lottery id tracker
        for (let i of playerIdMap.Some) {
            if (i.includes(idTrack)) {
                uniqueId = i;
                break;
            }
        }

        // Then get the player position
        let playerPosnOpt = indexToPosnMap.get(uniqueId);

        if ('None' in playerPosnOpt) {
            playerPosn = 0;
        } else {
            playerPosn = playerPosnOpt.Some;
        }

        // If no unique ID is present and playerPosn is 0, exit application with error,
        // shows that player did not participate in the lottery.
        if (uniqueId == "" && playerPosn == 0) {
            return Err({ NotFound: "No lottery information" });
        }

        // Else continue and get player info
        const playerInfo = lottery.players[playerPosn - 1];

        // Check if lottery winning ticket is set
        if ('None' in lottery.winningTicket) {
            return Err({ LotteryError: "Winning ticket not set" });
        }

        // Check if player tickets for that lottery contains the winning ticket
        if (playerInfo.tickets.includes(lottery.winningTicket.Some)) {
            // Initiate payout to winner  
            await makePayment(playerInfo.player, reward);
        } else {
            return Err({ NotWinner: "Sorry, you're not the winner" });
        }

        // Update record in storage and set lottery completed status to payout completed
        const updatedLottery = {
            ...lottery,
            winner: Some(playerInfo.player),
            lotteryCompleted: 3,
        };

        lotteryStorage.insert(lottery.id, updatedLottery);

        return Ok("Congrats, you're the winner! Check your balance.");
    }),

    /*
        A helper function to get canister address from the principal
    */
    getCanisterAddress: query([], text, () => {
        let canisterPrincipal = ic.id();
        return hexAddressFromPrincipal(canisterPrincipal, 0);
    }),

    /*
        A helper function to get address from the principal
        The address is later used in the transfer method
    */
    getAddressFromPrincipal: query([Principal], text, (principal) => {
        return hexAddressFromPrincipal(principal, 0);
    }),

    getOrders: query([], Vec(Order), () => {
        return persistedOrders.values();
    }),

    getPendingOrders: query([], Vec(Order), () => {
        return pendingOrders.values();
    }),

    getLottery: query([int32], Result(Lottery, Message), (id) => {
        const lotteryOpt = lotteryStorage.get(id);
        if ("None" in lotteryOpt) {
            return Err({ NotFound: `Lottery session with id=${id} not found` });
        }
        return Ok(lotteryOpt.Some);
    }),

    getLotteries: query([], Vec(Lottery), () => {
        return lotteryStorage.values();
    }),

    getLotteryConfiguration: query([], LotteryConfiguration, () => {
        return { nextLotteryId, lotteryState, ticketPrice, lotteryDuration, prizePool };
    }),

    deleteLottery: update([int32], Result(text, Message), (id) => {
        const deletedLotteryOpt = lotteryStorage.remove(id);
        if ("None" in deletedLotteryOpt) {
            return Err({ NotFound: `Lottery session with id=${id} not found` });
        }

        if (deletedLotteryOpt.Some.lotteryCompleted !== 2) {
            return Err({ StateError: 'Lottery payout not yet finalized' });
        }

        return Ok(deletedLotteryOpt.Some.id.toString());
    }),

    cancelOrder: update([nat64], Result(text, Message), (memo) => {
        const orderOpt = pendingOrders.remove(memo);
        if ("None" in orderOpt) {
            return Err({ NotFound: `Order with memo=${memo} not found` });
        }
        return Ok(`Order with memo=${memo} has been cancelled`);
    }),

    getLotteryParticipants: query([int32], Result(Vec(Principal), Message), (id) => {
        const lotteryOpt = lotteryStorage.get(id);
        if ("None" in lotteryOpt) {
            return Err({ NotFound: `Lottery session with id=${id} not found` });
        }
        const lottery = lotteryOpt.Some;
        const participants = lottery.players.map(player => player.player);
        return Ok(participants);
    }),

});

///////////////////////////// HELPER FUNCTIONS ///////////////////////////////////////////

// To generate a new player information
function generatePlayerInformation(lotteryId: int32, caller: Principal, newPlayerId: int32, ticketNumbers: Vec<int32>): Player {
    return {
        id: newPlayerId,
        lotteryId: lotteryId,
        player: caller,
        tickets: ticketNumbers
    };
}

// Returns the current lottery id
function getCurrentLotteryId(): int32 {
    if ('None' in nextLotteryId) {
        return 0;
    } else {
        return nextLotteryId.Some;
    }
}

// To process payment from this canister to winner.
async function makePayment(winner: Principal, amount: nat64): Promise<Result<text, Message>> {
    const toAddress = hexAddressFromPrincipal(winner, 0);
    const transferFeeResponse = await ic.call(icpLedgerCanister.transfer_fee, { args: [{}] });
    const transferResult = await ic.call(icpLedgerCanister.transfer, {
        args: [{
            memo: 0n,
            amount: {
                e8s: amount - transferFeeResponse.transfer_fee.e8s
            },
            fee: {
                e8s: transferFeeResponse.transfer_fee.e8s
            },
            from_subaccount: None,
            to: binaryAddressFromAddress(toAddress),
            created_at_time: None
        }]
    });
    if ("Err" in transferResult) {
        return Err({ PaymentFailed: `Payment failed, err=${transferResult.Err}` });
    }
    return Ok({ PaymentCompleted: "Payment completed" });
}

/*
    A hash function that is used to generate correlation IDs for orders.
    Also, we use that in the verifyPayment function where we check if the user has actually paid the order
*/
function hash(input: any): nat64 {
    return BigInt(Math.abs(hashCode().value(input)));
}

function generateCorrelationId(lotteryId: int32): nat64 {
    const correlationId = `${lotteryId}_${ic.caller().toText()}_${ic.time()}`;
    return hash(correlationId);
}

/*
    After the order is created, we give the `delay` amount of minutes to pay for the order.
    If it's not paid during this timeframe, the order is automatically removed from the pending orders.
*/
function discardByTimeout(memo: nat64, delay: Duration) {
    ic.setTimer(delay, () => {
        const order = pendingOrders.remove(memo);
        console.log(`Order discarded: ${order}`);
    });
}

async function verifyPaymentInternal(sender: Principal, amount: nat64, block: nat64, memo: nat64): Promise<bool> {
    const blockData = await ic.call(icpLedgerCanister.query_blocks, { args: [{ start: block, length: 1n }] });
    const tx = blockData.blocks.find((block) => {
        if ("None" in block.transaction.operation) {
            return false;
        }
        const operation = block.transaction.operation.Some;
        const senderAddress = binaryAddressFromPrincipal(sender, 0);
        const receiverAddress = binaryAddressFromPrincipal(ic.id(), 0);
        return block.transaction.memo === memo &&
            hash(senderAddress) === hash(operation.Transfer?.from) &&
            hash(receiverAddress) === hash(operation.Transfer?.to) &&
            amount === operation.Transfer?.amount.e8s;
    });
    return tx ? true : false;
}

// A workaround to make uuid package work with Azle
globalThis.crypto = {
    getRandomValues: () => {
        let array = new Uint8Array(32);

        for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 256);
        }

        return array;
    }
};
