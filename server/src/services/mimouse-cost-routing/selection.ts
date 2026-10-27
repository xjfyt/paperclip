import type { RuntimeRoutingCandidateSnapshot } from "@paperclipai/shared/runtime-cost-routing";
import { unprocessable } from "../../errors.js";
/** The threshold is a decimal policy value; money never passes through Number. */
function decimalRatio(value: number): [bigint, bigint] {
  const [coefficient, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = coefficient!.split(".");
  const scale = fraction.length - Number(exponent);
  const integer = BigInt(`${whole}${fraction}`);
  return scale < 0 ? [integer * 10n ** BigInt(-scale), 1n] : [integer, 10n ** BigInt(scale)];
}
export function runtimeRoutingQualityEligible(candidate: RuntimeRoutingCandidateSnapshot, minimumPassRate: number) {
  const [numerator, denominator] = decimalRatio(minimumPassRate);
  return BigInt(candidate.evidence.passedCases) * denominator >= BigInt(candidate.evidence.totalCases) * numerator;
}
const units = (value: string) => BigInt(value.replace(".", ""));
const stable = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Validated own-candidate settled costs, then quality, then stable identity. */
export function selectRuntimeRoutingCandidate(candidates: RuntimeRoutingCandidateSnapshot[], minimumPassRate: number) {
  const eligible = candidates.filter(candidate => runtimeRoutingQualityEligible(candidate, minimumPassRate));
  eligible.sort((a, b) => {
    const cost = units(a.evidence.observedCostCents) - units(b.evidence.observedCostCents);
    if (cost) return cost < 0n ? -1 : 1;
    const quality = BigInt(a.evidence.passedCases) * BigInt(b.evidence.totalCases) - BigInt(b.evidence.passedCases) * BigInt(a.evidence.totalCases);
    return quality ? quality > 0n ? -1 : 1 : stable(a.candidate.agentId, b.candidate.agentId) || stable(a.candidate.applicationId, b.candidate.applicationId);
  });
  if (!eligible[0]) throw unprocessable("runtime_routing_no_eligible_candidate");
  return eligible[0];
}
