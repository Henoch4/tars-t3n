use crate::common::*;
use alloc::string::ToString;
use alloc::vec::Vec;

/// Determine whether the current caller is the tenant owner (Gatekeeper).
///
/// T3N exposes `calling-user-did` for session-invoked contract calls. A
/// tenant-contract owner is the tenant DID itself. When called through a
/// session the owner is identifiable; direct /dev/exec and webhook paths
/// return `None` (no session). For those paths we refuse to trust implicit
/// ownership — callers use set-mandate through the TenantClient (which the
/// host routes with the tenant's identity) so `calling-user-did` matches the
/// tenant DID. If we cannot positively resolve the owner we DENY admin
/// operations (fail-closed).
#[cfg(target_arch = "wasm32")]
fn is_owner() -> Result<bool, alloc::string::String> {
    use crate::host::tenant::tenant_context;
    let tenant_did = tenant_context::tenant_did();
    let caller = tenant_context::calling_user_did();
    match caller {
        Some(c) => Ok(c == tenant_did),
        None => Ok(false), // fail-closed: no session context => not owner
    }
}

#[cfg(target_arch = "wasm32")]
pub fn set_mandate(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    // Gatekeeper-only.
    if !is_owner()? {
        return Err("set-mandate: not authorized (must be tenant owner)".to_string());
    }

    let req: SetMandateReq = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("set-mandate: bad input: {e}"))?;

    let mandate = Mandate {
        max_size_usd: req.max_size_usd,
        min_reserve_usd: req.min_reserve_usd,
        escalation_threshold_usd: req.escalation_threshold_usd,
        validity_end: if req.validity_end == 0 {
            u64::MAX
        } else {
            req.validity_end
        },
        paused: req.paused,
        escalation_timeout_hours: if req.escalation_timeout_hours == 0 {
            24
        } else {
            req.escalation_timeout_hours
        },
    };

    let map_name = get_mandates_map_name()?;
    let json = serde_json::to_string(&mandate).map_err(|e| e.to_string())?;
    write_kv(&map_name, "mandate_1", &json)?;

    log_info(&alloc::format!(
        "set-mandate: max_size=${}, escalate_above=${}, timeout={}h",
        mandate.max_size_usd,
        mandate.escalation_threshold_usd,
        mandate.escalation_timeout_hours
    ));

    Ok(serde_json::to_vec(&serde_json::json!({
        "stored": true,
        "mandate_id": "mandate_1",
    }))
    .map_err(|e| e.to_string())?)
}

#[cfg(target_arch = "wasm32")]
pub fn get_mandate(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    let _req: serde_json::Value = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("get-mandate: bad input: {e}"))?;

    let map_name = get_mandates_map_name()?;
    let mandate = match read_kv(&map_name, "mandate_1")? {
        Some(json) => serde_json::from_str::<Mandate>(&json)
            .map_err(|e| alloc::format!("parse mandate: {e}"))?,
        None => Mandate::default(),
    };

    Ok(serde_json::to_vec(&serde_json::json!({
        "mandate_id": "mandate_1",
        "max_size_usd": mandate.max_size_usd,
        "min_reserve_usd": mandate.min_reserve_usd,
        "escalation_threshold_usd": mandate.escalation_threshold_usd,
        "validity_end": mandate.validity_end,
        "paused": mandate.paused,
        "escalation_timeout_hours": mandate.escalation_timeout_hours,
    }))
    .map_err(|e| e.to_string())?)
}

/// Pure mandate-evaluation core — no host I/O — so it is unit-testable on
/// the host target (where `tenant_context` is unavailable). The wasm
/// entrypoints load state from KV then delegate here.
#[cfg(any(target_arch = "wasm32", test))]
pub fn evaluate_mandate_pure(
    mandate: &Mandate,
    size_usd: f64,
    asset: &str,
    now: u64,
) -> Verdict {
    if mandate.paused {
        return Verdict {
            verdict: "deny".to_string(),
            reason: "Mandate is paused".to_string(),
            escalation_id: None,
        };
    }

    if now > mandate.validity_end {
        return Verdict {
            verdict: "deny".to_string(),
            reason: "Mandate expired".to_string(),
            escalation_id: None,
        };
    }

    if size_usd > mandate.max_size_usd {
        return Verdict {
            verdict: "deny".to_string(),
            reason: alloc::format!(
                "Size ${:.2} exceeds max ${:.2}",
                size_usd, mandate.max_size_usd
            ),
            escalation_id: None,
        };
    }

    if size_usd > mandate.escalation_threshold_usd {
        return Verdict {
            verdict: "escalate".to_string(),
            reason: alloc::format!(
                "Size ${:.2} above escalation threshold ${:.2}",
                size_usd, mandate.escalation_threshold_usd
            ),
            escalation_id: Some(alloc::format!("esc_pending_{}", asset)),
        };
    }

    Verdict {
        verdict: "allow".to_string(),
        reason: "Within mandate".to_string(),
        escalation_id: None,
    }
}

