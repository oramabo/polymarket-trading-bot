import { ClobClient, Side } from "@polymarket/clob-client";
import { generateMarketSlug } from "./config/index.js";
import type { Coin, MarketConfig, Minutes } from "./types.js";
import { CHAIN_ID, FUNDER, getEvent, getMarket, getPrices, HOST, SIGNATURE_TYPE, SIGNER } from "./services/index.js";
import { getCurrentTime } from "./utils/index.js";
import { loadConfig } from "./config/toml.js";
import { Trade } from "./trade/index.js";
import { notifySettlement, notifyError, notifyStartup, notifyLog } from "./services/telegram.js";
import { startDashboard } from "./dashboard.js";
import { botState, logTrade, updatePosition } from "./state.js";
import { initDb, dbLoadLastConfig, dbGetStats } from "./services/db.js";

loadConfig();
startDashboard();

// Initialize DB and load persisted state
initDb().then(async () => {
  // Load stats from DB
  const dbStats = await dbGetStats();
  if (dbStats) {
    botState.stats.totalPnl = parseFloat(dbStats.total_pnl) || 0;
    botState.stats.wins = dbStats.wins || 0;
    botState.stats.losses = dbStats.losses || 0;
    botState.stats.totalTrades = dbStats.total_trades || 0;
    console.log("Loaded stats from DB:", botState.stats);
  }
}).catch(e => console.error("DB init failed:", e));

function getMinutesForCoin(coin: Coin): Minutes {
  const cfg = globalThis.__CONFIG__.market as any;
  const override = cfg[`${coin}_period`];
  const defaultMins = parseInt(globalThis.__CONFIG__.market.market_period);
  return override ? parseInt(override) as Minutes : defaultMins as Minutes;
}

async function runCoin(coin: Coin, client: ClobClient) {
  const label = coin.toUpperCase();
  const minutes = getMinutesForCoin(coin);

  while (true) {
    const { slug, endTimestamp } = generateMarketSlug(coin, minutes);
    console.log(`[${label}] 🔍 Searching for market with slug: "${slug}"`);
    console.log(`[${label}]    Market ends at:${getCurrentTime()} / ${endTimestamp}`);

    let market;
    try {
      market = await getMarket(slug);
    } catch (e) {
      console.error(`[${label}] ❌ Market not found for slug: ${slug}, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    const upTokenId = JSON.parse(market.clobTokenIds)[0];
    const downTokenId = JSON.parse(market.clobTokenIds)[1];
    const usd = globalThis.__CONFIG__.trade_usd;

    const trade = new Trade(usd, upTokenId, downTokenId, client, label, minutes);
    trade.marketSlug = slug;

    // Initialize position in shared state immediately so dashboard shows it
    updatePosition(label, {
      coin: label,
      side: "NONE",
      entryPrice: 0,
      currentPrice: 0,
      shares: 0,
      unrealizedPnl: 0,
      signalStrength: 0,
      timestamp: Date.now(),
    });

    let stalePriceAlerted = false;

    while (true) {
      // Skip trading when paused (still poll prices for live view)
      if (botState.paused) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (endTimestamp - getCurrentTime() <= 0) break;
        continue;
      }

      try {
        const e = await getPrices(upTokenId, downTokenId);
        stalePriceAlerted = false;
        trade.updatePrices(endTimestamp - getCurrentTime(), e[upTokenId].BUY, e[upTokenId].SELL, e[downTokenId].BUY, e[downTokenId].SELL);
        await trade.make_trading_decision();
      } catch (e) {
        console.error(`[${label}]`, e);
        const lastUpdate = botState.lastPriceUpdate.get(label) || Date.now();
        const staleSecs = Math.round((Date.now() - lastUpdate) / 1000);
        if (staleSecs > 5) {
          console.warn(`[${label}] Stale prices (${staleSecs}s since last update)`);
          if (staleSecs > 30 && !stalePriceAlerted) {
            stalePriceAlerted = true;
            notifyError(label, "price_feed", `Prices stale for ${staleSecs}s, skipping trades`);
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      if (endTimestamp - getCurrentTime() <= 0) {
        // Notify and log if still holding tokens at market end
        if (trade.holdingStatus !== "None" && trade.share > 0.1) {
          const side = trade.holdingStatus === "Up" ? "UP" : "DOWN";
          logTrade({ coin: label, side: side as "UP" | "DOWN", action: "SETTLE", price: side === "UP" ? trade.upBuyPrice : trade.downBuyPrice, amount: trade.share * (side === "UP" ? trade.upBuyPrice : trade.downBuyPrice), shares: trade.share, pnl: 0, reason: "market ended", timestamp: Date.now() });
          await notifySettlement(label, side as "UP" | "DOWN", trade.share, slug);
        }
        break;
      }
    }
  }
}

async function main() {
  const port = process.env.PORT || 3000;
  const signerAddr = SIGNER?.address || "unknown";

  botState.botStatus = "connecting";
  await notifyLog(`Bot starting... Port: ${port}, Signer: ${signerAddr}`);

  console.log("SIGNER ", SIGNER);
  const clobClient = new ClobClient(HOST, CHAIN_ID, SIGNER);
  const apiKey = await clobClient.createOrDeriveApiKey();
  botState.botStatus = "running";
  console.log("apiKey", apiKey);

  const client = new ClobClient(
    HOST,
    CHAIN_ID,
    SIGNER,
    apiKey,
    SIGNATURE_TYPE,
    FUNDER,
    undefined, // geoBlockToken
    true, // useServerTime
  );

  const coins = globalThis.__CONFIG__.market.market_coins as Coin[];
  console.log(`Starting trading for coins: ${coins.join(", ")}`);

  await notifyStartup({ port, coins, signer: signerAddr });

  // Run all coins in parallel
  await Promise.all(coins.map(coin => runCoin(coin, client)));
}

main().catch(async err => {
  const port = process.env.PORT || 3000;
  const errMsg = err?.message || String(err);
  botState.botStatus = "error: " + errMsg.slice(0, 100);
  console.error("Fatal error in main():", err);
  console.log("Dashboard is still running. Fix the issue and restart.");
  await notifyStartup({ port, coins: [], signer: "unknown", error: errMsg });
  // Keep process alive for dashboard access
});
