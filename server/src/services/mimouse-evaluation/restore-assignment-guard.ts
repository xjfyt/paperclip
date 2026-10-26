import { eq, sql } from "drizzle-orm";
import { companies, companySkills, type Db } from "@paperclipai/db";
import { normalizeAgentUrlKey } from "@paperclipai/shared";
import { readPaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { conflict } from "../../errors.js";

// Called inside the agent lifecycle transaction, including direct config writes,
// revision replay and hire approval. No skill service import/circular dependency.
// Company → skill locks is the common order with managed restoration. Removing
// a reference remains possible: only references in the proposed config matter.
export async function assertNoPendingRestoreAssignments(db: Db, companyId: string, config: unknown) {
  // Some internal configuration callers already hold an agent row. Never wait
  // backwards on company: fail closed and let their transaction retry instead.
  try { await db.execute(sql`select ${companies.id} from ${companies} where ${companies.id}=${companyId} for no key update nowait`); }
  catch (error) {
    const cause = error as { code?: string; cause?: { code?: string } };
    if (cause.code === "55P03" || cause.cause?.code === "55P03") throw conflict("restore_assignment_concurrent_company_mutation");
    throw error;
  }
  const desired = readPaperclipSkillSyncPreference(config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, unknown> : {}).desiredSkills;
  if (!desired.length) return;
  const skills = await db.select({ id: companySkills.id, key: companySkills.key, slug: companySkills.slug, metadata: companySkills.metadata }).from(companySkills).where(eq(companySkills.companyId, companyId));
  for (const reference of desired) {
    const trimmed = reference.trim();
    const key = trimmed.split("/").map(value => normalizeAgentUrlKey(value)).filter(Boolean).join("/");
    const exact = skills.find(skill => skill.id === trimmed) ?? skills.find(skill => skill.key === key);
    const matches = exact ? [exact] : skills.filter(skill => skill.slug === normalizeAgentUrlKey(trimmed));
    if (matches.some(skill => skill.metadata?.mimouseRestorePending)) throw conflict("restore_pending_skill_assignment");
  }
}
