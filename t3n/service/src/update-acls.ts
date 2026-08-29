import "dotenv/config";
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

  console.log("Updating KV map ACLs for current contract...");

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

  // Now create TenantClient with the tenantDid
  const nodeUrl = getNodeUrl();
  const tenantClient = new TenantClient({
    t3n: t3n,
    baseUrl: nodeUrl,
    tenantDid,
  });

  const tenantId = tenantDid.slice("did:t3n:".length);
  const scriptName = `z:${tenantId}:trading-risk-gate`;

  // Get the contract ID: from env var T3N_CONTRACT_ID (set after registration),
  // or fall back to argv[2].
  const contractId = Number(
    process.env.T3N_CONTRACT_ID || process.argv[2] || 0
  );
  if (!contractId) {
    console.error(
      "ERROR: no contract ID provided. Set T3N_CONTRACT_ID env var or pass it as argv[2].\n" +
      "It is reported in the output of `npm run register`."
    );
    process.exit(1);
  }

  console.log(`Using contract ID: ${contractId}`);

  // Update KV map ACLs to include the current contract ID
  console.log("\nUpdating KV map ACLs...");

  async function updateMapACLs(tail: string) {
    try {
      await tenantClient.maps.update(tail, {
        writers: { only: [contractId] },
        readers: { only: [contractId] },
      });
      console.log(`Updated ${tail} map ACLs for contract ${contractId}`);
    } catch (e: any) {
      console.error(`Failed to update ${tail} map:`, e.message || e.detail || e);
    }
  }

  await updateMapACLs("secrets");
  await updateMapACLs("decisions");
  await updateMapACLs("daily-stats");
  await updateMapACLs("mandates");
  await updateMapACLs("escalations");

  console.log("\n=== ACL Update Complete ===");
  console.log(`All maps now readable/writable by contract ${contractId}`);
  console.log("Now run: npm run demo");
}

main().catch(console.error);