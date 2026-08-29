import { fetchCandles } from "./okx-client.js";

export interface Signal {
  direction: "long" | "short" | "none";
  confidence_bps: number;
  price: number;
  reason: string;
}

export async function generateMaCrossoverSignal(instId: string): Promise<Signal> {
  const candles = await fetchCandles(instId, "1H", 50);
  
  if (candles.length < 21) {
    return {
      direction: "none",
      confidence_bps: 0,
      price: 0,
      reason: "Insufficient candle data",
    };
  }

  // Reverse candles so index 0 is oldest
  const closes = candles.map(c => parseFloat(c.c)).reverse();
  
  // Simple MA crossover: 5-period vs 20-period
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  
  const currentPrice = closes[closes.length - 1];
  const spread = Math.abs(ma5 - ma20) / currentPrice;
  
  // Determine direction
  let direction: "long" | "short" | "none" = "none";
  let confidence_bps = 0;
  let reason = "";
  
  if (ma5 > ma20 && spread > 0.01) {
    direction = "long";
    confidence_bps = Math.min(Math.floor(spread * 10000), 9000);
    reason = `MA5 (${ma5.toFixed(2)}) > MA20 (${ma20.toFixed(2)}), spread ${(spread * 100).toFixed(2)}%`;
  } else if (ma5 < ma20 && spread > 0.01) {
    direction = "short";
    confidence_bps = Math.min(Math.floor(spread * 10000), 9000);
    reason = `MA5 (${ma5.toFixed(2)}) < MA20 (${ma20.toFixed(2)}), spread ${(spread * 100).toFixed(2)}%`;
  } else {
    reason = `MA5 (${ma5.toFixed(2)}) ≈ MA20 (${ma20.toFixed(2)}), spread ${(spread * 100).toFixed(2)}% - no signal`;
  }

  return {
    direction,
    confidence_bps,
    price: currentPrice,
    reason,
  };
}

/**
 * Estimate the probability (in bps) of a >20% drawdown over the trade
 * horizon, using only the realized volatility of OKX historical candles.
 *
 * Model: with log returns ~ N(mu, sigma^2) over the horizon we approximate
 *   crash_mass = P(max drawdown < -20%)
 * via P(r_over_horizon < -0.20) = Phi((ln(0.8) - mu*H) / (sigma*sqrt(H)))
 * where H is the horizon length in units of the candle period. This is a
 * light-weight CESF-style crash veto input — no synthetic data.
 */
export function estimateCrashMassBps(
  candles: { c: string; h: string; l: string }[],
  horizonCandles = 6
): number {
  if (candles.length < 30) return 0;
  const closes = candles.map((c) => parseFloat(c.c)).reverse();
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  const n = logReturns.length;
  if (n < 20) return 0;
  const mean = logReturns.reduce((a, b) => a + b, 0) / n;
  const variance =
    logReturns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  const sigma = Math.sqrt(variance);
  if (sigma <= 0) return 0;
  const horizonSigma = sigma * Math.sqrt(horizonCandles);
  const z = (Math.log(0.8) - mean * horizonCandles) / horizonSigma;
  const p = normalCdf(z);
  return Math.round(p * 10000);
}