/// Evaluate an Action Plan against the current mandate.
/// Returns ALLOW / ESCALATE / DENY with reasoning + optional escalation id.
#[cfg(target_arch = "wasm32")]
pub fn evaluate_mandate(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    let req: EvaluateReq = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("evaluate-mandate: bad input: {e}"))?;

    let mandate = {
        let map_name = get_mandates_map_name()?;
        match read_kv(&map_name, "mandate_1")? {
            Some(json) => serde_json::from_str::<Mandate>(&json)
                .map_err(|e| alloc::format!("parse mandate: {e}"))?,
            None => Mandate::default(),
        }
    };

    // Decompose plan into a generic size for evaluation.
    let size_usd = req.plan.trade_params.as_ref().map(|t| t.size_usd).unwrap_or(0.0);
    let asset = req
        .plan
        .trade_params
        .as_ref()
        .map(|t| t.asset.clone())
        .unwrap_or_default();

    let now = cluster_timestamp_secs()?;
    let mut verdict = evaluate_mandate_pure(&mandate, size_usd, &asset, now);

    // If pure verdict is "escalate", create the real escalation row.
    if verdict.verdict == "escalate" {
        let escalation_id = create_escalation(&mandate, &req.plan.action_type, size_usd, &asset)?;
        verdict.escalation_id = Some(escalation_id);
    }

    Ok(serde_json::to_vec(&verdict).map_err(|e| e.to_string())?)
}

#[cfg(target_arch = "wasm32")]
fn create_escalation(
    mandate: &Mandate,
    action_type: &str,
    size_usd: f64,
    asset: &str,
) -> Result<alloc::string::String, alloc::string::String> {
    let now = cluster_timestamp_secs()?;
    let seq = tx_seq_no()?;
    let escalation_id = alloc::format!("esc_{}_{}", now, seq);

    let esc = Escalation {
        escalation_id: escalation_id.clone(),
        action_type: action_type.to_string(),
        size_usd,
        asset: asset.to_string(),
        requested_at: now,
        status: "pending".to_string(),
    };

    let map_name = get_escalations_map_name()?;
    let json = serde_json::to_string(&esc).map_err(|e| e.to_string())?;
    write_kv(&map_name, &escalation_id, &json)?;

    // Maintain a pending-escalations index (JSON array of ids) under a fixed
    // key. This avoids relying on kv_store::scan, which some hosts do not
    // populate for a freshly-written entry within the same visibility window.
    append_pending_index(&map_name, &escalation_id)?;

    log_info(&alloc::format!(
        "create-escalation: {} {} ${:.2} (timeout {}h)",
        escalation_id,
        action_type,
        size_usd,
        mandate.escalation_timeout_hours
    ));

    Ok(escalation_id)
}

const PENDING_INDEX_KEY: &str = "_pending_index";

#[cfg(target_arch = "wasm32")]
fn read_pending_index(map_name: &str) -> Result<Vec<alloc::string::String>, alloc::string::String> {
    match read_kv(map_name, PENDING_INDEX_KEY)? {
        Some(json) => serde_json::from_str(&json)
            .map_err(|e| alloc::format!("parse pending index: {e}")),
        None => Ok(Vec::new()),
    }
}

#[cfg(target_arch = "wasm32")]
fn write_pending_index(
    map_name: &str,
    ids: &[alloc::string::String],
) -> Result<(), alloc::string::String> {
    let json = serde_json::to_string(ids).map_err(|e| e.to_string())?;
    write_kv(map_name, PENDING_INDEX_KEY, &json)
}

#[cfg(target_arch = "wasm32")]
fn append_pending_index(map_name: &str, id: &str) -> Result<(), alloc::string::String> {
    let mut ids = read_pending_index(map_name)?;
    if !ids.iter().any(|i| i == id) {
        ids.push(id.to_string());
    }
    write_pending_index(map_name, &ids)
}

#[cfg(target_arch = "wasm32")]
fn remove_pending_index(map_name: &str, id: &str) -> Result<(), alloc::string::String> {
    let mut ids = read_pending_index(map_name)?;
    ids.retain(|i| i != id);
    write_pending_index(map_name, &ids)
}


