use crate::common::*;
use alloc::string::ToString;

#[cfg(target_arch = "wasm32")]
pub fn get_daily_stats(input: &[u8]) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
    let _req: serde_json::Value = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("get-daily-stats: bad input: {e}"))?;

    let stats_map = get_daily_stats_map_name()?;
    let today = get_today_date()?;

    let stats = match read_kv(&stats_map, &today)? {
        Some(json) => serde_json::from_str::<DailyStats>(&json)
            .map_err(|e| alloc::format!("parse daily stats: {e}"))?,
        None => DailyStats {
            date: today.clone(),
            pnl_usd: 0.0,
            trade_count: 0,
            realized_pnl_usd: 0.0,
        },
    };

    Ok(serde_json::to_vec(&stats).map_err(|e| e.to_string())?)
}