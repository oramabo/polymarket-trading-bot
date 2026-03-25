import { ClobClient, Side } from "@polymarket/clob-client";
import { Market } from "../types.js";
import { TxProcess } from "../constant/index.js";

export class Trade {
    usd!: number;
    share!: number;
    holdingStatus!: Market;
    upBuyPrice!: number;
    downBuyPrice!: number;
    upSellPrice!: number;
    downSellPrice!: number;

    prevUpBuyPrice!: [number, number];
    prevDownBuyPrice!: [number, number];
    priceHistory!: number[];

    prevUpTokenBalance!: number;
    prevDownTokenBalance!: number;

    hasBought!: boolean;
    quitMarket!: boolean;
    marketTime!: number;
    remainingTime!: number;

    id!: string;
    amount!: number;
    status!: string;
    upTokenId: string;
    downTokenId: string;

    authorizedClob: ClobClient;
    label: string;
    txProcess: { current: TxProcess };
    buyEntryPrice: number;
    marketSlug: string;
    peakPrice: number;
    entryTime: number;
    tradeCount: number;
    lastPriceTimestamp: number;

    constructor(
        usd: number,
        upTokenId: string,
        downTokenId: string,
        authorizedClob: ClobClient,
        label: string = "",
        minutes?: number
    ) {
        this.usd = usd;
        this.upTokenId = upTokenId;
        this.downTokenId = downTokenId;
        this.label = label;
        this.txProcess = { current: TxProcess.Idle };

        this.share = 0;
        this.holdingStatus = Market.None;
        this.upBuyPrice = 0;
        this.downBuyPrice = 0;
        this.upSellPrice = 0;
        this.downSellPrice = 0;
        this.prevUpBuyPrice = [0, 0];
        this.prevDownBuyPrice = [0, 0];
        this.priceHistory = [];
        this.prevUpTokenBalance = 0;
        this.prevDownTokenBalance = 0;
        this.hasBought = false;
        this.quitMarket = false;
        this.marketTime = (minutes || parseInt(globalThis.__CONFIG__.market.market_period)) * 60;
        this.remainingTime = this.marketTime;
        this.buyEntryPrice = 0;
        this.marketSlug = "";
        this.peakPrice = 0;
        this.entryTime = 0;
        this.tradeCount = 0;
        this.lastPriceTimestamp = Date.now();

        this.authorizedClob = authorizedClob;
    }
}

// Import modules that extend Trade prototype (after class definition)
import { attachDecisionMethods } from "./decision.js";
import { attachPricesMethods } from "./prices.js";
import { attachTradeMethods } from "./trade.js";

attachDecisionMethods(Trade);
attachPricesMethods(Trade);
attachTradeMethods(Trade);
