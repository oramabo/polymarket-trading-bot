import { AssetType, OrderType, Side } from "@polymarket/clob-client";
import { Market } from "../types.js";
import { TxProcess } from "../constant/index.js";
import { retryWithInstantRetry } from "../utils/retry.js";
import { notifyBuy, notifySell } from "../services/telegram.js";
import { logTrade } from "../state.js";

declare module "./index.js" {
    interface Trade {
        make_trading_decision(): void;
        buyUpToken(): Promise<void>;
        buyDownToken(): Promise<void>;
        sellUpToken(): Promise<boolean>;
        sellDownToken(): Promise<boolean>;
        updateTokenBalances(): Promise<void>;
        waitForBalance(tokenType: "up" | "down", timeoutMs?: number): Promise<void>;
    }
}

// Function to attach methods to Trade class (called from index.ts)
export function attachTradeMethods(TradeClass: new (...args: any[]) => any) {
    // Method to check token balances and update state
    TradeClass.prototype.updateTokenBalances = async function (): Promise<void> {
        try {
            // Check up token balance
            const upBalance = await this.authorizedClob.getBalanceAllowance({
                asset_type: AssetType.CONDITIONAL,
                token_id: this.upTokenId,
            });

            // Check down token balance
            const downBalance = await this.authorizedClob.getBalanceAllowance({
                asset_type: AssetType.CONDITIONAL,
                token_id: this.downTokenId,
            });

            // Check USD (COLLATERAL) balance
            const usdBalance = await this.authorizedClob.getBalanceAllowance({
                asset_type: AssetType.COLLATERAL,
            });
            
            console.log("upBalance", upBalance);
            console.log("downBalance", downBalance);
            console.log("usdBalance", usdBalance);

            // Update balances (convert from string to number, balance is in wei, divide by 1e6 for USD)
            const upBalanceNum = parseFloat(upBalance.balance) / 1e6;
            const downBalanceNum = parseFloat(downBalance.balance) / 1e6;
            const usdBalanceNum = parseFloat(usdBalance.balance) / 1e6;

            // Update state based on balances
            if (upBalanceNum > 0) {
                this.share = upBalanceNum;
                this.holdingStatus = Market.Up;
                this.usd = usdBalanceNum;
            } else if (downBalanceNum > 0) {
                this.share = downBalanceNum;
                this.holdingStatus = Market.Down;
                this.usd = usdBalanceNum;
            } else {
                this.share = 0;
                this.holdingStatus = Market.None;
                this.usd = usdBalanceNum;
            }

            console.log(`📊 Balance updated | Up: ${upBalanceNum.toFixed(4)} | Down: ${downBalanceNum.toFixed(4)} | USD: $${usdBalanceNum.toFixed(2)}`);
        } catch (error: any) {
            console.error("❌ Error updating token balances:", error);
        }
    };

    // Method to poll balance every 1 second until balance is received
    TradeClass.prototype.waitForBalance = async function (tokenType: "up" | "down", timeoutMs: number = 60000): Promise<void> {
        const startTime = Date.now();
        const pollInterval = 1000; // 1 second
        
        console.log(`⏳ Waiting for ${tokenType} token balance...`);
        
        while (Date.now() - startTime < timeoutMs) {
            try {
                await this.updateTokenBalances();
                
                const hasBalance = tokenType === "up" 
                    ? (this.holdingStatus === Market.Up && this.share > 0)
                    : (this.holdingStatus === Market.Down && this.share > 0);
                
                if (hasBalance) {
                    console.log(`✅ ${tokenType.toUpperCase()} token balance received!`);
                    return;
                }
                
                // Wait 1 second before next check
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            } catch (error: any) {
                console.error(`❌ Error while waiting for balance:`, error);
                // Continue polling even if one check fails
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }
        
        throw new Error(`⏱️  Timeout: ${tokenType} token balance not received within ${timeoutMs / 1000} seconds`);
    };

    TradeClass.prototype.buyUpToken = async function (overrideAmount?: number): Promise<void> {
        // Check re-entry rules
        const cfg2 = globalThis.__CONFIG__.trade_2;
        if (this.hasBought && !(cfg2.allow_reentry && this.tradeCount < cfg2.max_reentries)) {
            console.log("⏭️  Already bought in this market, skipping");
            return;
        }

        if (!this.upTokenId || !this.upBuyPrice || this.upBuyPrice <= 0 || isNaN(this.upBuyPrice)) {
            console.error("Cannot buy up token: missing tokenId or invalid price");
            return;
        }

        // Calculate size based on override, config, or balance
        const tradeAmount = overrideAmount || globalThis.__CONFIG__.trade_usd || this.usd;

        if (!tradeAmount || isNaN(tradeAmount) || tradeAmount <= 0) {
            console.error("Cannot buy up token: invalid trade amount");
            return;
        }

        const roundedTradeAmount = Math.round(tradeAmount * 100) / 100;
        const size = Math.floor(roundedTradeAmount / this.upBuyPrice);

        if (size <= 0 || isNaN(size) || !isFinite(size)) {
            console.error("Cannot buy up token: insufficient funds or invalid size");
            return;
        }

        // Ensure price is a valid number
        const price = Number(this.upBuyPrice);
        if (isNaN(price) || !isFinite(price) || price <= 0) {
            console.error("Cannot buy up token: invalid price value");
            return;
        }

        try {
            this.txProcess.current = TxProcess.Working;
            
            const maxRetries = globalThis.__CONFIG__?.max_retries || 3;
            
            // For BUY orders, amount should be in USD, not token size
            // Use FAK (Fill and Kill) instead of FOK to allow partial fills
            const order = await retryWithInstantRetry(
                async () => {
                    const result = await this.authorizedClob.createAndPostMarketOrder({
                        tokenID: this.upTokenId,
                        amount: roundedTradeAmount, // USD amount to buy (rounded to 2 decimals)
                        price: price, // Optional: specify price, otherwise uses market price
                        side: Side.BUY,
                    }, undefined, OrderType.FAK); // FAK allows partial fills, FOK requires full fill

                    if (!result.success) {
                        console.error("❌ Full API response:", JSON.stringify(result));
                        throw new Error("❌ Error buying up token: " + result.error);
                    }

                    return result;
                },
                maxRetries,
                "Buy Up Token"
            );

            console.log("✅ Order posted successfully:", order);

            // Mark as bought
            this.hasBought = true;
            this.buyEntryPrice = price;
            this.entryTime = Date.now();
            this.tradeCount++;
            this.peakPrice = price;

            logTrade({ coin: this.label, side: "UP", action: "BUY", price, amount: roundedTradeAmount, shares: roundedTradeAmount / price, pnl: 0, reason: "entry", timestamp: Date.now() });
            await notifyBuy(this.label, "UP", roundedTradeAmount, price, this.marketSlug);
            await this.waitForBalance("up");
        } catch (error: any) {
            console.error("❌ Error buying up token:", error?.message || error);
            if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                console.error("⚠️  API authentication failed. Please check your API_KEY, SECRET_KEY, and PASSPHASE in your .env file.");
            }
        } finally {
            this.txProcess.current = TxProcess.Idle;
        }
    };

    TradeClass.prototype.buyDownToken = async function (overrideAmount?: number): Promise<void> {
        // Check re-entry rules
        const cfg2 = globalThis.__CONFIG__.trade_2;
        if (this.hasBought && !(cfg2.allow_reentry && this.tradeCount < cfg2.max_reentries)) {
            console.log("⏭️  Already bought in this market, skipping");
            return;
        }

        if (!this.downTokenId || !this.downBuyPrice || this.downBuyPrice <= 0 || isNaN(this.downBuyPrice)) {
            console.error("Cannot buy down token: missing tokenId or invalid price");
            return;
        }

        const tradeAmount = overrideAmount || globalThis.__CONFIG__.trade_usd || this.usd;

        if (!tradeAmount || isNaN(tradeAmount) || tradeAmount <= 0) {
            console.error("Cannot buy down token: invalid trade amount");
            return;
        }

        const roundedTradeAmount = Math.round(tradeAmount * 100) / 100;
        const size = Math.floor(roundedTradeAmount / this.downBuyPrice);

        if (size <= 0 || isNaN(size) || !isFinite(size)) {
            console.error("Cannot buy down token: insufficient funds or invalid size");
            return;
        }

        // Ensure price is a valid number
        const price = Number(this.downBuyPrice);
        if (isNaN(price) || !isFinite(price) || price <= 0) {
            console.error("Cannot buy down token: invalid price value");
            return;
        }

        console.log("buying down token", { tokenID: this.downTokenId, price: price, size });
        try {
            this.txProcess.current = TxProcess.Working;
            
            const maxRetries = globalThis.__CONFIG__?.max_retries || 3;
            
            // For BUY orders, amount should be in USD, not token size
            // Use FAK (Fill and Kill) instead of FOK to allow partial fills
            const order = await retryWithInstantRetry(
                async () => {
                    const result = await this.authorizedClob.createAndPostMarketOrder({
                        tokenID: this.downTokenId,
                        amount: roundedTradeAmount, // USD amount to buy (rounded to 2 decimals)
                        price: price, // Optional: specify price, otherwise uses market price
                        side: Side.BUY,
                    }, undefined, OrderType.FAK); // FAK allows partial fills, FOK requires full fill

                    if (!result.success) {
                        console.error("❌ Full API response:", JSON.stringify(result));
                        throw new Error("❌ Error buying down token: " + result.error);
                    }

                    return result;
                },
                maxRetries,
                "Buy Down Token"
            );

            console.log("✅ Order posted successfully:", order);

            // Mark as bought
            this.hasBought = true;
            this.buyEntryPrice = price;
            this.entryTime = Date.now();
            this.tradeCount++;
            this.peakPrice = price;

            logTrade({ coin: this.label, side: "DOWN", action: "BUY", price, amount: roundedTradeAmount, shares: roundedTradeAmount / price, pnl: 0, reason: "entry", timestamp: Date.now() });
            await notifyBuy(this.label, "DOWN", roundedTradeAmount, price, this.marketSlug);
            await this.waitForBalance("down");
        } catch (error: any) {
            console.error("❌ Error buying down token:", error?.message || error);
            if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                console.error("⚠️  API authentication failed. Please check your API_KEY, SECRET_KEY, and PASSPHASE in your .env file.");
            }
        } finally {
            this.txProcess.current = TxProcess.Idle;
        }
    };

    TradeClass.prototype.sellUpToken = async function (sellReason: string = "exit"): Promise<boolean> {
        if (!this.upTokenId || !this.upSellPrice || this.upSellPrice <= 0 || isNaN(this.upSellPrice)) {
            console.error("Cannot sell up token: missing tokenId or invalid price");
            return false;
        }

        // Skip selling dust amounts (less than $0.10 worth)
        if (this.share < 0.1) {
            console.log("⏭️  Skipping sell: dust amount (< 0.1 shares)");
            this.holdingStatus = Market.None;
            this.share = 0;
            return true;
        }

        // Refresh balance from API before selling to get accurate balance
        await this.updateTokenBalances();

        // Verify we're still holding up token after balance refresh
        if (this.holdingStatus !== Market.Up || this.share <= 0) {
            console.error("Cannot sell up token: no shares available or not holding up token");
            return false;
        }

        // Get the actual balance from API to ensure we have the exact amount
        const upBalance = await this.authorizedClob.getBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: this.upTokenId,
        });

        // Convert balance from micro-units to token count (divide by 1e6)
        const actualBalance = parseFloat(upBalance.balance) / 1e6;

        if (actualBalance <= 0 || isNaN(actualBalance) || !isFinite(actualBalance)) {
            console.error("Cannot sell up token: invalid balance from API");
            return false;
        }

        // Use human-readable token count for the amount parameter
        const size = actualBalance;

        // Ensure price is a valid number
        const price = Number(this.upSellPrice);
        if (isNaN(price) || !isFinite(price) || price <= 0) {
            console.error("Cannot sell up token: invalid price value");
            return false;
        }

        console.log("selling up token", {
            tokenID: this.upTokenId,
            price: price,
            size,
            share: this.share
        });
        try {
            this.txProcess.current = TxProcess.Working;
            
            const maxRetries = globalThis.__CONFIG__?.max_retries || 3;
            
            // Use FAK (Fill and Kill) instead of FOK to allow partial fills
            const order = await retryWithInstantRetry(
                async () => {
                    const result = await this.authorizedClob.createAndPostMarketOrder({
                        tokenID: this.upTokenId,
                        amount: size,
                        side: Side.SELL,
                    }, undefined, OrderType.FAK); // FAK allows partial fills, FOK requires full fill

                    if (!result.success) {
                        throw new Error("❌ Error selling up token: " + result.error);
                    }

                    return result;
                },
                maxRetries,
                "Sell Up Token"
            );

            console.log("✅ Order posted successfully:", order);

            const pnl = (price - this.buyEntryPrice) * size;
            logTrade({ coin: this.label, side: "UP", action: "SELL", price, amount: size * price, shares: size, pnl, reason: sellReason, timestamp: Date.now() });
            await notifySell(this.label, "UP", size, price, this.buyEntryPrice, this.marketSlug);

            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.updateTokenBalances();

            if (this.holdingStatus === Market.Up && this.share > 0) {
                console.warn("⚠️  Sell order posted but tokens still held.");
                return true;
            }

            // Reset for potential re-entry
            this.peakPrice = 0;
            const cfg2 = globalThis.__CONFIG__.trade_2;
            if (cfg2.allow_reentry) {
                this.hasBought = false;
            }

            console.log("✅ Sell confirmed: tokens successfully sold");
            return true;
        } catch (error: any) {
            console.error("❌ Error selling up token:", error);
            if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                console.error("⚠️  API authentication failed. Please check your API_KEY, SECRET_KEY, and PASSPHASE in your .env file.");
            }
            return false;
        } finally {
            this.txProcess.current = TxProcess.Idle;
        }
    };

    TradeClass.prototype.sellDownToken = async function (sellReason: string = "exit"): Promise<boolean> {
        if (!this.downTokenId || !this.downSellPrice || this.downSellPrice <= 0 || isNaN(this.downSellPrice)) {
            console.error("Cannot sell down token: missing tokenId or invalid price");
            return false;
        }

        // Skip selling dust amounts (less than $0.10 worth)
        if (this.share < 0.1) {
            console.log("⏭️  Skipping sell: dust amount (< 0.1 shares)");
            this.holdingStatus = Market.None;
            this.share = 0;
            return true;
        }

        // Refresh balance from API before selling to get accurate balance
        await this.updateTokenBalances();

        // Verify we're still holding down token after balance refresh
        if (this.holdingStatus !== Market.Down || this.share <= 0) {
            console.error("Cannot sell down token: no shares available or not holding down token");
            return false;
        }

        // Get the actual balance from API to ensure we have the exact amount
        const downBalance = await this.authorizedClob.getBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: this.downTokenId,
        });

        // Convert balance from micro-units to token count (divide by 1e6)
        const actualBalance = parseFloat(downBalance.balance) / 1e6;

        if (actualBalance <= 0 || isNaN(actualBalance) || !isFinite(actualBalance)) {
            console.error("Cannot sell down token: invalid balance from API");
            return false;
        }

        // Use human-readable token count for the amount parameter
        const size = actualBalance;

        // Ensure price is a valid number
        const price = Number(this.downSellPrice);
        if (isNaN(price) || !isFinite(price) || price <= 0) {
            console.error("Cannot sell down token: invalid price value");
            return false;
        }

        console.log("selling down token", {
            tokenID: this.downTokenId,
            price: price,
            size,
            share: this.share
        });
        try {
            this.txProcess.current = TxProcess.Working;
            
            const maxRetries = globalThis.__CONFIG__?.max_retries || 3;
            
            // Use FAK (Fill and Kill) instead of FOK to allow partial fills
            const order = await retryWithInstantRetry(
                async () => {
                    const result = await this.authorizedClob.createAndPostMarketOrder({
                        tokenID: this.downTokenId,
                        amount: size,
                        side: Side.SELL,
                    }, undefined, OrderType.FAK); // FAK allows partial fills, FOK requires full fill

                    if (!result.success) {
                        throw new Error("❌ Error selling down token: " + result.error);
                    }

                    return result;
                },
                maxRetries,
                "Sell Down Token"
            );

            console.log("✅ Order posted successfully:", order);

            const pnl = (price - this.buyEntryPrice) * size;
            logTrade({ coin: this.label, side: "DOWN", action: "SELL", price, amount: size * price, shares: size, pnl, reason: sellReason, timestamp: Date.now() });
            await notifySell(this.label, "DOWN", size, price, this.buyEntryPrice, this.marketSlug);

            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.updateTokenBalances();

            if (this.holdingStatus === Market.Down && this.share > 0) {
                console.warn("⚠️  Sell order posted but tokens still held.");
                return true;
            }

            this.peakPrice = 0;
            const cfg2 = globalThis.__CONFIG__.trade_2;
            if (cfg2.allow_reentry) {
                this.hasBought = false;
            }

            console.log("✅ Sell confirmed: tokens successfully sold");
            return true;
        } catch (error: any) {
            console.error("❌ Error selling down token:", error);
            if (error?.status === 401 || error?.data?.error?.includes("Unauthorized")) {
                console.error("⚠️  API authentication failed. Please check your API_KEY, SECRET_KEY, and PASSPHASE in your .env file.");
            }
            return false;
        } finally {
            this.txProcess.current = TxProcess.Idle;
        }
    };
}