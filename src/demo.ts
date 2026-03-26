import { botState, logTrade, updatePosition } from "./state.js";
import { generateMarketSlug } from "./config/index.js";
import { getMarket, getPrices } from "./services/index.js";
import { getCurrentTime } from "./utils/index.js";
import { getSignalStrength, getDirection } from "./trade/signals.js";
import type { Coin, Minutes } from "./types.js";

interface DemoCoin {
  coin: string;
  label: string;
  minutes: number;
  entryPrice: number;
  side: "UP" | "DOWN" | "NONE";
  shares: number;
  balance: number;
  hasBought: boolean;
  priceHistory: number[];
}

export function startDemoMode() {
  console.log("DEMO MODE: Using real Polymarket prices, no real trades");
  botState.botStatus = "running";

  const coins: Coin[] = (globalThis.__CONFIG__.market.market_coins || ["btc"]) as Coin[];

  for (const coin of coins) {
    const label = coin.toUpperCase();
    const cfg = globalThis.__CONFIG__.market as any;
    const override = cfg[`${coin}_period`];
    const minutes = override ? parseInt(override) : parseInt(globalThis.__CONFIG__.market.market_period);
    runDemoCoin({ coin, label, minutes, entryPrice: 0, side: "NONE", shares: 0, balance: 50, hasBought: false, priceHistory: [] });
  }
}

async function runDemoCoin(state: DemoCoin) {
  const { label, minutes } = state;

  while (true) {
    const { slug, endTimestamp } = generateMarketSlug(state.coin as Coin, minutes as Minutes);
    console.log(`[DEMO] [${label}] Market: ${slug}`);

    let market;
    try {
      market = await getMarket(slug);
    } catch (e) {
      console.error(`[DEMO] [${label}] Market not found: ${slug}, retrying...`);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    const upTokenId = JSON.parse(market.clobTokenIds)[0];
    const downTokenId = JSON.parse(market.clobTokenIds)[1];
    state.hasBought = false;
    state.side = "NONE";
    state.entryPrice = 0;
    state.shares = 0;
    state.priceHistory = [];

    while (true) {
      try {
        const prices = await getPrices(upTokenId, downTokenId);
        const upBuy = Number(prices[upTokenId]?.BUY) || 0;
        const downBuy = Number(prices[downTokenId]?.BUY) || 0;
        const remaining = endTimestamp - getCurrentTime();

        // Track price history
        state.priceHistory.push(upBuy);
        if (state.priceHistory.length > 30) state.priceHistory.shift();

        const timeRatio = (minutes * 60 - remaining) / (minutes * 60);

        // Simulate entry logic (same as real bot)
        if (!state.hasBought && state.priceHistory.length >= 5) {
          const cfg = globalThis.__CONFIG__.trade_2;
          const signal = getSignalStrength(state.priceHistory, timeRatio);
          const direction = getDirection(state.priceHistory);
          const upPriceRatio = Math.abs(upBuy - 0.5) / 0.5;
          const [entryMin, entryMax] = cfg.entry_price_ratio;
          const maxEntry = cfg.max_entry_time_ratio ?? 0.85;

          if (timeRatio >= cfg.entry_time_ratio && timeRatio <= maxEntry
            && signal >= (cfg.min_signal_strength ?? 0.5)
            && direction !== "NONE"
            && upPriceRatio >= entryMin && upPriceRatio <= entryMax) {

            const amount = globalThis.__CONFIG__.trade_usd;
            const buyPrice = direction === "UP" ? upBuy : downBuy;
            state.side = direction;
            state.entryPrice = buyPrice;
            state.shares = amount / buyPrice;
            state.balance -= amount;
            state.hasBought = true;

            logTrade({
              coin: label, side: direction, action: "BUY", price: buyPrice,
              amount, shares: state.shares, pnl: 0, reason: "entry (demo)",
              timestamp: Date.now(),
            });
            console.log(`[DEMO] [${label}] BUY ${direction} at $${buyPrice.toFixed(3)} — $${amount}`);
          }
        }

        // Update position for dashboard
        const currentPrice = state.side === "DOWN" ? downBuy : upBuy;
        const unrealizedPnl = state.side !== "NONE" && state.entryPrice > 0
          ? (currentPrice - state.entryPrice) * state.shares : 0;
        const signal = state.priceHistory.length >= 5
          ? getSignalStrength(state.priceHistory, timeRatio) : 0;

        updatePosition(label, {
          coin: label, side: state.side, entryPrice: state.entryPrice,
          currentPrice: upBuy, shares: state.shares, unrealizedPnl,
          signalStrength: signal, usdBalance: state.balance, remainingTime: remaining,
          timestamp: Date.now(),
        });

      } catch (e) {
        console.error(`[DEMO] [${label}]`, e);
      }

      await new Promise(r => setTimeout(r, 1000));

      if (endTimestamp - getCurrentTime() <= 0) {
        // Settle position
        if (state.side !== "NONE" && state.shares > 0) {
          // Fetch final price
          try {
            const prices = await getPrices(upTokenId, downTokenId);
            const finalUp = Number(prices[upTokenId]?.BUY) || 0;
            const finalDown = Number(prices[downTokenId]?.BUY) || 0;
            const finalPrice = state.side === "UP" ? finalUp : finalDown;
            const won = finalPrice > 0.5;
            const payout = won ? state.shares * 1.0 : 0;
            const pnl = payout - (state.shares * state.entryPrice);
            state.balance += payout;

            logTrade({
              coin: label, side: state.side, action: "SETTLE",
              price: finalPrice, amount: payout, shares: state.shares,
              pnl, reason: won ? "won (demo)" : "lost (demo)",
              timestamp: Date.now(),
            });
            console.log(`[DEMO] [${label}] SETTLE ${state.side} — ${won ? "WON" : "LOST"} — PnL: $${pnl.toFixed(2)}`);
          } catch (e) {
            console.error(`[DEMO] [${label}] Settlement error:`, e);
          }
        }
        break;
      }
    }
  }
}
