
/// values for dummy contract
let id = 0;
let startTime = 0n;
let endTime = 0n;
let noOfTickets = 0;
let winner = [];
let winningTicket = [];
let reward = [];
let players = [];
let lotteryCompleted = 0;

let currlotteryId = [0];
let lotteryState = [0];
let ticketPrice = [0n];
let lotteryDuration = [0n];
let prizePool = [0n];

let lotteryId = 0;
let player = "";
let tickets = [];


export class Lottery {
    constructor(
        id,
        startTime,
        endTime,
        noOfTickets,
        winner,
        winningTicket,
        reward,
        players,
        lotteryCompleted
    ){
        this.id = id;
        this.startTime = startTime;
        this.endTime = endTime;
        this.noOfTickets = noOfTickets;
        this.winner = winner;
        this.reward = reward;
        this.winningTicket = winningTicket;
        this.players = players;
        this.lotteryCompleted = lotteryCompleted;
    }
}

export class LotteryConfig {
    constructor(
        currlotteryId,
        lotteryState,
        ticketPrice,
        lotteryDuration,
        prizePool
    ){
        this.currlotteryId = currlotteryId;
        this.lotteryState = lotteryState;
        this.ticketPrice = ticketPrice;
        this.lotteryDuration = lotteryDuration;
        this.prizePool = prizePool;
    }
}

export class PlayerInfo {
    constructor(
        id,
        lotteryId,
        player,
        tickets
    ){
        this.id = id;
        this.lotteryId = lotteryId;
        this.player = player;
        this.tickets = tickets;
    }
}

export const dummyLottery = new Lottery(
    id,
    startTime,
    endTime,
    noOfTickets,
    winner,
    winningTicket,
    reward,
    players,
    lotteryCompleted
);


export const initLotteryConfig = new LotteryConfig(
    currlotteryId,
    lotteryState,
    ticketPrice,
    lotteryDuration,
    prizePool
)

export const dummyPlayerInfo = new PlayerInfo(
    id,
    lotteryId,
    player,
    tickets
)