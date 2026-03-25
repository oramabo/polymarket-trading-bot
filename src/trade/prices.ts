import { Market } from "../types.js";
import { TxProcess } from "../constant/index.js";

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

        if (this.upBuyPrice !== this.prevUpBuyPrice[1]) {
            this.prevUpBuyPrice = [
                this.prevUpBuyPrice[1],
                this.upBuyPrice,
            ];
        }

        if (this.downBuyPrice !== this.prevDownBuyPrice[1]) {
            this.prevDownBuyPrice = [
                this.prevDownBuyPrice[1],
                this.downBuyPrice,
            ];
        }

        this.upBuyPrice = up_buy_price;
        this.upSellPrice = up_sell_price;
        this.downBuyPrice = down_buy_price;
        this.downSellPrice = down_sell_price;

        this.remainingTime = remaining_time;

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