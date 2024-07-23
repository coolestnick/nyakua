import { transferICP } from "./ledger";

export async function startLottery(){
    return window.canister.lottery.startLottery()
}

export async function getLotteries(){
    try {
        return await window.canister.lottery.getLotteries();
    } catch (err) {
        if (err.name === "AgentHTTPResponseError") {
            const authClient = window.auth.client;
            await authClient.logout();
          }
          return [];
    }
}

export async function getLotteryConfiguration() {
    try{
        return await window.canister.lottery.getLotteryConfiguration();
    } catch (err) {
        if (err.name === "AgentHTTPResponseError") {
            const authClient = window.auth.client;
            await authClient.logout();
        }
        return {};
    }
}

export async function buyTickets(ticketPayload) {
    const lotteryCanister = window.canister.lottery;
    const orderResponse = await lotteryCanister.createTicketOrder(ticketPayload);
    if(orderResponse.Err){
        throw new Error(orderResponse.Err);
    }
    const canisterAddress = await lotteryCanister.getCanisterAddress();
    const block = await transferICP(canisterAddress, orderResponse.Ok.amount, orderResponse.Ok.memo);
    await lotteryCanister.registerTickets(
        ticketPayload.lotteryId, 
        ticketPayload.noOfTickets, 
        orderResponse.Ok.amount, 
        block, 
        orderResponse.Ok.memo
    );

}

export async function endLottery(id){
    return window.canister.lottery.endLottery(id);
}


export async function checkIfWinner(id){
    return window.canister.lottery.checkIfWinner(id);
}

export function checkStatus(status, endTime) {
    const now = new Date();
    const end = new Date((endTime / 1000000n).toString());
  
    if (status === 1 && endTime !== 0 && now > end) {
      return "TIME EXHAUSTED";
    } else {
      switch (status) {
        case 0: {
          return "START LOTTERY";
        }
        case 1: {
          return "LOTTERY IS ACTIVE";
        }
        case 2: {
          return "LOTTERY ENDED, CLAIM TO CHECK IF YOU WON";
        }
        case 3: {
          return "WINNERS AWARDED";
        }
      }
    }
  }