Screenshots captured (PNG) from live testnet verification, Aug 29 2026.
All against contract v0.1.3 / id 793 on T3N testnet.

1. contract-register.png      — `npx tsx src/register.ts` output: tenant DID,
   WASM size 308953, expected "version not higher" error (contract already live)

2. verify-new-1.png           — `npx tsx src/verify-new-functions.ts` (first half):
   Wire format with all 12 functions listed, agent DID, ml-predict neutral/
   bullish/bearish P(win), compute-size 2500 sweet_spot=true

3. verify-new-2.png           — verify-new-functions.ts (second half):
   compute-size over-sweet-spot=0, evaluate-mandate allow/escalate, list-
   escalations with accumulated entries, execute-plan deny/refuse, resolve
   (fuel_per_minute quota — expected on long runs)

4. escalation-lifecycle.png   — `npx tsx src/verify-escalation-lifecycle.ts`:
   escalate 2000 USD, list-escalations (5 pending), resolve (denied), list
   after resolve (4 pending — resolved one dropped)

5. demo-1.png                 — `npx tsx src/demo.ts` (first half): tenant/agent
   DIDs, Risk Parameters JSON, Mandate JSON, Daily Stats

6. demo-2.png                 — demo.ts (second half): OKX ENOTFOUND error
   (expected — fail-safe "no signal" → REJECTED), Pending Escalations list,
   Updated Daily Stats, Demo Complete
