# Nyakua

A basic lottery system built on the ICP network.

The system allows any player to `start`, `buy tickets` for, and `end the lottery`. After the lottery ends, players can `check to see if they have won`. The `winner receives half of the prize pool`.

## Deploying canisters

- Start Internet Computer Locally

    ```bash
    dfx start --background --clean
    ```

- Deploy Ledger Canister

    ```bash
    npm run deploy:ledger
    ```

- Deploy the Internet ID Canister

    ```bash
    dfx deploy internet_identity
    ```

- Deploy the Lottery Backend Canister

    ```bash
    # ticket price is entered in e8s
    # lottery duration is entered in minutes for testing purposes
    
    dfx deploy dfinity_js_backend --argument '(record {ticketPrice = 100000000; lotteryDuration = 10})'
    ```

- Deploy the Frontend Canister

    ```bash
    dfx deploy dfinity_js_frontend
    ```

## Funding Wallet

This next step shows how to fund your wallet with the tokens from the newly deployed Ledger canister.

- Copy your wallet ledger identifier from the frontend of lottery. This can be found in the wallet icon.
- Run the faucet script

    ```bash
    # npm run get:tokens <amount in e8s> <amount> <wallet address>
    npm run get:tokens 5_0000_0000 123525952y5y2835y235788238527358235823857
    
    # N/B: This sends 5 ICP tokens to the address.
    ```
