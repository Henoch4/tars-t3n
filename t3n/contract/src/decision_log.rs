use crate::common::*;
use alloc::string::ToString;

#[cfg(target_arch = "wasm32")]
pub fn log_decision(input: &[u8]) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
    let req: LogDecisionReq = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("log-decision: bad input: {e}"))?;

    let decisions_map = get_decisions_map_name()?;

    // Generate a unique decision ID using the host cluster clock + tx sequence
    // number (seq-no is monotonic per tx scope, so IDs never collide).
    let now_secs = cluster_timestamp_secs()?;
    let seq = tx_seq_no()?;
    let decision_id = alloc::format!(
        "dec_{}_{}_{}",
        now_secs,
        seq,
        req.asset.replace("-", "_")
    );

    // Create the decision record
    let decision_record = serde_json::json!({
        "decision_id": decision_id,
        "timestamp": get_timestamp_iso()?,
        "asset": req.asset,
        "direction": req.direction,
        "size_usd": req.size_usd,
        "price": req.price,
        "confidence_bps": req.confidence_bps,
        "action": req.action,
        "reason": req.reason,
        "approved": req.approved,
    });

    let record_json = serde_json::to_string(&decision_record)
        .map_err(|e| alloc::format!("serialize decision: {e}"))?;

    // Write to decisions KV map
    write_kv(&decisions_map, &decision_id, &record_json)?;

    // Also update daily stats
    update_daily_stats(&req)?;

    log_info(&alloc::format!(
        "Logged decision: {} {} {} ${:.2} @ {} ({})",
        decision_id, req.action, req.direction, req.size_usd, req.price,
        if req.approved { "approved" } else { "rejected" }
    ));

    Ok(serde_json::to_vec(&LogDecisionResp {
        logged: true,
        decision_id,
    }).map_err(|e| e.to_string())?)
}

#[cfg(target_arch = "wasm32")]
fn update_daily_stats(req: &LogDecisionReq) -> Result<(), alloc::string::String> {
    let stats_map = get_daily_stats_map_name()?;
    let today = get_today_date()?;

    let mut stats = match read_kv(&stats_map, &today)? {
        Some(json) => serde_json::from_str::<DailyStats>(&json)
            .map_err(|e| alloc::format!("parse daily stats: {e}"))?,
        None => DailyStats {
            date: today.clone(),
            pnl_usd: 0.0,
            trade_count: 0,
            realized_pnl_usd: 0.0,
        },
    };

    // Only update stats for execute actions (actual trades)
    if req.action == "execute" && req.approved {
        stats.trade_count += 1;
        // Realized P&L is fed back from fill receipts (recordExecution /
        // reconcile step); the gate's daily-loss check reads realized_pnl_usd.
    }

    let stats_json = serde_json::to_string(&stats)
        .map_err(|e| alloc::format!("serialize daily stats: {e}"))?;
    write_kv(&stats_map, &today, &stats_json)?;

    Ok(())
}