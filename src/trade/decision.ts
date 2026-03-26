import { TxProcess } from "../constant/index.js";
import { Market } from "../types.js";
import { getSignalStrength, getDirection, scalePosition } from "./signals.js";

// Declare module augmentation to add cancel method to Trade class
declare module "./index.js" {
    interface Trade {
        make_trading_decision(): void;
    }
}

// Function to attach methods to Trade class (called from index.ts)
export function attachDecisionMethods(TradeClass: new (...args: any[]) => any) {
    TradeClass.prototype.make_trading_decision = async function (): Promise<void> {

        const remaining_time_ratio =
            (this.marketTime - this.remainingTime) / this.marketTime;

        const up_price_ratio = Math.abs(this.upBuyPrice - 0.5) / 0.5;

        if (this.txProcess.current === TxProcess.Working) {
            console.log(`[${this.label}] Trading is already in progress`);
            return;
        }

        switch (globalThis.__CONFIG__.strategy) {
            case "trade_1": {
                const exitTime = remaining_time_ratio > globalThis.__CONFIG__.trade_1.exit_time_ratio;
                const exitPrice = up_price_ratio > globalThis.__CONFIG__.trade_1.exit_price_ratio;
                if (exitTime || exitPrice) {
                    switch (this.holdingStatus) {
                        case Market.Up:
                            await this.sellUpToken("time/price exit");
                            break;
                        case Market.Down:
                            await this.sellDownToken("time/price exit");
                            break;
                        default:
                            break;
                    }
                }
                break;
            }

            case "trade_2": {
                const cfg = globalThis.__CONFIG__.trade_2;
                const tooLateToSell = remaining_time_ratio > 0.9 && this.remainingTime < 30;

                // ========= EXIT LOGIC (when holding a position) =========
                if (this.holdingStatus === Market.Up || this.holdingStatus === Market.Down) {
                    // Skip ALL exit logic if params are at 1.0 (disabled)
                    if (cfg.trailing_stop_pct >= 1.0 && cfg.stop_loss_pct >= 1.0 && cfg.take_profit_ratio >= 1.0) {
                        break; // hold to resolution, never sell
                    }

                    const isHoldingUp = this.holdingStatus === Market.Up;
                    const currentFavorablePrice = isHoldingUp ? this.upBuyPrice : this.downBuyPrice;

                    // Calculate unrealized PnL percentage
                    const unrealizedPnlPct = this.buyEntryPrice > 0
                        ? (currentFavorablePrice - this.buyEntryPrice) / this.buyEntryPrice
                        : 0;

                    // 1. Trailing stop: price dropped from peak
                    if (this.peakPrice > 0 && !tooLateToSell) {
                        const dropFromPeak = (this.peakPrice - currentFavorablePrice) / this.peakPrice;
                        if (dropFromPeak > cfg.trailing_stop_pct && unrealizedPnlPct > 0) {
                            console.log(`[${this.label}] Trailing stop triggered: ${(dropFromPeak * 100).toFixed(1)}% drop from peak`);
                            if (isHoldingUp) await this.sellUpToken("trailing stop");
                            else await this.sellDownToken("trailing stop");
                            break;
                        }
                    }

                    // 2. Stop-loss: cut losses
                    if (unrealizedPnlPct < -cfg.stop_loss_pct && !tooLateToSell) {
                        console.log(`[${this.label}] Stop-loss triggered: ${(unrealizedPnlPct * 100).toFixed(1)}% loss`);
                        if (isHoldingUp) await this.sellUpToken("stop loss");
                        else await this.sellDownToken("stop loss");
                        break;
                    }

                    // 3. Take-profit: price ratio very favorable
                    if (up_price_ratio >= cfg.take_profit_ratio && !tooLateToSell) {
                        console.log(`[${this.label}] Take-profit triggered: price ratio ${up_price_ratio.toFixed(2)}`);
                        if (isHoldingUp) await this.sellUpToken("take profit");
                        else await this.sellDownToken("take profit");
                        break;
                    }

                    // 4. Legacy exit ranges (kept for backward compat)
                    const exitRanges = cfg.exit_price_ratio_range;
                    const inExitRange = exitRanges.some(([min, max]: [number, number]) => up_price_ratio >= min && up_price_ratio <= max);
                    if (inExitRange && !tooLateToSell) {
                        if (isHoldingUp) await this.sellUpToken("exit range");
                        else await this.sellDownToken("exit range");
                        break;
                    }

                    break; // holding but no exit condition met
                }

                // ========= ENTRY LOGIC (when not holding) =========
                const canEnter = !this.hasBought || (cfg.allow_reentry && this.tradeCount < cfg.max_reentries);
                if (!canEnter) break;

                // Minimum balance check — stop trading to protect profits
                const minBal = globalThis.__CONFIG__.min_balance || 0;
                if (minBal > 0 && this.usd > 0 && this.usd < minBal) {
                    console.log(`[${this.label}] Balance $${this.usd.toFixed(2)} below minimum $${minBal}. Skipping trade to protect profits.`);
                    break;
                }

                // Need enough price history for signals
                if (this.priceHistory.length < 5) break;

                // Time window check
                const maxEntry = cfg.max_entry_time_ratio ?? 0.85;
                if (remaining_time_ratio < cfg.entry_time_ratio || remaining_time_ratio > maxEntry) break;

                // Signal strength check
                const signal = getSignalStrength(this.priceHistory, remaining_time_ratio);
                const minSignal = cfg.min_signal_strength ?? 0.3;
                if (signal < minSignal) break;

                // Direction check
                const direction = getDirection(this.priceHistory);
                if (direction === "NONE") break;

                // Price ratio must be in entry range
                const [entryMin, entryMax] = cfg.entry_price_ratio;
                if (up_price_ratio < entryMin || up_price_ratio > entryMax) break;

                // Position sizing
                const tradeAmount = scalePosition(
                    globalThis.__CONFIG__.trade_usd,
                    signal,
                    cfg.position_scale ?? true
                );

                console.log(`[${this.label}] Entry signal: ${direction} | strength: ${signal.toFixed(2)} | amount: $${tradeAmount.toFixed(2)}`);

                if (direction === "UP") {
                    await this.buyUpToken(tradeAmount);
                } else {
                    await this.buyDownToken(tradeAmount);
                }
                break;
            }

            default:
                break;
        }
    };
}
