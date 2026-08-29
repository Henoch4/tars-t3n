import "dotenv/config";
import { createServer } from "http";
import { createTenantClient, createAgentClient, createUserClient, grantAgentAccess } from "./t3n-auth.js";
import { runTradingCycle, TradeResult } from "./orchestrator.js";
import { getRiskParams, getDailyStats, getMandate, setMandate, listEscalations, resolveEscalation } from "./contract.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

let agentClient: any = null;
let scriptName: string = "";
let scriptVersion: string = "";
let tenantDid: string = "";
let initialized = false;

async function initialize() {
  if (initialized) return;

  console.log("Initializing T3N trading agent...");

  // Create tenant client
  const { tenantClient, tenantDid: td } = await createTenantClient();
  tenantDid = td;
  console.log(`Tenant DID: ${tenantDid}`);

  // Create agent client
  const { agentClient: ac, agentDid, scriptName: sn, scriptVersion: sv } = await createAgentClient(tenantDid);
  agentClient = ac;
  scriptName = sn;
  scriptVersion = sv;
  console.log(`Agent script: ${scriptName} v${scriptVersion}`);

  // Create user client and grant agent access
  const userClient = await createUserClient();
  await grantAgentAccess(userClient, agentDid, sn, sv);

  initialized = true;
  console.log("Initialization complete!");
}

const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (!initialized) {
      await initialize();
    }

    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", tenantDid, scriptName, scriptVersion }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/risk-params") {
      const params = await getRiskParams(agentClient, scriptName, scriptVersion);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(params));
      return;
    }

    if (req.method === "GET" && url.pathname === "/daily-stats") {
      const stats = await getDailyStats(agentClient, scriptName, scriptVersion);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats));
      return;
    }

    if (req.method === "GET" && url.pathname === "/mandate") {
      const mandate = await getMandate(agentClient, scriptName, scriptVersion);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(mandate));
      return;
    }

    if (req.method === "POST" && url.pathname === "/mandate") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const mandate = JSON.parse(body || "{}");
      const result = await setMandate(agentClient, scriptName, scriptVersion, mandate);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === "GET" && url.pathname === "/escalations") {
      const escalations = await listEscalations(agentClient, scriptName, scriptVersion);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(escalations));
      return;
    }

    if (req.method === "POST" && url.pathname === "/escalations/resolve") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { escalation_id, decision } = JSON.parse(body || "{}");
      const result = await resolveEscalation(agentClient, scriptName, scriptVersion, escalation_id, decision);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === "POST" && url.pathname === "/trade") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      const { assets = ["BTC-USDT-SWAP", "ETH-USDT-SWAP"] } = JSON.parse(body || "{}");

      const results = await runTradingCycle(agentClient, scriptName, scriptVersion, assets);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/demo") {
      // Run a full demo cycle
      console.log("\n=== DEMO TRADING CYCLE ===");
      const results = await runTradingCycle(agentClient, scriptName, scriptVersion, ["BTC-USDT-SWAP"]);

      // Also show daily stats
      const stats = await getDailyStats(agentClient, scriptName, scriptVersion);
      const params = await getRiskParams(agentClient, scriptName, scriptVersion);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: "Demo completed",
        results,
        daily_stats: stats,
        risk_params: params,
      }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error("Request error:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
  }
});

server.listen(PORT, () => {
  console.log(`T3N Trading Agent server running on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  GET  /health       - Health check");
  console.log("  GET  /risk-params  - Get current risk parameters");
  console.log("  GET  /daily-stats  - Get today's daily stats");
  console.log("  GET  /mandate      - Get the current mandate");
  console.log("  POST /mandate      - Set the mandate (owner only)");
  console.log("  GET  /escalations  - List pending escalations");
  console.log("  POST /escalations/resolve - Resolve an escalation");
  console.log("  POST /trade        - Run trading cycle { assets?: string[] }");
  console.log("  POST /demo         - Run demo cycle");
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
});