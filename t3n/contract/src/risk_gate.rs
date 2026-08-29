use crate::common::*;
use alloc::string::ToString;

#[cfg(target_arch = "wasm32")]
pub fn validate_trade(input: &[u8]) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
    let req: ValidateTradeReq = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("validate-trade: bad input: {e}"))?;

    let risk_params = load_risk_params()?;

    // CESF-style crash veto first (fail-fast on tail risk).
    if let Some(cm) = req.crash_mass {
        let threshold = (risk_params.crash_veto_threshold_bps as f64) / 10_000.0;
        if cm >= threshold {
            let reason = alloc::format!(
                "Crash veto: crash_mass={:.4} above threshold {:.4}",
                cm, threshold
            );
            log_error(&reason);
            return Ok(serde_json::to_vec(&ValidateTradeResp {
                approved: false,
                reason,
                risk_params,
            }).map_err(|e| e.to_string())?);
        }
    }

    // Check asset allowlist
    if !risk_params.allowed_assets.contains(&req.asset) {
        let reason = alloc::format!("Asset {} not in allowed list", req.asset);
        log_error(&reason);
        return Ok(serde_json::to_vec(&ValidateTradeResp {
            approved: false,
            reason,
            risk_params,
        }).map_err(|e| e.to_string())?);
    }

    // Check position size limit
    if req.size_usd > risk_params.max_position_usd {
        let reason = alloc::format!(
            "Position size ${:.2} exceeds max ${:.2}",
            req.size_usd, risk_params.max_position_usd
        );
        log_error(&reason);
        return Ok(serde_json::to_vec(&ValidateTradeResp {
            approved: false,
            reason,
            risk_params,
        }).map_err(|e| e.to_string())?);
    }

    // Check minimum confidence
    if req.confidence_bps < risk_params.min_confidence_bps {
        let reason = alloc::format!(
            "Confidence {}bps below minimum {}bps",
            req.confidence_bps, risk_params.min_confidence_bps
        );
        log_error(&reason);
        return Ok(serde_json::to_vec(&ValidateTradeResp {
            approved: false,
            reason,
            risk_params,
        }).map_err(|e| e.to_string())?);
    }

    // Check leverage limit (defaults to 1.0 — spot/no leverage — if unspecified)
    let leverage = req.leverage.unwrap_or(1.0);
    if leverage > risk_params.max_leverage {
        let reason = alloc::format!(
            "Leverage {:.2}x exceeds max {:.2}x",
            leverage, risk_params.max_leverage
        );
        log_error(&reason);
        return Ok(serde_json::to_vec(&ValidateTradeResp {
            approved: false,
            reason,
            risk_params,
        }).map_err(|e| e.to_string())?);
    }

    // Check daily loss limit (from daily stats)
    let today = get_today_date()?;
    let stats_map = get_daily_stats_map_name()?;
    if let Ok(Some(stats_json)) = read_kv(&stats_map, &today) {
        if let Ok(stats) = serde_json::from_str::<DailyStats>(&stats_json) {
            if stats.realized_pnl_usd <= -risk_params.max_daily_loss_usd {
                let reason = alloc::format!(
                    "Daily loss ${:.2} exceeds limit ${:.2}",
                    -stats.realized_pnl_usd, risk_params.max_daily_loss_usd
                );
                log_error(&reason);
                return Ok(serde_json::to_vec(&ValidateTradeResp {
                    approved: false,
                    reason,
                    risk_params,
                }).map_err(|e| e.to_string())?);
            }
        }
    }

    // Check daily trade count limit
    if let Ok(Some(stats_json)) = read_kv(&stats_map, &today) {
        if let Ok(stats) = serde_json::from_str::<DailyStats>(&stats_json) {
            if stats.trade_count >= risk_params.max_daily_trades {
                let reason = alloc::format!(
                    "Daily trade count {} exceeds limit {}",
                    stats.trade_count, risk_params.max_daily_trades
                );
                log_error(&reason);
                return Ok(serde_json::to_vec(&ValidateTradeResp {
                    approved: false,
                    reason,
                    risk_params,
                }).map_err(|e| e.to_string())?);
            }
        }
    }

    // All checks passed
    let reason = "Trade approved".to_string();
    log_info(&alloc::format!(
        "Trade approved: {} {} ${:.2} @ {} ({}bps)",
        req.direction, req.asset, req.size_usd, req.price, req.confidence_bps
    ));

    Ok(serde_json::to_vec(&ValidateTradeResp {
        approved: true,
        reason,
        risk_params,
    }).map_err(|e| e.to_string())?)
}

#[cfg(target_arch = "wasm32")]
pub fn get_risk_params(_input: &[u8]) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
    let risk_params = load_risk_params()?;
    Ok(serde_json::to_vec(&risk_params).map_err(|e| e.to_string())?)
}