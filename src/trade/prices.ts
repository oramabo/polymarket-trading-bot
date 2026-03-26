import { Market } from "../types.js";
import { TxProcess } from "../constant/index.js";
import { botState, updatePosition } from "../state.js";
import { getSignalStrength } from "./signals.js";

const MAX_PRICE_HISTORY = 30;

declare module "./index.js" {
    interface Trade {
        shareInUsd(): number;
        totalValue(): number;
        displayBalance(): void;
        updatePrices(
            remaining_time: number,
            up_buy_price: number,
            up_sell_price: number,
            down_buy_price: number,
            down_sell_price: number
        ): void;
        trending(): Market;
    }
}

// Function to attach methods to Trade class (called from index.ts)
export function attachPricesMethods(TradeClass: new (...args: any[]) => any) {
    TradeClass.prototype.shareInUsd = function (): number {
        if (this.holdingStatus === Market.Up) {
            return this.share * this.upSellPrice;
        }
        if (this.holdingStatus === Market.Down) {
            return this.share * this.downSellPrice;
        }
        return 0;
    };

    TradeClass.prototype.totalValue = function (): number {
        return this.usd + this.shareInUsd();
    };

    TradeClass.prototype.displayBalance = function (): void {
        const shareValue = this.shareInUsd();
        const totalValue = this.totalValue();

        const holdingStr =
            this.holdingStatus === Market.Up
                ? "🟩"
                : this.holdingStatus === Market.Down
                    ? "🟥"
                    : "⬛";

        const trend =
            this.trending() === Market.Up
                ? "🟢"
                : this.trending() === Market.Down
                    ? "🔴"
                    : "⚫";

        const label = this.label ? `[${this.label}] ` : "";
        console.log(
            `${label}💰 Balance | USD: $${this.usd.toFixed(2)} | Shares: ${this.share.toFixed(
                2
            )} (${holdingStr} ) | Share Value: $${shareValue.toFixed(
                2
            )} | Total: $${totalValue.toFixed(2)} | ${this.txProcess.current === TxProcess.Working ? "Working" : "Idle"}, Trend: ${trend}`
        );
    };

    TradeClass.prototype.updatePrices = function (
        remaining_time: number,
        up_buy_price: number,
        up_sell_price: number,
        down_buy_price: number,
        down_sell_price: number
    ): void {
        const remainingTimeRatio =
            (this.marketTime - remaining_time) / this.marketTime;

        const upPriceRatio = Math.abs(up_buy_price - 0.5) / 0.5;

        const lbl = this.label ? `[${this.label}] ` : "";
        console.log(
            `${lbl}BUY | ${remaining_time} / ${this.marketTime} | ↑ (${this.prevUpBuyPrice[0]}, ${this.prevUpBuyPrice[1]}) ${up_buy_price} ↓ (${this.prevDownBuyPrice[0]}, ${this.prevDownBuyPrice[1]}) ${down_buy_price} | TIME RATIO ${remainingTimeRatio.toFixed(
                2
            )} | UP PRICE RATIO ${upPriceRatio.toFixed(2)} | PRODUCT ${(
                remainingTimeRatio * upPriceRatio
            ).toFixed(2)}`
        );

        // Update legacy prev price tracking
        if (this.upBuyPrice !== this.prevUpBuyPrice[1]) {
            this.prevUpBuyPrice = [this.prevUpBuyPrice[1], this.upBuyPrice];
        }
        if (this.downBuyPrice !== this.prevDownBuyPrice[1]) {
            this.prevDownBuyPrice = [this.prevDownBuyPrice[1], this.downBuyPrice];
        }

        // Update current prices
        this.upBuyPrice = up_buy_price;
        this.upSellPrice = up_sell_price;
        this.downBuyPrice = down_buy_price;
        this.downSellPrice = down_sell_price;
        this.remainingTime = remaining_time;

        // Deep price history (30 ticks)
        this.priceHistory.push(up_buy_price);
        if (this.priceHistory.length > MAX_PRICE_HISTORY) {
            this.priceHistory.shift();
        }
        this.lastPriceTimestamp = Date.now();
        botState.lastPriceUpdate.set(this.label, Date.now());

        // Track peak price for trailing stop
        if (this.holdingStatus === Market.Up) {
            this.peakPrice = Math.max(this.peakPrice, up_buy_price);
        } else if (this.holdingStatus === Market.Down) {
            this.peakPrice = Math.max(this.peakPrice, down_buy_price);
        }

        // Update shared state for dashboard
        const unrealizedPnl = this.holdingStatus !== Market.None && this.buyEntryPrice > 0
            ? ((this.holdingStatus === Market.Up ? up_buy_price : down_buy_price) - this.buyEntryPrice) * this.share
            : 0;
        const signal = this.priceHistory.length >= 5
            ? getSignalStrength(this.priceHistory, remainingTimeRatio)
            : 0;
        updatePosition(this.label, {
            coin: this.label,
            side: this.holdingStatus === Market.Up ? "UP" : this.holdingStatus === Market.Down ? "DOWN" : "NONE",
            entryPrice: this.buyEntryPrice,
            currentPrice: up_buy_price,
            shares: this.share,
            unrealizedPnl,
            signalStrength: signal,
            usdBalance: this.usd,
            remainingTime: remaining_time,
            timestamp: Date.now(),
        });

        this.displayBalance();
    };

    TradeClass.prototype.trending = function (): Market {
        const threshold =
            Math.abs(0.5 - this.upBuyPrice) > 0.35 ? 0.02 : 0.03;

        const p0 =
            Math.floor(this.prevUpBuyPrice[0] / threshold) * threshold;
        const p1 =
            Math.floor(this.prevUpBuyPrice[1] / threshold) * threshold;
        const p =
            Math.floor(this.upBuyPrice / threshold) * threshold;

        if (Math.max(p0, p1) < p) return Market.Up;
        if (Math.min(p0, p1) > p) return Market.Down;
        return Market.None;
    };
}
