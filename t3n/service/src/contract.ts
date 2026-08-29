import { T3nClient } from "@terminal3/t3n-sdk";

export interface ValidateTradeReq {
  asset: string;
  direction: "long" | "short";
  size_usd: number;
  price: number;
  confidence_bps: number;
}

export interface ValidateTradeResp {
  approved: boolean;
  reason: string;
  risk_params: {
    max_position_usd: number;
    max_daily_loss_usd: number;
    min_confidence_bps: number;
    max_leverage: number;
    max_daily_trades: number;
    allowed_assets: string[];
  };
}

export interface LogDecisionReq {
  asset: string;
  direction: "long" | "short";
  size_usd: number;
  price: number;
  confidence_bps: number;
  action: "validate" | "execute" | "reject";
  reason: string;
  approved: boolean;
}

export interface LogDecisionResp {
  logged: boolean;
  decision_id: string;
}

export interface DailyStats {
  date: string;
  pnl_usd: number;
  trade_count: number;
  realized_pnl_usd: number;
}

export async function validateTrade(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  req: ValidateTradeReq
): Promise<ValidateTradeResp> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "validate-trade",
    input: req,
  });
  return result as ValidateTradeResp;
}

export async function logDecision(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  req: LogDecisionReq
): Promise<LogDecisionResp> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "log-decision",
    input: req,
  });
  return result as LogDecisionResp;
}

export async function getRiskParams(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string
): Promise<ValidateTradeResp["risk_params"]> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "get-risk-params",
    input: {},
  });
  return result as ValidateTradeResp["risk_params"];
}

export async function getDailyStats(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string
): Promise<DailyStats> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "get-daily-stats",
    input: {},
  });
  return result as DailyStats;
}

export interface Mandate {
  max_size_usd: number;
  min_reserve_usd: number;
  escalation_threshold_usd: number;
  validity_end: number;
  paused: boolean;
  escalation_timeout_hours: number;
}

export interface SetMandateReq {
  max_size_usd: number;
  min_reserve_usd?: number;
  escalation_threshold_usd: number;
  validity_end?: number;
  paused?: boolean;
  escalation_timeout_hours?: number;
}

export interface Verdict {
  verdict: "allow" | "escalate" | "deny";
  reason: string;
  escalation_id?: string | null;
}

export interface ActionPlan {
  action_type: string;
  nonce: number;
  trade_params?: {
    asset: string;
    direction: "long" | "short";
    size_usd: number;
    price: number;
    confidence_bps: number;
    crash_mass?: number;
  };
}

export interface EvaluateReq {
  plan: ActionPlan;
}

export interface Escalation {
  escalation_id: string;
  action_type: string;
  size_usd: number;
  asset: string;
  requested_at: number;
  status: string;
}

export interface ExecutePlanResp {
  executed: boolean;
  approved: boolean;
  reason: string;
  decision_id?: string;
  verdict: string;
}

export async function setMandate(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  mandate: SetMandateReq
): Promise<{ stored: boolean; mandate_id: string }> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "set-mandate",
    input: {
      max_size_usd: mandate.max_size_usd,
      min_reserve_usd: mandate.min_reserve_usd ?? 100,
      escalation_threshold_usd: mandate.escalation_threshold_usd,
      validity_end: mandate.validity_end ?? 0,
      paused: mandate.paused ?? false,
      escalation_timeout_hours: mandate.escalation_timeout_hours ?? 0,
    },
  });
  return result as { stored: boolean; mandate_id: string };
}

export async function getMandate(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string
): Promise<{
  mandate_id: string;
  max_size_usd: number;
  min_reserve_usd: number;
  escalation_threshold_usd: number;
  validity_end: number;
  paused: boolean;
  escalation_timeout_hours: number;
}> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "get-mandate",
    input: {},
  });
  return result as any;
}

export async function evaluateMandate(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  plan: ActionPlan
): Promise<Verdict> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "evaluate-mandate",
    input: {
      action_type: plan.action_type,
      nonce: plan.nonce,
      trade_params: plan.trade_params,
    },
  });
  return result as Verdict;
}

export async function listEscalations(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string
): Promise<{ escalations: Escalation[] }> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "list-escalations",
    input: {},
  });
  return result as { escalations: Escalation[] };
}

export async function resolveEscalation(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  escalationId: string,
  decision: "approve" | "deny"
): Promise<{ resolved: boolean; error?: string }> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "resolve-escalation",
    input: { escalation_id: escalationId, decision },
  });
  return result as { resolved: boolean; error?: string };
}

export interface SizingReq {
  confidence_bps: number;
  nn_win_prob?: number;
  size_usd: number;
}

export interface SizingResp {
  size_usd: number;
  sweet_spot: boolean;
}

export async function computeSize(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  req: SizingReq
): Promise<SizingResp> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "compute-size",
    input: req,
  });
  return result as SizingResp;
}

export interface MlPredictResp {
  win_prob: number;
}

export async function mlPredict(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  features: number[]
): Promise<MlPredictResp> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "ml-predict",
    input: { features },
  });
  return result as MlPredictResp;
}

export async function executePlan(
  agentClient: T3nClient,
  scriptName: string,
  scriptVersion: string,
  req: {
    nonce: number;
    trade_params: {
      asset: string;
      direction: "long" | "short";
      size_usd: number;
      price: number;
      confidence_bps: number;
      crash_mass?: number;
      leverage?: number;
    };
  }
): Promise<ExecutePlanResp> {
  const result = await agentClient.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "execute-plan",
    input: req,
  });
  return result as ExecutePlanResp;
}