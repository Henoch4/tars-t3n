import "dotenv/config";
import {
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

  console.log("Setting up T3N trading agent...");

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(T3N_API_KEY);

  const t3n = new TenantClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent,
    tenantDid: "", // Will be filled after auth
    handlers: {
      EthSign: metamask_sign(address, undefined, T3N_API_KEY),
    },
  });

  // First authenticate to get tenantDid
  const auth = await (t3n as any).authenticate(createEthAuthInput(address));
  const tenantDid = auth.value;
  console.log(`Authenticated as tenant: ${tenantDid}`);

  // Update tenantClient with tenantDid
  const tenantClient = new TenantClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent,
    tenantDid,
    handlers: {
      EthSign: metamask_sign(address, undefined, T3N_API_KEY),
    },
  });

  // Get contract ID (assuming already registered)
  const { getContractVersion } = await import("@terminal3/t3n-sdk");
  const contractTail = "trading-risk-gate";
  const nodeUrl = getNodeUrl();
  const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${contractTail}`;
  const contractVersion = await getContractVersion(nodeUrl, scriptName);
  console.log(`Contract: ${scriptName} v${contractVersion}`);

  // For now, we need to register the contract first
  // This is a placeholder - contract registration happens separately
  console.log("\nNOTE: Contract must be registered first via the registration script.");
  console.log("Then run this script to create maps and seed secrets.");
  
  process.exit(0);
}

main().catch(console.error);