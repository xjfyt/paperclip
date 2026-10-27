import { sql } from "drizzle-orm";
import type { CompanyDeletionParticipant } from "../lib/company-deletion.js";

type Transaction = Parameters<CompanyDeletionParticipant["deleteCompanyData"]>[0];

/** Internal lifecycle context, NOT caller authorization. Set only after the company lock. */
export async function beginCompanyDeletionContext(tx: Transaction, companyId: string) {
  if (!("nestedIndex" in tx)) throw new Error("Company deletion requires a database transaction");
  // Local settings roll back/expire with this transaction. The xid also rejects
  // stale session settings; deferred DB guards require actual company removal.
  await tx.execute(sql`select
    set_config('paperclip.company_delete_id', ${companyId}::uuid::text, true),
    set_config('paperclip.company_delete_xid', txid_current()::text, true)`);
}
