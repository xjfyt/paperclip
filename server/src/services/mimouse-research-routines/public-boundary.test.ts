import { expect, it, vi } from "vitest";
import { isCompanyOpenResearchBoundary, type PublicResearchIssue, type PublicResearchProject } from "./public-boundary.js";
function fixture() {
  const issues = new Map<string, PublicResearchIssue>([["task", { id: "task", companyId: "company", visibility: "open", projectId: "project", parentId: "parent", privacyParentIssueId: null, privacyRootIssueId: null }],
    ["parent", { id: "parent", companyId: "company", visibility: "open", projectId: null, parentId: null, privacyParentIssueId: null, privacyRootIssueId: null }]]);
  const projects = new Map<string, PublicResearchProject>([["project", { id: "project", companyId: "company", visibility: "open" }]]);
  const reader = { issue: async (id: string) => issues.get(id) ?? null, project: async (id: string) => projects.get(id) ?? null,
    canReadIssue: vi.fn(async (_issue: PublicResearchIssue) => true), canReadProject: vi.fn(async (_project: PublicResearchProject) => true) };
  return { issues, projects, reader, input: { companyId: "company", issueId: "task" } };
}
it("accepts an explicitly open graph only with real-actor privacy permission", async () => {
  const f = fixture(); expect(await isCompanyOpenResearchBoundary(f.input, f.reader)).toBe(true);
  expect(f.reader.canReadIssue).toHaveBeenCalledTimes(2); expect(f.reader.canReadProject).toHaveBeenCalledTimes(1);
});
it.each(["task", "parent"])("rejects private %s even when the actual actor owns or can read it", async id => {
  const f = fixture(); f.issues.get(id)!.visibility = "private";
  expect(await isCompanyOpenResearchBoundary(f.input, f.reader)).toBe(false);
});
it("rejects a private project despite an open task and a member actor", async () => {
  const f = fixture(); f.projects.get("project")!.visibility = "private";
  expect(await isCompanyOpenResearchBoundary(f.input, f.reader)).toBe(false);
});
it("rejects private project on a normal ancestor", async () => {
  const f = fixture(); f.issues.get("task")!.projectId = null; f.issues.get("parent")!.projectId = "project"; f.projects.get("project")!.visibility = "private";
  expect(await isCompanyOpenResearchBoundary(f.input, f.reader)).toBe(false);
});
it("follows privacy parents even without a normal parent", async () => {
  const f = fixture(); f.issues.get("task")!.parentId = null; f.issues.get("task")!.privacyParentIssueId = "parent"; f.issues.get("parent")!.visibility = "private";
  expect(await isCompanyOpenResearchBoundary(f.input, f.reader)).toBe(false);
});
it("rejects stale/private-root markers rather than guessing declassification", async () => {
  const f = fixture(); f.issues.get("task")!.privacyRootIssueId = "parent";
  expect(await isCompanyOpenResearchBoundary(f.input, f.reader)).toBe(false);
});
it.each(["missing", "foreign", "unknown", "cycle"])("fails closed on %s ancestry", async kind => {
  const f = fixture(); const parent = f.issues.get("parent")!;
  if (kind === "missing") f.issues.delete("parent");
  if (kind === "foreign") parent.companyId = "other";
  if (kind === "unknown") parent.visibility = "unknown";
  if (kind === "cycle") parent.parentId = "task";
  expect(await isCompanyOpenResearchBoundary(f.input, f.reader)).toBe(false);
});
it("rejects unreadable real-actor issue and project boundaries", async () => {
  const a = fixture(); a.reader.canReadIssue.mockResolvedValue(false); expect(await isCompanyOpenResearchBoundary(a.input, a.reader)).toBe(false);
  const b = fixture(); b.reader.canReadProject.mockResolvedValue(false); expect(await isCompanyOpenResearchBoundary(b.input, b.reader)).toBe(false);
});
it("checks a binding's direct project and parent before any report exists", async () => {
  const f = fixture(); f.projects.get("project")!.visibility = "private";
  expect(await isCompanyOpenResearchBoundary({ companyId: "company", projectId: "project" }, f.reader)).toBe(false);
  f.issues.get("parent")!.visibility = "private";
  expect(await isCompanyOpenResearchBoundary({ companyId: "company", parentIssueId: "parent" }, f.reader)).toBe(false);
});
it("rejects absent project references", async () => {
  const f = fixture(); f.projects.clear(); expect(await isCompanyOpenResearchBoundary(f.input, f.reader)).toBe(false);
});
