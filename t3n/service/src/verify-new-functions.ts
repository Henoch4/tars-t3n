import "dotenv/config";
import { createTenantClient, createAgentClient, createUserClient, grantAgentAccess } from "./t3n-auth.js";
import {
  getMandate,
  setMandate,
  evaluateMandate,
  computeSize,
  mlPredict,
  executePlan,
  listEscalations,
  resolveEscalation,
} from "./contract.js";

async function main() {
  console.log("=== Verify New TEE Functions (contract 0.1.3) ===\n");

  const { tenantClient, tenantDid } = await createTenantClient();
  const { agentClient, agentDid, scriptName, scriptVersion } = await createAgentClient(tenantDid);
  const userClient = await createUserClient();
  await grantAgentAccess(userClient, agentDid, scriptName, scriptVersion);

  const d = "  ";

  // 1. ml-predict (17 features)
  console.log("--- ml-predict ---");
  let features = new Array(17).fill(0);
  const ml = await mlPredict(userClient, scriptName, scriptVersion, features);
  console.log(d + "neutral features  win_prob =", ml.win_prob);

  features = new Array(17).fill(2.0); // strong bullish edge
  const mlUp = await mlPredict(userClient, scriptName, scriptVersion, features);
  console.log(d + "bullish features win_prob =", mlUp.win_prob);

  features = new Array(17).fill(-2.0); // strong bearish edge
  const mlDown = await mlPredict(userClient, scriptName, scriptVersion, features);
  console.log(d + "bearish features win_prob =", mlDown.win_prob);

  // 2. compute-size (fractional Kelly + sweet spot)
  console.log("\n--- compute-size ---");
  const sizeReq = { confidence_bps: 5500, nn_win_prob: 0.60, size_usd: 4000 };
  const size = await computeSize(userClient, scriptName, scriptVersion, sizeReq);
  console.log(d + "size_usd =", size.size_usd, "(sweet_spot =", size.sweet_spot + ")");

  const sizeHigh = await computeSize(userClient, scriptName, scriptVersion, {
    confidence_bps: 9000, nn_win_prob: null, size_usd: 1000,
  });
  console.log(d + "over-sweet spot (9000bps) size_usd =", sizeHigh.size_usd);

  // 3. evaluate-mandate (within) -> allow
  console.log("\n--- evaluate-mandate (700 USD, within) ---");
  const planAllow = {
    action_type: "trade",
    nonce: 1,
    trade_params: { asset: "BTC-USDT-SWAP", direction: "long", size_usd: 700, price: 77500, confidence_bps: 5500, crash_mass: 0.05 },
  };
  const vAllow = await evaluateMandate(userClient, scriptName, scriptVersion, planAllow);
  console.log(d + JSON.stringify(vAllow));

  // 4. evaluate-mandate (above escalation threshold) -> escalate
  console.log("\n--- evaluate-mandate (2000 USD, escalates) ---");
  const planEsc = {
    action_type: "trade",
    nonce: 2,
    trade_params: { asset: "BTC-USDT-SWAP", direction: "long", size_usd: 2000, price: 77500, confidence_bps: 5500, crash_mass: 0.05 },
  };
  const vEsc = await evaluateMandate(userClient, scriptName, scriptVersion, planEsc);
  console.log(d + JSON.stringify(vEsc));

  // 5. list-escalations (should now have 1 pending)
  console.log("\n--- list-escalations ---");
  const esc = await listEscalations(userClient, scriptName, scriptVersion);
  console.log(d + JSON.stringify(esc));

  // 6. execute-plan (atomic: within mandate, valid -> executes)
  console.log("\n--- execute-plan (700 USD, within mandate) ---");
  const exec = await executePlan(userClient, scriptName, scriptVersion, {
    nonce: 3,
    trade_params: { asset: "BTC-USDT-SWAP", direction: "long", size_usd: 700, price: 77500, confidence_bps: 5500 },
  });
  console.log(d + JSON.stringify(exec));

  // 7. execute-plan (above max, mandate deny -> refuses)
  console.log("\n--- execute-plan (9000 USD, above mandate max) ---");
  try {
    const execDeny = await executePlan(userClient, scriptName, scriptVersion, {
      nonce: 4,
      trade_params: { asset: "BTC-USDT-SWAP", direction: "long", size_usd: 9000, price: 77500, confidence_bps: 5500 },
    });
    console.log(d + JSON.stringify(execDeny));
  } catch (e: any) {
    console.log(d + "REFUSED (expected): " + (e.message || e));
  }

  // 8. resolve-escalation
  console.log("\n--- resolve-escalation (deny the pending one) ---");
  const escList = await listEscalations(userClient, scriptName, scriptVersion);
  if (escList.escalations.length > 0) {
    const id = escList.escalations[0].escalation_id;
    try {
      const resolved = await resolveEscalation(userClient, scriptName, scriptVersion, id, "deny");
      console.log(d + JSON.stringify(resolved));
    } catch (e: any) {
      console.log(d + "resolve error (ownership may block): " + (e.message || e));
    }
  } else {
    console.log(d + "no pending escalations to resolve");
  }

  console.log("\n=== Verification Complete ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
