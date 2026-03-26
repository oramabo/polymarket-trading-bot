import { botState, logTrade, updatePosition } from "./state.js";

const DEMO_COINS = ["BTC", "ETH", "SOL", "XRP"];

interface DemoCoin {
  coin: string;
  price: number;
  direction: number; // 1 = trending up, -1 = trending down
  entryPrice: number;
  side: "UP" | "DOWN" | "NONE";
  shares: number;
  balance: number;
  marketTime: number;
  remaining: number;
  hasBought: boolean;
}

export function startDemoMode() {
  console.log("DEMO MODE: Starting simulated trading (no real trades)");
  botState.botStatus = "running";

  const states: DemoCoin[] = DEMO_COINS.map(coin => ({
    coin,
    price: 0.5,
    direction: Math.random() > 0.5 ? 1 : -1,
    entryPrice: 0,
    side: "NONE" as const,
    shares: 0,
    balance: 50,
    marketTime: coin === "BTC" ? 300 : 900,
    remaining: coin === "BTC" ? 300 : 900,
    hasBought: false,
  }));

  // Simulate price ticks every 1 second
  setInterval(() => {
    for (const s of states) {
      // Random price movement with drift
      const volatility = 0.008 + Math.random() * 0.012;
      const drift = s.direction * 0.002;
      s.price += drift + (Math.random() - 0.48) * volatility;
      s.price = Math.max(0.01, Math.min(0.99, s.price));

      // Occasionally flip direction
      if (Math.random() < 0.02) s.direction *= -1;

      // Accelerate toward end of market
      if (s.remaining < s.marketTime * 0.2) {
        s.price += s.direction * 0.01;
        s.price = Math.max(0.01, Math.min(0.99, s.price));
      }

      s.remaining -= 1;

      // Entry logic: buy after 40% of market, if not already bought
      const timeRatio = (s.marketTime - s.remaining) / s.marketTime;
      if (!s.hasBought && timeRatio > 0.4 && Math.abs(s.price - 0.5) > 0.08) {
        const side = s.price > 0.5 ? "UP" : "DOWN";
        const buyPrice = side === "UP" ? s.price : s.price;
        const amount = Math.min(5, s.balance);
        const shares = amount / buyPrice;

        s.side = side;
        s.entryPrice = buyPrice;
        s.shares = shares;
        s.balance -= amount;
        s.hasBought = true;

        logTrade({
          coin: s.coin, side, action: "BUY", price: buyPrice,
          amount, shares, pnl: 0, reason: "entry (demo)",
          timestamp: Date.now(),
        });

        console.log(`[DEMO] [${s.coin}] BUY ${side} at $${buyPrice.toFixed(3)} — $${amount.toFixed(2)}`);
      }

      // Market end: settle position
      if (s.remaining <= 0) {
        if (s.side !== "NONE" && s.shares > 0) {
          // Resolve: price goes to ~0 or ~1
          const finalPrice = s.direction > 0 ? 0.95 + Math.random() * 0.05 : Math.random() * 0.05;
          const won = (s.side === "UP" && finalPrice > 0.5) || (s.side === "DOWN" && finalPrice < 0.5);
          const payout = won ? s.shares : 0;
          const pnl = payout - (s.shares * s.entryPrice);

          s.balance += payout;

          logTrade({
            coin: s.coin, side: s.side, action: "SETTLE",
            price: finalPrice, amount: payout,
            shares: s.shares, pnl, reason: "market ended (demo)",
            timestamp: Date.now(),
          });

          console.log(`[DEMO] [${s.coin}] SETTLE ${s.side} — ${won ? "WON" : "LOST"} — PnL: $${pnl.toFixed(2)}`);
        }

        // Reset for new market
        s.remaining = s.marketTime;
        s.price = 0.5;
        s.direction = Math.random() > 0.5 ? 1 : -1;
        s.entryPrice = 0;
        s.side = "NONE";
        s.shares = 0;
        s.hasBought = false;
      }

      // Update position for dashboard
      const unrealizedPnl = s.side !== "NONE" && s.entryPrice > 0
        ? (s.price - s.entryPrice) * s.shares
        : 0;
      const signal = Math.abs(s.price - 0.5) * 2 * (timeRatio > 0.3 ? 1 : 0.5);

      updatePosition(s.coin, {
        coin: s.coin,
        side: s.side,
        entryPrice: s.entryPrice,
        currentPrice: s.price,
        shares: s.shares,
        unrealizedPnl,
        signalStrength: Math.min(signal, 1),
        usdBalance: s.balance,
        remainingTime: s.remaining,
        timestamp: Date.now(),
      });
    }
  }, 1000);
}