/// Resolve a pending escalation. Owner-only. Auto-denies expired escalations.
#[cfg(target_arch = "wasm32")]
pub fn resolve_escalation(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    if !is_owner()? {
        return Err("resolve-escalation: not authorized (must be tenant owner)".to_string());
    }

    let req: ResolveEscalationReq = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("resolve-escalation: bad input: {e}"))?;

    let map_name = get_escalations_map_name()?;
    let esc_json = match read_kv(&map_name, &req.escalation_id)? {
        Some(j) => j,
        None => {
            return Err(alloc::format!(
                "resolve-escalation: unknown escalation {}",
                req.escalation_id
            ))
        }
    };
    let mut esc: Escalation =
        serde_json::from_str(&esc_json).map_err(|e| alloc::format!("parse escalation: {e}"))?;

    if esc.status != "pending" {
        return Err(alloc::format!(
            "resolve-escalation: {} already {}",
            req.escalation_id, esc.status
        ));
    }

    // Auto-deny if older than escalation timeout.
    let now = cluster_timestamp_secs()?;
    let mandate = {
        let mname = get_mandates_map_name()?;
        match read_kv(&mname, "mandate_1")? {
            Some(j) => serde_json::from_str::<Mandate>(&j)
                .map_err(|e| alloc::format!("parse mandate: {e}"))?,
            None => Mandate::default(),
        }
    };
    let timeout_secs = (mandate.escalation_timeout_hours as u64) * 3600;
    let expired = now.saturating_sub(esc.requested_at) > timeout_secs;

    let final_decision = if expired {
        "deny"
    } else if req.decision == "approve" {
        "approve"
    } else {
        "deny"
    };

    esc.status = if final_decision == "approve" {
        "approved".to_string()
    } else {
        "denied".to_string()
    };
    let esc_json = serde_json::to_string(&esc).map_err(|e| e.to_string())?;
    write_kv(&map_name, &req.escalation_id, &esc_json)?;
    remove_pending_index(&map_name, &req.escalation_id)?;

    log_info(&alloc::format!(
        "resolve-escalation: {} -> {} (expired={})",
        req.escalation_id, final_decision, expired
    ));

    Ok(serde_json::to_vec(&serde_json::json!({
        "resolved": true,
        "verdict": final_decision,
    }))
    .map_err(|e| e.to_string())?)
}

/// List pending escalations for this tenant.
#[cfg(target_arch = "wasm32")]
pub fn list_escalations(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    let _req: serde_json::Value = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("list-escalations: bad input: {e}"))?;

    let map_name = get_escalations_map_name()?;
    let index_ids = read_pending_index(&map_name)?;

    let mut pending: Vec<serde_json::Value> = Vec::new();
    for id in index_ids {
        let esc_json = match read_kv(&map_name, &id)? {
            Some(j) => j,
            None => continue,
        };
        if let Ok(esc) = serde_json::from_str::<Escalation>(&esc_json) {
            if esc.status == "pending" {
                pending.push(serde_json::json!({
                    "escalation_id": esc.escalation_id,
                    "action_type": esc.action_type,
                    "size_usd": esc.size_usd,
                    "asset": esc.asset,
                    "requested_at": esc.requested_at,
                }));
            }
        }
    }

    Ok(serde_json::to_vec(&serde_json::json!({ "escalations": pending }))
        .map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_mandate() -> Mandate {
        Mandate {
            max_size_usd: 5000.0,
            min_reserve_usd: 100.0,
            escalation_threshold_usd: 1000.0,
            validity_end: u64::MAX,
            paused: false,
            escalation_timeout_hours: 24,
        }
    }

    #[test]
    fn allows_within_mandate() {
        let v = evaluate_mandate_pure(&base_mandate(), 500.0, "BTC-USDT-SWAP", 1_000_000);
        assert_eq!(v.verdict, "allow");
    }

    #[test]
    fn escalates_above_threshold() {
        let v = evaluate_mandate_pure(&base_mandate(), 2000.0, "BTC-USDT-SWAP", 1_000_000);
        assert_eq!(v.verdict, "escalate");
        assert!(v.escalation_id.is_some());
    }

    #[test]
    fn denies_above_max() {
        let v = evaluate_mandate_pure(&base_mandate(), 9000.0, "BTC-USDT-SWAP", 1_000_000);
        assert_eq!(v.verdict, "deny");
    }

    #[test]
    fn denies_when_paused() {
        let mut m = base_mandate();
        m.paused = true;
        let v = evaluate_mandate_pure(&m, 1.0, "BTC-USDT-SWAP", 1_000_000);
        assert_eq!(v.verdict, "deny");
    }

    #[test]
    fn denies_when_expired() {
        let mut m = base_mandate();
        m.validity_end = 1000;
        let v = evaluate_mandate_pure(&m, 1.0, "BTC-USDT-SWAP", 2000);
        assert_eq!(v.verdict, "deny");
    }
}
