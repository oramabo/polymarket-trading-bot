import { Wallet } from "ethers";
import { POLYMARKET_PRIVATE_KEY, PROXY_WALLET_ADDRESS } from "../config/index.js";

export const HOST = "https://clob.polymarket.com";
export const CHAIN_ID = 137;

// Create the base wallet
const wallet = new Wallet(POLYMARKET_PRIVATE_KEY);

// Wrap ethers v6 Wallet so @polymarket/clob-client can use it
// clob-client checks for _signTypedData (ethers v5-style)
export const SIGNER = Object.assign(wallet, {
  _signTypedData: (domain: any, types: any, value: any) =>
    wallet.signTypedData(domain, types, value),
});

// For proxy wallets (Gnosis Safe), FUNDER must be the proxy contract address
// SIGNER is the EOA that signs, FUNDER is the proxy wallet that holds funds
export const FUNDER = PROXY_WALLET_ADDRESS;

export const SIGNATURE_TYPE = 1; // 1 = POLY_PROXY (Polymarket proxy wallet), 2 = POLY_GNOSIS_SAFE


export const getPrices = async (upTokenId: string, downTokenId: string) => {
    const response = await fetch("https://clob.polymarket.com/prices", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify([
            {
                token_id: upTokenId,
                side: "BUY",
            },
            {
                token_id: upTokenId,
                side: "SELL",
            },
            {
                token_id: downTokenId,
                side: "BUY",
            },
            {
                token_id: downTokenId,
                side: "SELL",
            },
        ]),
    });
    const prices = await response.json();
    return prices;
}