import "dotenv/config";
import { readFile } from "fs/promises";
import {
  T3nClient,
  TenantClient,
  setEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  fetchTrustedManifest,
  getNodeUrl,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");

async function main() {
  const T3N_API_KEY = process.env.T3N_API_KEY;
  if (!T3N_API_KEY) {
    console.error("ERROR: T3N_API_KEY not set");
    process.exit(1);
  }

  console.log("Registering T3N trading risk gate contract...");

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(T3N_API_KEY);

  // First, authenticate with T3nClient to get tenantDid
  const t3n = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(address, undefined, T3N_API_KEY),
    },
  });

  await t3n.handshake();
  const auth = await t3n.authenticate(createEthAuthInput(address));
  const tenantDid = auth.value;
  console.log(`Authenticated as tenant: ${tenantDid}`);

  // Now create TenantClient with the tenantDid - pass the authenticated t3n as the `t3n` config
  const nodeUrl = getNodeUrl();
  const tenantClient = new TenantClient({
    t3n: t3n,
    baseUrl: nodeUrl,
    tenantDid,
  });

  // Read WASM file
  const WASM_PATH = "../contract/target/wasm32-wasip2/release/z_trading_risk_gate.wasm";
  const CONTRACT_TAIL = "trading-risk-gate";
  const CONTRACT_VERSION = "1.0.0";

  const wasmBytes = await readFile(WASM_PATH);
  console.log(`WASM size: ${wasmBytes.length} bytes`);

  // Register contract - ensure Uint8Array
  const wasmUint8 = new Uint8Array(wasmBytes);
  const result = await tenantClient.contracts.register({
    tail: CONTRACT_TAIL,
    version: CONTRACT_VERSION,
    wasm: wasmUint8,
  });

  const contractId = result.contract_id;
  const tenantId = tenantDid.slice("did:t3n:".length);
  const scriptName = `z:${tenantId}:${CONTRACT_TAIL}`;

  console.log(`Contract registered!`);
  console.log(`  Contract ID: ${contractId}`);
  console.log(`  Script Name: ${scriptName}`);
  console.log(`  Version: ${CONTRACT_VERSION}`);

  // Create KV maps (idempotent - ignore "already exists" errors)
  console.log("\nCreating KV maps...");

  async function createMap(tail: string) {
    try {
      await tenantClient.maps.create({
        tail,
        visibility: "private",
        writers: { only: [contractId] },
        readers: { only: [contractId] },
      });
      console.log(`Created ${tail} map`);
    } catch (e: any) {
      if (e.detail?.includes("already exists") || e.message?.includes("already exists")) {
        console.log(`${tail} map already exists - updating ACLs`);
        // Update ACLs to include the new contract ID
        await tenantClient.maps.update(tail, {
          writers: { only: [contractId] },
          readers: { only: [contractId] },
        });
        console.log(`Updated ${tail} map ACLs`);
      } else {
        throw e;
      }
    }
  }

  await createMap("secrets");
  await createMap("decisions");
  await createMap("daily-stats");
  await createMap("mandates");
  await createMap("escalations");

  // Seed secrets
  console.log("\nSeeding secrets...");

  const OKX_API_KEY = process.env.OKX_API_KEY || "demo_key";
  const OKX_SECRET = process.env.OKX_SECRET || "demo_secret";
  const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE || "demo_passphrase";

  await tenantClient.executeControl("map-entry-set", {
    map_name: `z:${tenantId}:secrets`,
    key: "okx_api_key",
    value: OKX_API_KEY,
  });
  console.log("Seeded okx_api_key");

  await tenantClient.executeControl("map-entry-set", {
    map_name: `z:${tenantId}:secrets`,
    key: "okx_secret",
    value: OKX_SECRET,
  });
  console.log("Seeded okx_secret");

  await tenantClient.executeControl("map-entry-set", {
    map_name: `z:${tenantId}:secrets`,
    key: "okx_passphrase",
    value: OKX_PASSPHRASE,
  });
  console.log("Seeded okx_passphrase");

  // Seed risk params (includes CESF crash-veto threshold + Kelly/sweet-spot knobs)
  const riskParams = {
    max_position_usd: 5000,
    max_daily_loss_usd: 500,
    min_confidence_bps: 7000,
    max_leverage: 5.0,
    max_daily_trades: 10,
    allowed_assets: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP", "BNB-USDT-SWAP"],
    crash_veto_threshold_bps: 2000,
    min_implied_prob: 0.44,
    max_implied_prob: 0.62,
    kelly_fraction_cap: 0.25,
    equity_usd: 10000,
    avg_reward_risk_ratio: 1.5,
  };

  await tenantClient.executeControl("map-entry-set", {
    map_name: `z:${tenantId}:secrets`,
    key: "risk_params",
    value: JSON.stringify(riskParams),
  });
  console.log("Seeded risk_params");

  console.log("\n=== Setup Complete ===");
  console.log(`Contract: ${scriptName} v${CONTRACT_VERSION}`);
  console.log(`Contract ID: ${contractId}`);
  console.log("\nNow you can run the demo:");
  console.log("  npm run demo");
}

main().catch(console.error);