function normalCdf(x: number): number {
  // Abramowitz-Stegun approximation of the standard normal CDF.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/**
 * Build the 17 normalized features for the in-TEE tiny NN from OKX
 * historical candles (indexing by candle position, oldest first). All
 * features are bounded ~[-3, 3] so they can be fed directly to the 17→8→1
 * network. No synthetic data.
 */
export async function extract17Features(instId: string): Promise<number[]> {
  const candles = await fetchCandles(instId, "1H", 60);
  const closes = candles.map((c) => parseFloat(c.c)).reverse();
  const volume = candles.map((c) => parseFloat(c.vol ?? "0")).reverse();
  const highs = candles.map((c) => parseFloat(c.h)).reverse();
  const lows = candles.map((c) => parseFloat(c.l)).reverse();

  if (closes.length < 24) {
    return new Array(17).fill(0);
  }

  const last = closes[closes.length - 1];
  const features: number[] = [];

  // 0. 1h return
  const r1 = closes[closes.length - 1] / closes[closes.length - 2] - 1;
  features.push(clamp(r1 * 100, -3, 3));
  // 1. 6h return
  const r6 = closes[closes.length - 1] / closes[closes.length - 7] - 1;
  features.push(clamp(r6 * 100, -3, 3));
  // 2. 24h return
  const r24 = closes[closes.length - 1] / closes[closes.length - 25] - 1;
  features.push(clamp(r24 * 100, -3, 3));
  // 3. EMA8 vs EMA21 gap (normalized)
  const ema8 = ema(closes, 8);
  const ema21 = ema(closes, 21);
  features.push(clamp(((ema8 - ema21) / last) * 100, -3, 3));
  // 4. RSI14
  features.push(clamp((rsi(closes, 14) - 50) / 25, -3, 3));
  // 5. 24h realized vol (annualized proxy scaled down)
  const vol24 = stddev(closes.slice(-25).map((_, i, a) => (i === 0 ? 0 : a[i] / a[i - 1] - 1)));
  features.push(clamp(vol24 * 100, 0, 3));
  // 6. ATR14 / price
  const atr = atr14(highs, lows, closes);
  features.push(clamp((atr / last) * 100, 0, 3));
  // 7. high-low range 24h / price
  const lo24 = Math.min(...closes.slice(-25));
  const hi24 = Math.max(...closes.slice(-25));
  features.push(clamp(((hi24 - lo24) / last) * 100, 0, 3));
  // 8. volume z-score (24h)
  const vol = volume.slice(-25);
  const vMean = vol.reduce((a, b) => a + b, 0) / vol.length;
  const vStd = Math.sqrt(vol.reduce((a, b) => a + (b - vMean) * (b - vMean), 0) / vol.length) || 1;
  features.push(clamp((vol[vol.length - 1] - vMean) / vStd, -3, 3));
  // 9. distance from 24h low
  features.push(clamp(((last - lo24) / lo24) * 100, 0, 3));
  // 10. MACD histogram (normalized)
  features.push(clamp(macdHist(closes) / last * 100, -3, 3));
  // 11. momentum 3h
  const r3 = closes[closes.length - 1] / closes[closes.length - 4] - 1;
  features.push(clamp(r3 * 100, -3, 3));
  // 12. close / VWAP proxy
  const vwap = closes.reduce((a, b) => a + b, 0) / closes.length;
  features.push(clamp(((last - vwap) / vwap) * 100, -3, 3));
  // 13. consecutive down candles (recent bias)
  let down = 0;
  for (let i = closes.length - 1; i > 0 && closes[i] < closes[i - 1]; i--) down++;
  features.push(clamp(down / 6, 0, 3));
  // 14. consecutive up candles
  let up = 0;
  for (let i = closes.length - 1; i > 0 && closes[i] > closes[i - 1]; i--) up++;
  features.push(clamp(up / 6, 0, 3));
  // 15. stochastic %K
  const k = (last - lo24) / (hi24 - lo24 || 1) * 100;
  features.push(clamp((k - 50) / 25, -3, 3));
  // 16. 48h return if available else 0
  let r48 = 0;
  if (closes.length > 49) r48 = closes[closes.length - 1] / closes[closes.length - 49] - 1;
  features.push(clamp(r48 * 100, -3, 3));

  return features;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values: number[], period: number): number {
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = gain / period / (loss / period);
  return 100 - 100 / (1 + rs);
}

function stddev(returns: number[]): number {
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
}

function atr14(highs: number[], lows: number[], closes: number[]): number {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < 15) return 0;
  let sum = 0;
  for (let i = n - 14; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    sum += tr;
  }
  return sum / 14;
}

function macdHist(closes: number[]): number {
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macd = e12 - e26;
  // signal line = EMA9 of macd (approximated with latest window)
  const sig = (e12 - e26) * 0.9;
  return macd - sig;
}