import { dbSaveTrade, dbUpdateStats } from "./services/db.js";

export interface PositionInfo {
  coin: string;
  side: "UP" | "DOWN" | "NONE";
  entryPrice: number;
  currentPrice: number;
  shares: number;
  unrealizedPnl: number;
  signalStrength: number;
  timestamp: number;
}

export interface TradeRecord {
  coin: string;
  side: "UP" | "DOWN";
  action: "BUY" | "SELL" | "SETTLE";
  price: number;
  amount: number;
  shares: number;
  pnl: number;
  reason: string;
  timestamp: number;
}

const MAX_TRADE_HISTORY = 200;

export const botState = {
  positions: new Map<string, PositionInfo>(),
  trades: [] as TradeRecord[],
  stats: { totalPnl: 0, wins: 0, losses: 0, totalTrades: 0 },
  lastPriceUpdate: new Map<string, number>(),
};

export function logTrade(record: TradeRecord) {
  botState.trades.push(record);
  if (botState.trades.length > MAX_TRADE_HISTORY) {
    botState.trades.shift();
  }
  if (record.action === "SELL" || record.action === "SETTLE") {
    botState.stats.totalPnl += record.pnl;
    botState.stats.totalTrades++;
    if (record.pnl >= 0) botState.stats.wins++;
    else botState.stats.losses++;
  } else if (record.action === "BUY") {
    botState.stats.totalTrades++;
  }

  // Persist to PostgreSQL (fire and forget)
  dbSaveTrade({
    coin: record.coin,
    side: record.side,
    action: record.action,
    price: record.price,
    amount: record.amount,
    shares: record.shares,
    pnl: record.pnl,
    reason: record.reason,
  }).catch(() => {});
  dbUpdateStats(botState.stats).catch(() => {});
}

export function updatePosition(coin: string, info: Partial<PositionInfo>) {
  const existing = botState.positions.get(coin) || {
    coin, side: "NONE" as const, entryPrice: 0, currentPrice: 0,
    shares: 0, unrealizedPnl: 0, signalStrength: 0, timestamp: Date.now(),
  };
  botState.positions.set(coin, { ...existing, ...info });
}
