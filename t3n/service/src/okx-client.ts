import { Agent } from "undici";
import { Resolver } from "node:dns/promises";
import * as net from "node:net";
import * as tls from "node:tls";
import crypto from "node:crypto";

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

  const apiKey = process.env.OKX_API_KEY || "";
  const apiSecret = process.env.OKX_API_SECRET || "";
  const apiPassphrase = process.env.OKX_API_PASSPHRASE || "";

  if (!apiKey || !apiSecret || !apiPassphrase) {
    throw new Error(
      "OKX API credentials not configured. Set OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE."
    );
  }

  const ts = new Date().toISOString();
  const body = JSON.stringify({
    instId: params.instId,
    tdMode: params.tdMode,
    side: params.side,
    ordType: params.ordType,
    sz: params.sz,
    ...(params.px && { px: params.px }),
    ...(params.ccy && { ccy: params.ccy }),
  });
  const method = "POST";
  const requestPath = "/api/v5/trade/order";
  const signPayload = ts + method + requestPath + body;
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(signPayload, "utf8")
    .digest("base64");

  const response = await fetch(
    `${OKX_BASE}${requestPath}`,
    {
      dispatcher: okxAgent,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": signature,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": apiPassphrase,
      },
      body,
    } as any
  );
  const data = await response.json();
  if (data.code !== "0") {
    throw new Error(`OKX order error: ${data.msg}`);
  }
  return data;
}