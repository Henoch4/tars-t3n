#[cfg(target_arch = "wasm32")]
use crate::host::{
    interfaces::{kv_store, logging},
    tenant::tenant_context,
};

#[cfg(target_arch = "wasm32")]
pub fn get_secrets_map_name() -> Result<alloc::string::String, alloc::string::String> {
    let tid = tenant_context::tenant_did();
    Ok(alloc::format!("z:{}:secrets", hex::encode(&tid)))
}

#[cfg(target_arch = "wasm32")]
pub fn get_decisions_map_name() -> Result<alloc::string::String, alloc::string::String> {
    let tid = tenant_context::tenant_did();
    Ok(alloc::format!("z:{}:decisions", hex::encode(&tid)))
}

#[cfg(target_arch = "wasm32")]
pub fn get_daily_stats_map_name() -> Result<alloc::string::String, alloc::string::String> {
    let tid = tenant_context::tenant_did();
    Ok(alloc::format!("z:{}:daily-stats", hex::encode(&tid)))
}

#[cfg(target_arch = "wasm32")]
pub fn read_secret(key: &str) -> Result<alloc::string::String, alloc::string::String> {
    let map_name = get_secrets_map_name()?;
    let bytes = kv_store::get(&map_name, key.as_bytes())
        .map_err(|e| alloc::format!("kv read: {e}"))?
        .ok_or(alloc::format!("{} not found in secrets map", key))?;
    alloc::string::String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
pub fn write_kv(map_name: &str, key: &str, value: &str) -> Result<(), alloc::string::String> {
    kv_store::put(&map_name, key.as_bytes(), value.as_bytes())
        .map_err(|e| alloc::format!("kv write: {e}"))
}

#[cfg(target_arch = "wasm32")]
pub fn read_kv(map_name: &str, key: &str) -> Result<Option<alloc::string::String>, alloc::string::String> {
    let bytes = kv_store::get(map_name, key.as_bytes())
        .map_err(|e| alloc::format!("kv read: {e}"))?;
    Ok(bytes.map(|b| alloc::string::String::from_utf8(b).map_err(|e| e.to_string())).transpose()?)
}

#[cfg(target_arch = "wasm32")]
pub fn log_info(msg: &str) {
    let _ = logging::info(msg);
}

#[cfg(target_arch = "wasm32")]
pub fn log_error(msg: &str) {
    let _ = logging::error(msg);
}

#[cfg(target_arch = "wasm32")]
pub fn cluster_timestamp_secs() -> Result<u64, alloc::string::String> {
    Ok(tenant_context::cluster_timestamp_secs())
}

#[cfg(target_arch = "wasm32")]
pub fn tx_seq_no() -> Result<u64, alloc::string::String> {
    Ok(tenant_context::seq_no())
}

/// Convert a Unix epoch timestamp (seconds) to a `YYYY-MM-DD` UTC date string.
///
/// Uses Howard Hinnant's `civil_from_days` algorithm — no chrono dependency
/// (no_std + alloc only).
#[cfg(target_arch = "wasm32")]
pub fn epoch_secs_to_date(secs: u64) -> alloc::string::String {
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097); // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    alloc::format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Today's UTC date (`YYYY-MM-DD`) from the host cluster clock.
#[cfg(target_arch = "wasm32")]
pub fn get_today_date() -> Result<alloc::string::String, alloc::string::String> {
    let secs = cluster_timestamp_secs()?;
    Ok(epoch_secs_to_date(secs))
}

/// Current UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`) from the host cluster clock.
#[cfg(target_arch = "wasm32")]
pub fn get_timestamp_iso() -> Result<alloc::string::String, alloc::string::String> {
    let secs = cluster_timestamp_secs()?;
    let date = epoch_secs_to_date(secs);
    let sod = (secs % 86_400) as u32;
    Ok(alloc::format!(
        "{}T{:02}:{:02}:{:02}Z",
        date,
        sod / 3_600,
        (sod % 3_600) / 60,
        sod % 60
    ))
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct RiskParams {
    pub max_position_usd: f64,
    pub max_daily_loss_usd: f64,
    pub min_confidence_bps: u32,
    pub max_leverage: f64,
    pub max_daily_trades: u32,
    pub allowed_assets: alloc::vec::Vec<alloc::string::String>,
    /// CESF-style crash veto: reject when `crash_mass` (probability of a
    /// >20% drawdown over the horizon) exceeds this many bps (default 2000 = 20%).
    pub crash_veto_threshold_bps: u32,
    /// Fractional Kelly caps for position sizing (Phase 2).
    #[serde(default = "default_min_implied_prob")]
    pub min_implied_prob: f64,
    #[serde(default = "default_max_implied_prob")]
    pub max_implied_prob: f64,
    #[serde(default = "default_kelly_fraction_cap")]
    pub kelly_fraction_cap: f64,
    #[serde(default = "default_equity_usd")]
    pub equity_usd: f64,
    #[serde(default = "default_avg_reward_risk_ratio")]
    pub avg_reward_risk_ratio: f64,
}

fn default_min_implied_prob() -> f64 {
    0.44
}
fn default_max_implied_prob() -> f64 {
    0.62
}
fn default_kelly_fraction_cap() -> f64 {
    0.25
}
fn default_equity_usd() -> f64 {
    10_000.0
}
fn default_avg_reward_risk_ratio() -> f64 {
    1.5
}

impl Default for RiskParams {
    fn default() -> Self {
        Self {
            max_position_usd: 5000.0,
            max_daily_loss_usd: 500.0,
            min_confidence_bps: 7000,
            max_leverage: 5.0,
            max_daily_trades: 10,
            allowed_assets: alloc::vec![
                "BTC-USDT-SWAP".to_string(),
                "ETH-USDT-SWAP".to_string(),
                "SOL-USDT-SWAP".to_string(),
                "BNB-USDT-SWAP".to_string(),
            ],
            crash_veto_threshold_bps: 2000,
            min_implied_prob: 0.44,
            max_implied_prob: 0.62,
            kelly_fraction_cap: 0.25,
            equity_usd: 10_000.0,
            avg_reward_risk_ratio: 1.5,
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub fn load_risk_params() -> Result<RiskParams, alloc::string::String> {
    let json_str = read_secret("risk_params")?;
    serde_json::from_str(&json_str)
        .map_err(|e| alloc::format!("parse risk_params: {e}"))
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ValidateTradeReq {
    pub asset: alloc::string::String,
    pub direction: alloc::string::String,
    pub size_usd: f64,
    pub price: f64,
    pub confidence_bps: u32,
    /// Requested leverage. Defaults to 1.0 (no leverage) when omitted,
    /// enforced against `RiskParams::max_leverage` in `validate_trade`.
    #[serde(default)]
    pub leverage: Option<f64>,
    /// CESF crash-mass estimate (probability of a >20% drawdown over the
    /// horizon, 0.0..1.0). Vetoed when it exceeds crash_veto_threshold_bps.
    #[serde(default)]
    pub crash_mass: Option<f64>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ValidateTradeResp {
    pub approved: bool,
    pub reason: alloc::string::String,
    pub risk_params: RiskParams,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct LogDecisionReq {
    pub asset: alloc::string::String,
    pub direction: alloc::string::String,
    pub size_usd: f64,
    pub price: f64,
    pub confidence_bps: u32,
    pub action: alloc::string::String,
    pub reason: alloc::string::String,
    pub approved: bool,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct LogDecisionResp {
    pub logged: bool,
    pub decision_id: alloc::string::String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct DailyStats {
    pub date: alloc::string::String,
    pub pnl_usd: f64,
    pub trade_count: u32,
    pub realized_pnl_usd: f64,
}

/// Owner-defined authority profile. Mirrors Grantline's Mandate.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct Mandate {
    /// Largest single trade / transfer the agent may authorise automatically.
    pub max_size_usd: f64,
    /// Minimum reserve that must remain in the controlled account.
    pub min_reserve_usd: f64,
    /// Above this size the action must be escalated to a human reviewer.
    pub escalation_threshold_usd: f64,
    /// Unix epoch seconds after which the mandate is invalid.
    pub validity_end: u64,
    /// When true, no actions are authorised.
    pub paused: bool,
    /// Escalations older than this many hours auto-deny.
    pub escalation_timeout_hours: u32,
}

impl Default for Mandate {
    fn default() -> Self {
        Self {
            max_size_usd: 5000.0,
            min_reserve_usd: 100.0,
            escalation_threshold_usd: 1000.0,
            validity_end: u64::MAX,
            paused: false,
            escalation_timeout_hours: 24,
        }
    }
}

/// A proposed action the agent wants to perform.
#[derive(serde::Deserialize)]
pub struct ActionPlan {
    pub action_type: alloc::string::String, // "trade" | "transfer"
    /// Replay protection: must be greater than the last recorded nonce.
    pub nonce: u64,
    #[serde(default)]
    pub trade_params: Option<TradeParams>,
}

#[derive(serde::Deserialize)]
pub struct TradeParams {
    pub asset: alloc::string::String,
    pub direction: alloc::string::String,
    pub size_usd: f64,
    pub price: f64,
    pub confidence_bps: u32,
}

/// Verdict of a mandate evaluation.
#[derive(serde::Serialize)]
pub struct Verdict {
    pub verdict: alloc::string::String, // "allow" | "escalate" | "deny"
    pub reason: alloc::string::String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escalation_id: Option<alloc::string::String>,
}

/// A pending human-review escalation.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct Escalation {
    pub escalation_id: alloc::string::String,
    pub action_type: alloc::string::String,
    pub size_usd: f64,
    pub asset: alloc::string::String,
    pub requested_at: u64,
    pub status: alloc::string::String, // "pending" | "approved" | "denied"
}

/// Used for set-mandate input (kept separate so we can enforce ownership).
#[derive(serde::Deserialize)]
pub struct SetMandateReq {
    pub max_size_usd: f64,
    pub min_reserve_usd: f64,
    pub escalation_threshold_usd: f64,
    #[serde(default)]
    pub validity_end: u64,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub escalation_timeout_hours: u32,
}

/// Used for resolve-escalation input.
#[derive(serde::Deserialize)]
pub struct ResolveEscalationReq {
    pub escalation_id: alloc::string::String,
    pub decision: alloc::string::String, // "approve" | "deny"
}

/// Used for evaluate-mandate input.
#[derive(serde::Deserialize)]
pub struct EvaluateReq {
    #[serde(flatten)]
    pub plan: ActionPlan,
}

#[cfg(target_arch = "wasm32")]
pub fn get_mandates_map_name() -> Result<alloc::string::String, alloc::string::String> {
    let tid = tenant_context::tenant_did();
    Ok(alloc::format!("z:{}:mandates", hex::encode(&tid)))
}

#[cfg(target_arch = "wasm32")]
pub fn get_escalations_map_name() -> Result<alloc::string::String, alloc::string::String> {
    let tid = tenant_context::tenant_did();
    Ok(alloc::format!("z:{}:escalations", hex::encode(&tid)))
}