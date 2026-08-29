import { Agent } from "undici";
import { Resolver } from "node:dns/promises";
import * as net from "node:net";
import * as tls from "node:tls";

const OKX_BASE = "https://openapi.okx.com";

// Custom DNS resolver for environments where system DNS fails (e.g. ENOTFOUND)
const dns = new Resolver();
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const okxAgent = new Agent({
  connect: async (opts: any, callback: any) => {
    try {
      const hostname = opts.hostname || opts.host;
      const addrs = await dns.resolve4(hostname);
      const ip = addrs[0];
      const port = opts.port || 443;

      const socket = tls.connect({
        host: ip,
        port,
        servername: hostname,
        rejectUnauthorized: true,
      });

      socket.on("connect", () => callback(null, socket));
      socket.on("error", (err) => callback(err));
    } catch (err) {
      callback(err);
    }
  },
});

export interface Ticker {
  instId: string;
  last: string;
  askPx: string;
  bidPx: string;
  volCcy24h: string;
  ts: string;
}

export interface Candle {
  ts: string;
  o: string;
  h: string;
  l: string;
  c: string;
  vol: string;
  confirm: string;
}

export async function fetchTicker(instId: string): Promise<Ticker> {
  const url = `${OKX_BASE}/api/v5/market/ticker?instId=${instId}`;
  const response = await fetch(url, { dispatcher: okxAgent } as any);
  const data = await response.json();
  if (data.code !== "0") {
    throw new Error(`OKX ticker error: ${data.msg}`);
  }
  return data.data[0];
}

export async function fetchCandles(
  instId: string,
  bar: string = "1H",
  limit: number = 100
): Promise<Candle[]> {
  const url = `${OKX_BASE}/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  const response = await fetch(url, { dispatcher: okxAgent } as any);
  const data = await response.json();
  if (data.code !== "0") {
    throw new Error(`OKX candles error: ${data.msg}`);
  }
  return data.data.map((d: string[]) => ({
    ts: d[0],
    o: d[1],
    h: d[2],
    l: d[3],
    c: d[4],
    vol: d[5],
    confirm: d[6],
  }));
}

export async function fetchFundingRate(instId: string): Promise<number> {
  const url = `${OKX_BASE}/api/v5/public/funding-rate?instId=${instId}`;
  const response = await fetch(url, { dispatcher: okxAgent } as any);
  const data = await response.json();
  if (data.code !== "0") {
    throw new Error(`OKX funding rate error: ${data.msg}`);
  }
  return parseFloat(data.data[0].fundingRate);
}

export async function placeOrder(params: {
  instId: string;
  tdMode: "cross" | "isolated" | "cash";
  side: "buy" | "sell";
  ordType: "market" | "limit";
  sz: string;
  px?: string;
  ccy?: string;
}): Promise<any> {
  // In demo mode, just return a mock response
  if (process.env.DRY_RUN === "true") {
    console.log("[DRY RUN] Would place order:", params);
    return {
      code: "0",
      data: [{
        ordId: `demo_${Date.now()}`,
        clOrdId: "",
        tag: "",
        sCode: "0",
        sMsg: "Success",
      }],
    };
  }

  // Real implementation would use OKX signed API
  throw new Error("Real OKX order placement not implemented - set DRY_RUN=true");
}