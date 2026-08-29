🧵 1/8
Most "trusted" AI agents are trusted by vibes. They yell "I'm safe!" and you just... believe them. For a trading agent that moves money, that's not a risk policy, it's a hope.

So I built the safety layer where it can't be lied about.

🧵 2/8
Meet **TARS** — a trusted enterprise trading agent where the *entire risk policy lives inside a @terminal3io T3N TEE contract*.

The enclave approves or rejects every trade. The trading client physically cannot bypass it. No vibes — verified.

🧵 3/8
The safety layer runs as an unattestable-by-contract WASM component:
- `validate-trade` — allowlist, size, confidence, leverage, daily loss/count caps
- Crash veto — a >20% drawdown probability (from real OKX candles) vetoes before anything else
- `compute-size` — fractional-Kelly sizing, clamped to a sweet-spot band
- `ml-predict` — a 17→8→1 neural net *inside* the enclave (no ONNX dep)
- `execute-plan` — mandate + risk-gate + audit in ONE atomic TEE call

🧵 4/8
The part I'm proudest of: **mandate + human escalation**. Trades under your authority profile are auto-approved; above it, they raise a pending human review that auto-denies after 24h. One client can't quietly authorise above the mandate you set. Risk surfacing is built in, not bolted on.

🧵 5/8
Auditability is the point. Every approve, reject, and execute is written to the tenant KV audit trail *before* any order — collision-free `dec_<secs>_<seq>_<asset>` IDs from the host clock. Written first, traded second: if the log write fails, no trade.

🧵 6/8
And it's operator-friendly, not just secure. Risk policy is **data, not code** — tighten the allowlist, mandate, or crash threshold with a KV write, no redeploy. A forced-empty allowlist is an instant policy-only kill switch. Over-threshold trades escalate to a human.

🧵 7/8
Everything verified, nothing staged:
- 12 enclave functions LIVE on testnet (v0.1.3, id 793, ~309 KB WASM)
- 12 offline Rust unit tests pass
- Real testnet logs: ml-predict, sizing, allow/escalate, atomic execute-plan approve *and* reject
- 6 bugs found + documented, incl. a genuine `kv_store.scan` visibility bug

(I'm also joining Terminal 3's startup program + listing page to keep TARS running and distributed.)

🧵 8/8
A trusted agent's safety layer should be provable, not promised. TARS makes it the container itself.

👇
Details + docs: https://github.com/Henoch4/tars-t3n
#T3N #TrustedAgent #TEE #AITrading #Crypto #Security

---

📸 Attach these screenshots to tweet 7/8 (the "Everything verified" tweet):
1. SUBMISSION/screenshots/14-demo-trading-cycle-real-okx.png
   Shows: REAL OKX DATA — BTC at $77,985, MA5/MA20 crossover, crash mass, rejected (no signal)

2. SUBMISSION/screenshots/17-verify-functions-sizing-mandate-execute.png
   Shows: all 12 exports, ml-predict, compute-size, evaluate-mandate, execute-plan

3. SUBMISSION/screenshots/16-verify-functions-12-exports-ml-predict.png
   Shows: 12 exports listed, ml-predict (neutral 0.485, bullish 0.638, bearish 0.488)
