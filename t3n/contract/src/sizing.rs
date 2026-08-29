use crate::common::*;
use alloc::string::ToString;
use alloc::vec::Vec;

/// Fraccional Kelly position sizing with an asymmetric sweet-spot band
/// (borrowed from Zinger Core's `minPrice`/`maxPrice` filter).
///
/// - Kelly fraction: `f = p - q/b` where `p = win_prob`, `q = 1-p`,
///   `b = avg_reward/risk` (reward:risk ratio).
/// - The win probability is taken from the agent's confidence
///   (`confidence_bps / 10000`), optionally blended with the tiny-NN score.
/// - A negative Kelly (edge ≤ 0) returns 0 (no position).
/// - The implied probability `p` must fall within `[min_implied_prob,
///   max_implied_prob]` (the sweet spot); outside it we refuse to size
///   (returns 0) to avoid chasing extreme pricing.
/// - Result is scaled by `min(p, kelly_fraction_cap)` and capped at
///   `max_position_usd`.

pub struct SizingInput {
    pub confidence_bps: u32,
    /// Optional ML win-prob in 0..1 from the in-TEE tiny NN (Phase 2).
    pub nn_win_prob: Option<f64>,
    pub size_usd: f64,
    pub risk_params: RiskParams,
}

/// Returns the approved position size in USD (0 = no position).
#[cfg(any(target_arch = "wasm32", test))]
pub fn compute_size(input: SizingInput) -> f64 {
    let p = {
        // Blend confidence and optional NN score (simple average when both
        // present; confidence otherwise). Clamp to (0,1).
        let base = (input.confidence_bps as f64) / 10_000.0;
        match input.nn_win_prob {
            Some(nn) => {
                let nn = nn.clamp(0.0, 1.0);
                (nn + base) / 2.0
            }
            None => base,
        }
    };

    // Sweet-spot band check (Zinger asymmetric filter).
    if p < input.risk_params.min_implied_prob || p > input.risk_params.max_implied_prob {
        return 0.0;
    }

    // Kelly: f = p - q / b ; b = reward:risk ratio.
    let b = input.risk_params.avg_reward_risk_ratio.max(1e-6);
    let q = (1.0 - p).max(0.0);
    let kelly = p - q / b;

    if kelly <= 0.0 {
        return 0.0;
    }

    // Fractional Kelly with a hard cap on the fraction.
    let frac = kelly.min(input.risk_params.kelly_fraction_cap);
    let sized = frac * input.risk_params.equity_usd;

    // Cap at max position size (per-order).
    let approved = sized.min(input.risk_params.max_position_usd);

    // Hard floor: the requested size must not exceed the approved amount.
    if input.size_usd > approved {
        approved
    } else {
        input.size_usd
    }
}

/// Convenience wrapper that returns a JSON-friendly result.
#[cfg(target_arch = "wasm32")]
pub fn compute_size_json(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    #[derive(serde::Deserialize)]
    struct Req {
        #[serde(default)]
        confidence_bps: u32,
        #[serde(default)]
        nn_win_prob: Option<f64>,
        #[serde(default)]
        size_usd: f64,
    }

    let req: Req = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("compute-size: bad input: {e}"))?;
    let risk_params = load_risk_params()?;
    let approved = compute_size(SizingInput {
        confidence_bps: req.confidence_bps,
        nn_win_prob: req.nn_win_prob,
        size_usd: req.size_usd,
        risk_params,
    });

    Ok(serde_json::to_vec(&serde_json::json!({
        "size_usd": approved,
        "sweet_spot": approved > 0.0,
    }))
    .map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> RiskParams {
        RiskParams {
            max_position_usd: 5000.0,
            max_daily_loss_usd: 500.0,
            min_confidence_bps: 7000,
            max_leverage: 5.0,
            max_daily_trades: 10,
            allowed_assets: alloc::vec![alloc::string::String::from("BTC-USDT-SWAP")],
            crash_veto_threshold_bps: 2000,
            min_implied_prob: 0.44,
            max_implied_prob: 0.62,
            kelly_fraction_cap: 0.25,
            equity_usd: 10_000.0,
            avg_reward_risk_ratio: 1.5,
        }
    }

    #[test]
    fn sizes_within_cap() {
        let size = compute_size(SizingInput {
            confidence_bps: 5500,
            nn_win_prob: None,
            size_usd: 4000.0,
            risk_params: params(),
        });
        assert!((size - 2500.0).abs() < 1.0);
    }

    #[test]
    fn returns_zero_outside_sweet_spot() {
        let size = compute_size(SizingInput {
            confidence_bps: 9000,
            nn_win_prob: None,
            size_usd: 1000.0,
            risk_params: params(),
        });
        assert_eq!(size, 0.0);
    }

    #[test]
    fn respects_requested_size_when_smaller() {
        let size = compute_size(SizingInput {
            confidence_bps: 5500,
            nn_win_prob: None,
            size_usd: 500.0,
            risk_params: params(),
        });
        assert!((size - 500.0).abs() < 1.0);
    }

    #[test]
    fn blends_nn_score() {
        let size = compute_size(SizingInput {
            confidence_bps: 5000,
            nn_win_prob: Some(0.70),
            size_usd: 1000.0,
            risk_params: params(),
        });
        assert!(size > 0.0);
    }
}
