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
 * Direction: determines which side to bet on.
 * Uses price position relative to 0.5 AND momentum confirmation.
 * Only returns a direction when both agree.
 */
export function getDirection(prices: number[]): "UP" | "DOWN" | "NONE" {
  if (prices.length < 5) return "NONE";

  const current = prices[prices.length - 1];
  const prev = prices[prices.length - 3]; // 3 ticks ago

  // Price must be clearly away from 0.5
  if (current > 0.55 && current > prev) return "UP";   // price above 0.55 AND rising
  if (current < 0.45 && current < prev) return "DOWN";  // price below 0.45 AND falling

  // With more history, use SMA confirmation
  if (prices.length >= 10) {
    const fast = sma(prices, 5);
    const slow = sma(prices, 10);

    // Both SMAs and current price must agree on direction
    if (current > 0.52 && fast > slow && current >= fast) return "UP";
    if (current < 0.48 && fast < slow && current <= fast) return "DOWN";
  }

  return "NONE"; // no clear direction — don't trade
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
