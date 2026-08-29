import "dotenv/config";
import { createTenantClient, createAgentClient, createUserClient, grantAgentAccess } from "./t3n-auth.js";
import { runTradingCycle } from "./orchestrator.js";
import { getRiskParams, getDailyStats, getMandate, listEscalations } from "./contract.js";

async function main() {
  console.log("=== T3N Trading Agent Demo ===\n");

  // Initialize
  const { tenantClient, tenantDid } = await createTenantClient();
  console.log(`Tenant: ${tenantDid}`);

  const { agentClient, agentDid, scriptName, scriptVersion } = await createAgentClient(tenantDid);
  console.log(`Agent script: ${scriptName} v${scriptVersion}`);

  const userClient = await createUserClient();
  await grantAgentAccess(userClient, agentDid, scriptName, scriptVersion);

  // Show risk params (use user client which has credits)
  console.log("\n--- Risk Parameters ---");
  const riskParams = await getRiskParams(userClient, scriptName, scriptVersion);
  console.log(JSON.stringify(riskParams, null, 2));

  // Show current mandate
  console.log("\n--- Mandate ---");
  const mandate = await getMandate(userClient, scriptName, scriptVersion);
  console.log(JSON.stringify(mandate, null, 2));

  // Show daily stats
  console.log("\n--- Daily Stats ---");
  const dailyStats = await getDailyStats(userClient, scriptName, scriptVersion);
  console.log(JSON.stringify(dailyStats, null, 2));

  // Run trading cycle (use user client which has credits)
  console.log("\n--- Trading Cycle ---");
  const results = await runTradingCycle(userClient, scriptName, scriptVersion, ["BTC-USDT-SWAP"]);

  console.log("\n=== Results ===");
  for (const result of results) {
    console.log(`\nAsset: ${result.asset}`);
    console.log(`  Signal: ${result.signal.direction} @ ${result.signal.price} (${result.signal.confidence_bps}bps)`);
    console.log(`  Reason: ${result.signal.reason}`);
    if (result.crashMassBps !== undefined) console.log(`  Crash mass: ${result.crashMassBps}bps`);
    if (result.nn) console.log(`  NN win prob: ${result.nn.win_prob.toFixed(3)}`);
    if (result.sizing) console.log(`  Sizing: $${result.sizing.size_usd.toFixed(2)} (sweet spot: ${result.sizing.sweet_spot})`);
    if (result.mandateVerdict) console.log(`  Mandate: ${result.mandateVerdict.verdict} - ${result.mandateVerdict.reason}`);
    console.log(`  Validation: ${result.validation.approved ? "APPROVED" : "REJECTED"} - ${result.validation.reason}`);
    if (result.execution) {
      console.log(`  Execution: ${JSON.stringify(result.execution)}`);
    }
  }

  // Show pending escalations
  console.log("\n--- Pending Escalations ---");
  const esc = await listEscalations(userClient, scriptName, scriptVersion);
  console.log(JSON.stringify(esc, null, 2));

  // Show updated daily stats
  console.log("\n--- Updated Daily Stats ---");
  const updatedStats = await getDailyStats(userClient, scriptName, scriptVersion);
  console.log(JSON.stringify(updatedStats, null, 2));

  console.log("\n=== Demo Complete ===");
}

main().catch(console.error);