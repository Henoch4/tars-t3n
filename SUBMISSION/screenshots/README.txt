Screenshots captured (PNG) from live testnet verification, Aug 29 2026.
All against contract v0.1.3 / id 793 on T3N testnet.

OLD SCREENSHOTS (kept for historical reference):

1. 01-register-version-conflict.png — register.ts: version conflict bug
2. 02-demo-risk-params-mandate.png — demo.ts: risk params, mandate, daily stats
3. 03-verify-functions-ml-predict.png — verify-new-functions.ts: 12 exports + ml-predict
4. 04-verify-functions-execute-plan.png — verify-new-functions.ts: evaluate-mandate, execute-plan
5. 05-demo-wire-format.png — demo.ts: wire format with all 12 functions
6. 06-demo-trading-cycle.png — demo.ts: trading cycle, OKX DNS failure
7. 07-demo-escalations-complete.png — demo.ts: escalations, daily stats, demo complete
8. 08-escalation-lifecycle.png — verify-escalation-lifecycle.ts: first run

NEW SCREENSHOTS (clean runs, no errors):

9. 09-escalation-lifecycle-clean.png — verify-escalation-lifecycle.ts: FULL CLEAN
   escalate 2000 USD → list-escalations (6 pending) → resolve (denied) →
   list after resolve (5 pending — resolved one dropped). NO ERRORS.

10. 10-verify-functions-12-exports-ml-predict.png — verify-new-functions.ts: all 12
    enclave exports listed, ml-predict (neutral 0.485, bullish 0.638, bearish 0.488).

11. 11-verify-functions-sizing-mandate-execute.png — verify-new-functions.ts:
    compute-size ($2500, sweet_spot=true), over-sweet-spot ($0),
    evaluate-mandate allow (700 USD) / escalate (2000 USD),
    list-escalations, execute-plan deny (low confidence) / refuse (above max).
