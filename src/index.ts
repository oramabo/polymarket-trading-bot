import { ClobClient, Side } from "@polymarket/clob-client";
import { generateMarketSlug } from "./config/index.js";
import type { Coin, MarketConfig, Minutes } from "./types.js";
import { CHAIN_ID, FUNDER, getEvent, getMarket, getPrices, HOST, SIGNATURE_TYPE, SIGNER } from "./services/index.js";
import { getCurrentTime } from "./utils/index.js";
import { loadConfig } from "./config/toml.js";
import { Trade } from "./trade/index.js";
import { notifySettlement, notifyError } from "./services/telegram.js";
import { startDashboard } from "./dashboard.js";
import { botState, logTrade } from "./state.js";

loadConfig();
startDashboard();

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

    let stalePriceAlerted = false;

    while (true) {
      getPrices(upTokenId, downTokenId)
        .then(async e => {
          stalePriceAlerted = false;
          trade.updatePrices(endTimestamp - getCurrentTime(), e[upTokenId].BUY, e[upTokenId].SELL, e[downTokenId].BUY, e[downTokenId].SELL);
          await trade.make_trading_decision();
        })
        .catch(e => {
          console.error(`[${label}]`, e);
          // Stale price detection
          const lastUpdate = botState.lastPriceUpdate.get(label) || Date.now();
          const staleSecs = Math.round((Date.now() - lastUpdate) / 1000);
          if (staleSecs > 5) {
            console.warn(`[${label}] Stale prices (${staleSecs}s since last update)`);
            if (staleSecs > 30 && !stalePriceAlerted) {
              stalePriceAlerted = true;
              notifyError(label, "price_feed", `Prices stale for ${staleSecs}s, skipping trades`);
            }
          }
        });

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
  console.log("SIGNER ", SIGNER);
  const clobClient = new ClobClient(HOST, CHAIN_ID, SIGNER);
  const apiKey = await clobClient.createOrDeriveApiKey();
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

  // Run all coins in parallel
  await Promise.all(coins.map(coin => runCoin(coin, client)));
}

main();
