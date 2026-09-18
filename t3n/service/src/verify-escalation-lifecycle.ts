import "dotenv/config";
import { createUserClient } from "./t3n-auth.js";
import {
  evaluateMandate,
  listEscalations,
  resolveEscalation,
} from "./contract.js";

const SCRIPT = "z:5db3681df85b9a698777a5aa603329da86cdb5dc:trading-risk-gate";
const VER = "1.0.0";

async function main() {
  const userClient = await createUserClient();
  const d = "  ";

  console.log("--- escalate (2000 USD) ---");
  const vEsc = await evaluateMandate(userClient, SCRIPT, VER, {
    action_type: "trade",
    nonce: 100,
    trade_params: { asset: "BTC-USDT-SWAP", direction: "long", size_usd: 2000, price: 77500, confidence_bps: 5500 },
  });
  console.log(d + JSON.stringify(vEsc));
  const id = vEsc.escalation_id;

  console.log("\n--- list-escalations ---");
  const esc = await listEscalations(userClient, SCRIPT, VER);
  console.log(d + JSON.stringify(esc));

  if (id) {
    console.log("\n--- resolve escalation " + id + " (deny) ---");
    try {
      const r = await resolveEscalation(userClient, SCRIPT, VER, id, "deny");
      console.log(d + JSON.stringify(r));
    } catch (e: any) {
      console.log(d + "resolve error: " + (e.message || e));
    }

    console.log("\n--- list-escalations after resolve ---");
    const esc2 = await listEscalations(userClient, SCRIPT, VER);
    console.log(d + JSON.stringify(esc2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
