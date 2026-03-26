import { dbSaveTrade, dbUpdateStats } from "./services/db.js";

export interface PositionInfo {
  coin: string;
  side: "UP" | "DOWN" | "NONE";
  entryPrice: number;
  currentPrice: number;
  shares: number;
  unrealizedPnl: number;
  signalStrength: number;
  usdBalance: number;
  remainingTime: number;
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

export interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

const MAX_TRADE_HISTORY = 200;
const MAX_LOGS = 150;

export const botState = {
  positions: new Map<string, PositionInfo>(),
  trades: [] as TradeRecord[],
  stats: { totalPnl: 0, wins: 0, losses: 0, totalTrades: 0 },
  lastPriceUpdate: new Map<string, number>(),
  botStatus: "starting" as string,
  startedAt: Date.now(),
  paused: false,
  logs: [] as LogEntry[],
};

// Intercept console to capture logs for dashboard
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

function captureLog(level: "info" | "warn" | "error", args: any[]) {
  const message = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ").slice(0, 300);
  botState.logs.push({ level, message, timestamp: Date.now() });
  if (botState.logs.length > MAX_LOGS) botState.logs.shift();
}

console.log = (...args: any[]) => { captureLog("info", args); origLog.apply(console, args); };
console.warn = (...args: any[]) => { captureLog("warn", args); origWarn.apply(console, args); };
console.error = (...args: any[]) => { captureLog("error", args); origError.apply(console, args); };

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

  dbSaveTrade({
    coin: record.coin, side: record.side, action: record.action,
    price: record.price, amount: record.amount, shares: record.shares,
    pnl: record.pnl, reason: record.reason,
  }).catch(() => {});
  dbUpdateStats(botState.stats).catch(() => {});
}

export function updatePosition(coin: string, info: Partial<PositionInfo>) {
  const existing = botState.positions.get(coin) || {
    coin, side: "NONE" as const, entryPrice: 0, currentPrice: 0,
    shares: 0, unrealizedPnl: 0, signalStrength: 0, usdBalance: 0, remainingTime: 0, timestamp: Date.now(),
  };
  botState.positions.set(coin, { ...existing, ...info });
}
