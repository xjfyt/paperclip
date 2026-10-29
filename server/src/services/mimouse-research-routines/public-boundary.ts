/** Publicness is a property of the real source graph, not a fake principal's ACL.
 * The caller additionally checks privacy access for the actual actor and locks
 * every loaded row until its binding/report transaction finishes. */
export interface PublicResearchIssue {
  id: string; companyId: string; visibility: string; projectId: string | null;
  parentId: string | null; privacyParentIssueId: string | null; privacyRootIssueId: string | null;
}
export interface PublicResearchProject { id: string; companyId: string; visibility: string }
export async function isCompanyOpenResearchBoundary<I extends PublicResearchIssue, P extends PublicResearchProject>(
  input: { companyId: string; projectId?: string | null; issueId?: string | null; parentIssueId?: string | null },
  reader: { issue(id: string): Promise<I | null>; project(id: string): Promise<P | null>;
    onTraversalLimit?(): void; canReadIssue(issue: I): Promise<boolean>; canReadProject(project: P): Promise<boolean> },
): Promise<boolean> {
  const checkedIssues = new Set<string>(), checkedProjects = new Set<string>();
  let visited = 0;
  async function project(id: string | null | undefined): Promise<boolean> {
    if (!id || checkedProjects.has(id)) return true;
    const row = await reader.project(id);
    if (!row || row.id !== id || row.companyId !== input.companyId || row.visibility !== "open" || !await reader.canReadProject(row)) return false;
    checkedProjects.add(id); return true;
  }
  async function issue(id: string | null | undefined, path = new Set<string>()): Promise<boolean> {
    if (!id) return true;
    if (path.has(id)) return false; // Historical cycle is not evidence of a public boundary.
    if (checkedIssues.has(id)) return true;
    if (++visited > 128) { reader.onTraversalLimit?.(); return false; }
    const row = await reader.issue(id);
    if (!row || row.id !== id || row.companyId !== input.companyId || row.visibility !== "open"
      || row.privacyRootIssueId !== null || !await reader.canReadIssue(row) || !await project(row.projectId)) return false;
    const nextPath = new Set(path).add(id);
    if (!await issue(row.parentId, nextPath) || !await issue(row.privacyParentIssueId, nextPath)) return false;
    checkedIssues.add(id); return true;
  }
  return await project(input.projectId) && await issue(input.issueId) && await issue(input.parentIssueId);
}
