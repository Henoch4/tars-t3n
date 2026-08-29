use crate::common::*;
use alloc::string::ToString;
use alloc::vec::Vec;

/// Atomic execution plan: mandate check + risk-gate validation + decision
/// log all inside a single TEE invocation. If the mandate denies or
/// escalates, or the trade fails validation, the whole plan is refused —
/// nothing is logged as executed, nothing proceeds to an order.
///
/// This mirrors Liquid Protocol's "all steps succeed or revert" atomicity
/// guarantee, and Grantline's mandate gate, at the contract layer.

#[derive(serde::Deserialize)]
struct ExecutePlanReq {
    nonce: u64,
    trade_params: TradeParamsWithCrash,
}

#[derive(serde::Deserialize)]
struct TradeParamsWithCrash {
    asset: alloc::string::String,
    direction: alloc::string::String,
    size_usd: f64,
    price: f64,
    confidence_bps: u32,
    #[serde(default)]
    crash_mass: Option<f64>,
    #[serde(default)]
    leverage: Option<f64>,
}

#[cfg(target_arch = "wasm32")]
pub fn execute_plan(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    let req: ExecutePlanReq = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("execute-plan: bad input: {e}"))?;

    let tp = &req.trade_params;

    // 1. Mandate gate.
    let mandate = {
        let map_name = get_mandates_map_name()?;
        match read_kv(&map_name, "mandate_1")? {
            Some(json) => serde_json::from_str::<Mandate>(&json)
                .map_err(|e| alloc::format!("parse mandate: {e}"))?,
            None => Mandate::default(),
        }
    };
    let now = cluster_timestamp_secs()?;
    let verdict = crate::mandate::evaluate_mandate_pure(&mandate, tp.size_usd, &tp.asset, now);
    if verdict.verdict != "allow" {
        return Err(alloc::format!(
            "execute-plan: mandate {} — {}",
            verdict.verdict, verdict.reason
        ));
    }
    let _ = req.nonce; // nonce consumed; replay protection hook for a later phase

    // 2. Risk-gate validation (includes CESF crash veto).
    let vreq = ValidateTradeReq {
        asset: tp.asset.clone(),
        direction: tp.direction.clone(),
        size_usd: tp.size_usd,
        price: tp.price,
        confidence_bps: tp.confidence_bps,
        leverage: tp.leverage,
        crash_mass: tp.crash_mass,
    };
    let vbytes = serde_json::to_vec(&vreq).map_err(|e| e.to_string())?;
    let resp_bytes = crate::risk_gate::validate_trade(&vbytes)?;
    let validation: ValidateTradeResp =
        serde_json::from_slice(&resp_bytes).map_err(|e| alloc::format!("parse validation: {e}"))?;

    if !validation.approved {
        // Refuse execution; do not log as executed.
        return Ok(serde_json::to_vec(&serde_json::json!({
            "executed": false,
            "approved": false,
            "reason": validation.reason,
            "verdict": "deny",
        }))
        .map_err(|e| e.to_string())?);
    }

    // 3. Log the execution decision atomically.
    let lreq = LogDecisionReq {
        asset: tp.asset.clone(),
        direction: tp.direction.clone(),
        size_usd: tp.size_usd,
        price: tp.price,
        confidence_bps: tp.confidence_bps,
        action: "execute".to_string(),
        reason: "execute-plan: approved by TEE risk gate + mandate".to_string(),
        approved: true,
    };
    let lbytes = serde_json::to_vec(&lreq).map_err(|e| e.to_string())?;
    let log_resp_bytes = crate::decision_log::log_decision(&lbytes)?;
    let log_resp: LogDecisionResp =
        serde_json::from_slice(&log_resp_bytes).map_err(|e| alloc::format!("parse log: {e}"))?;

    Ok(serde_json::to_vec(&serde_json::json!({
        "executed": true,
        "approved": true,
        "reason": "executed under mandate + risk gate",
        "decision_id": log_resp.decision_id,
        "verdict": "allow",
    }))
    .map_err(|e| e.to_string())?)
}
