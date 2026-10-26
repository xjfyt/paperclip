/** The test-run schema uniquely owns (companyId, issueId). This measures only
 * ledger rows observed for that harness issue; absence is never zero/free. */
export function recordedEvaluationCost(rows: ReadonlyArray<{ costCents: number; costStatus: string; billingType: string }>): number | null {
  if (!rows.length || rows.some(row => !Number.isFinite(row.costCents) || row.costCents < 0 || (row.costStatus !== "reported" && row.billingType !== "subscription_included"))) return null;
  const sum = rows.reduce((total, row) => total + row.costCents, 0);
  return Number.isFinite(sum) && sum <= Number.MAX_SAFE_INTEGER ? sum : null;
}
