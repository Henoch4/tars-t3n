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
  toAgentAuthUpdateWire,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");

let wasmComponentPromise: Promise<any> | null = null;

async function getWasmComponent() {
  if (!wasmComponentPromise) {
    wasmComponentPromise = loadWasmComponent();
  }
  return wasmComponentPromise;
}

export async function createTenantClient(): Promise<{
  tenantClient: TenantClient;
  tenantDid: string;
}> {
  const T3N_API_KEY = process.env.T3N_API_KEY;
  if (!T3N_API_KEY) {
    throw new Error("T3N_API_KEY not set in environment");
  }

  const wasmComponent = await getWasmComponent();
  const address = eth_get_address(T3N_API_KEY);

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

  const tenantClient = new TenantClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent,
    tenantDid,
    handlers: {
      EthSign: metamask_sign(address, undefined, T3N_API_KEY),
    },
  });

  return { tenantClient, tenantDid };
}

export async function createAgentClient(tenantDid: string): Promise<{
  agentClient: T3nClient;
  agentDid: string;
  scriptName: string;
  scriptVersion: string;
}> {
  const AGENT_KEY = process.env.AGENT_KEY;
  if (!AGENT_KEY) {
    throw new Error("AGENT_KEY not set in environment");
  }

  const wasmComponent = await getWasmComponent();
  const agentAddress = eth_get_address(AGENT_KEY);

  const agentClient = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(agentAddress, undefined, AGENT_KEY),
    },
  });

  await agentClient.handshake();
  const agentAuth = await agentClient.authenticate(createEthAuthInput(agentAddress));
  const agentDid = agentAuth.value;

  const { getContractVersion } = await import("@terminal3/t3n-sdk");
  const nodeUrl = getNodeUrl();
  const contractTail = "trading-risk-gate";
  const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${contractTail}`;
  const scriptVersion = await getContractVersion(nodeUrl, scriptName);

  return { agentClient, agentDid, scriptName, scriptVersion };
}

export async function createUserClient(): Promise<T3nClient> {
  const USER_KEY = process.env.USER_KEY;
  if (!USER_KEY) {
    throw new Error("USER_KEY not set in environment");
  }

  const wasmComponent = await getWasmComponent();
  const userAddress = eth_get_address(USER_KEY);

  const userClient = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(userAddress, undefined, USER_KEY),
    },
  });

  await userClient.handshake();
  await userClient.authenticate(createEthAuthInput(userAddress));

  return userClient;
}

export async function grantAgentAccess(
  userClient: T3nClient,
  agentDid: string,
  scriptName: string,
  scriptVersion: string
): Promise<void> {
  console.log("agentDid:", agentDid, typeof agentDid);
  
  // Manually construct the correct wire format (SDK's toAgentAuthUpdateWire is buggy)
  const wire = {
    agents: [{
      agent_did: String(agentDid),
      scripts: [{
        script_name: scriptName,
        version_req: scriptVersion,
        functions: [
          "validate-trade",
          "log-decision",
          "get-risk-params",
          "get-daily-stats",
          "set-mandate",
          "get-mandate",
          "evaluate-mandate",
          "resolve-escalation",
          "list-escalations",
          "compute-size",
          "ml-predict",
          "execute-plan",
        ],
        allowed_hosts: ["www.okx.com", "api.duffel.com"],
      }],
    }],
  };

  console.log("Wire format:", JSON.stringify(wire, null, 2));

  const { getContractVersion, getNodeUrl } = await import("@terminal3/t3n-sdk");
  const userContractVersion = await getContractVersion(getNodeUrl(), "tee:user/contracts");

  await userClient.execute({
    contract_id: "tee:user/contracts",
    contract_version: userContractVersion,
    function_name: "agent-auth-update",
    input: wire,
  });

  console.log(`Granted agent ${agentDid} access to ${scriptName}`);
}