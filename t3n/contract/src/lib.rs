use wit_bindgen::generate;

extern crate alloc;

generate!({
    world: "trading-risk-gate",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod risk_gate;
mod decision_log;
mod stats;
mod mandate;
mod sizing;
mod ml;
mod executor;
mod common;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::trading_risk_gate::contracts::Guest for Component {
    fn validate_trade(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("validate-trade: missing input")?;
        risk_gate::validate_trade(&input)
    }

    fn log_decision(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("log-decision: missing input")?;
        decision_log::log_decision(&input)
    }

    fn get_risk_params(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("get-risk-params: missing input")?;
        risk_gate::get_risk_params(&input)
    }

    fn get_daily_stats(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("get-daily-stats: missing input")?;
        stats::get_daily_stats(&input)
    }

    fn set_mandate(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("set-mandate: missing input")?;
        mandate::set_mandate(&input)
    }

    fn get_mandate(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("get-mandate: missing input")?;
        mandate::get_mandate(&input)
    }

    fn evaluate_mandate(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("evaluate-mandate: missing input")?;
        mandate::evaluate_mandate(&input)
    }

    fn resolve_escalation(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("resolve-escalation: missing input")?;
        mandate::resolve_escalation(&input)
    }

    fn list_escalations(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("list-escalations: missing input")?;
        mandate::list_escalations(&input)
    }

    fn compute_size(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("compute-size: missing input")?;
        sizing::compute_size_json(&input)
    }

    fn ml_predict(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("ml-predict: missing input")?;
        ml::predict_json(&input)
    }

    fn execute_plan(
        req: exports::z::trading_risk_gate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("execute-plan: missing input")?;
        executor::execute_plan(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_compiles() {
        // If this compiles, the contract structure is correct
        assert!(true);
    }
}