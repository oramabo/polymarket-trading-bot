/**
 * Simple Moving Average over the last `period` entries.
 */
export function sma(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / slice.length;
}

/**
 * Momentum: percentage change from `lookback` ticks ago to current.
 */
export function momentum(prices: number[], lookback: number): number {
  if (prices.length < lookback + 1) return 0;
  const prev = prices[prices.length - 1 - lookback];
  const curr = prices[prices.length - 1];
  if (prev === 0) return 0;
  return (curr - prev) / prev;
}

/**
 * Trend consistency: what fraction of recent ticks moved in the dominant direction.
 * Returns -1..1 where 1 = all ticks up, -1 = all ticks down.
 */
function trendConsistency(prices: number[], window: number): number {
  if (prices.length < 2) return 0;
  const slice = prices.slice(-window);
  let ups = 0;
  let downs = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] > slice[i - 1]) ups++;
    else if (slice[i] < slice[i - 1]) downs++;
  }
  const total = ups + downs;
  if (total === 0) return 0;
  return (ups - downs) / total;
}

/**
 * Signal strength: 0..1 indicating how confident we are in the current trend.
 * Combines trend consistency, momentum, time weight, and price extremity.
 */
export function getSignalStrength(prices: number[], timeRatio: number): number {
  if (prices.length < 5) return 0;

  const current = prices[prices.length - 1];

  // 1. Trend score: consistency of direction over last 10 ticks (0..1)
  const consistency = Math.abs(trendConsistency(prices, Math.min(10, prices.length)));

  // 2. Momentum score: how fast price is moving (0..1, capped)
  const mom = Math.abs(momentum(prices, Math.min(5, prices.length - 1)));
  const momentumScore = Math.min(mom / 0.3, 1); // normalize: 30% move = max score

  // 3. Time weight: prefer entering earlier in market (more time = higher weight)
  const timeWeight = Math.max(0, 1 - timeRatio);

  // 4. Price extremity: how far from 0.5 (stronger signal when price is decisive)
  const priceExtremity = Math.abs(current - 0.5) / 0.5;

  // Weighted combination
  const signal =
    consistency * 0.35 +
    momentumScore * 0.25 +
    timeWeight * 0.15 +
    priceExtremity * 0.25;

  return Math.min(Math.max(signal, 0), 1);
}

/**
 * Direction: SMA crossover to determine trend direction.
 * Uses SMA(5) vs SMA(15) when enough data, falls back to simpler logic.
 */
export function getDirection(prices: number[]): "UP" | "DOWN" | "NONE" {
  if (prices.length < 3) return "NONE";

  const current = prices[prices.length - 1];

  if (prices.length >= 15) {
    const fast = sma(prices, 5);
    const slow = sma(prices, 15);
    if (fast > slow + 0.01) return current > 0.5 ? "UP" : "DOWN";
    if (fast < slow - 0.01) return current < 0.5 ? "DOWN" : "UP";
  }

  // Fallback: simple direction from 0.5
  if (current > 0.55) return "UP";
  if (current < 0.45) return "DOWN";
  return "NONE";
}

/**
 * Scale position size based on signal strength.
 * Strong signal = full amount, weak = reduced.
 */
export function scalePosition(baseAmount: number, signal: number, enabled: boolean): number {
  if (!enabled) return baseAmount;
  // Scale: signal 0.3 = 50%, signal 0.7 = 85%, signal 1.0 = 100%
  const scale = 0.5 + (signal * 0.5);
  return Math.round(baseAmount * scale * 100) / 100;
}
