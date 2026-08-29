import { T3nClient } from "@terminal3/t3n-sdk";
import {
  getRiskParams,
  getDailyStats,
  evaluateMandate,
  computeSize,
  mlPredict,
  executePlan,
  getMandate,
  listEscalations,
  ActionPlan,
} from "./contract.js";
import {
  generateMaCrossoverSignal,
  estimateCrashMassBps,
  extract17Features,
  Signal,
} from "./signal.js";
import { placeOrder, fetchCandles } from "./okx-client.js";

export interface TradeResult {
  asset: string;
  signal: Signal;
  validation: any;
  decision: any;
  execution: any;
  timestamp: string;
  mandateVerdict?: any;
  sizing?: any;
  nn?: any;
  crashMassBps?: number;
}

let nonceCounter = 1;

export async function runTradingCycle(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  assets: string[] = ["BTC-USDT-SWAP", "ETH-USDT-SWAP"]
): Promise<TradeResult[]> {
  const results: TradeResult[] = [];

  for (const asset of assets) {
    try {
      console.log(`\n--- Processing ${asset} ---`);

      // Step 1: Fetch candles + generate signal (real OKX history only)
      const candles = await fetchCandles(asset, "1H", 60);
      const signal = await generateMaCrossoverSignal(asset);
      console.log(`Signal: ${signal.direction} @ ${signal.price} (${signal.confidence_bps}bps) - ${signal.reason}`);

      // CESF crash veto input from realized vol (real data).
      const crashMassBps = estimateCrashMassBps(candles);
      console.log(`Crash mass (P drawdown >20%): ${crashMassBps}bps`);

      if (signal.direction === "none") {
        results.push({
          asset,
          signal,
          validation: { approved: false, reason: "No signal generated" },
          decision: null,
          execution: null,
          timestamp: new Date().toISOString(),
          crashMassBps,
        });
        continue;
      }

      // Step 2: In-TEE tiny NN scoring (17 real TA features).
      const features = await extract17Features(asset);
      const nn = await mlPredict(agentClient, scriptName, scriptVersion, features);
      console.log(`NN win prob: ${nn.win_prob.toFixed(3)}`);

      // Step 3: Fractional Kelly sizing in-TEE.
      const riskParams = await getRiskParams(agentClient, scriptName, scriptVersion);
      const sizing = await computeSize(agentClient, scriptName, scriptVersion, {
        confidence_bps: signal.confidence_bps,
        nn_win_prob: nn.win_prob,
        size_usd: (signal.confidence_bps / 10000) * riskParams.max_position_usd,
      });
      const positionSize = sizing.size_usd;
      console.log(`Sized position: $${positionSize.toFixed(2)} (sweet spot: ${sizing.sweet_spot})`);
      if (positionSize <= 0) {
        results.push({
          asset,
          signal,
          validation: { approved: false, reason: `Outside sizing sweet spot (NN=${nn.win_prob.toFixed(3)})` },
          decision: null,
          execution: null,
          timestamp: new Date().toISOString(),
          mandateVerdict: null,
          sizing,
          nn,
          crashMassBps,
        });
        continue;
      }

      // Step 4: Mandate evaluation (Grantline-style authority gate).
      const plan: ActionPlan = {
        action_type: "trade",
        nonce: nonceCounter++,
        trade_params: {
          asset,
          direction: signal.direction,
          size_usd: positionSize,
          price: signal.price,
          confidence_bps: signal.confidence_bps,
          crash_mass: crashMassBps / 10000,
        },
      };
      const mandateVerdict = await evaluateMandate(agentClient, scriptName, scriptVersion, plan);
      console.log(`Mandate: ${mandateVerdict.verdict} - ${mandateVerdict.reason}`);

      // Step 5: Atomic execute-plan (mandate + validate + log in one TEE call).
      const exec = await executePlan(agentClient, scriptName, scriptVersion, {
        nonce: plan.nonce,
        trade_params: {
          asset,
          direction: signal.direction,
          size_usd: positionSize,
          price: signal.price,
          confidence_bps: signal.confidence_bps,
          crash_mass: crashMassBps / 10000,
        },
      });
      console.log(`Execute-plan: ${JSON.stringify(exec)}`);

      let execution = null;
      if (exec.executed) {
        console.log(`Executing ${signal.direction} ${positionSize} USD of ${asset} @ ${signal.price}`);
        execution = await placeOrder({
          instId: asset,
          tdMode: "cross",
          side: signal.direction === "long" ? "buy" : "sell",
          ordType: "market",
          sz: (positionSize / signal.price).toFixed(4),
        });
      }

      results.push({
        asset,
        signal,
        validation: { approved: exec.approved, reason: exec.reason },
        decision: exec.decision_id ? { decision_id: exec.decision_id } : null,
        execution,
        timestamp: new Date().toISOString(),
        mandateVerdict,
        sizing,
        nn,
        crashMassBps,
      });

    } catch (error) {
      console.error(`Error processing ${asset}:`, error);
      results.push({
        asset,
        signal: { direction: "none", confidence_bps: 0, price: 0, reason: `Error: ${error}` },
        validation: { approved: false, reason: `Error: ${error}` },
        decision: null,
        execution: null,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return results;
}