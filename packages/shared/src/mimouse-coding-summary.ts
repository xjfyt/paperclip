/** Read-only counts from one authorized delivery page, never a project-wide audit. */
export interface MimouseCodingProjectSummary {
  scope: "authorized_delivery_page";
  deliveryCount: number;
  projects: Array<{
    gitlabOrigin: string;
    projectId: number;
    deliveryCount: number;
    candidateCount: number;
    blockedCount: number;
    localArtifactCount: number;
    trustedBuildTargetCount: 0;
    uploadStatus: "blocked";
    readyForRelease: false;
  }>;
}
export interface MimouseCodingListPagination {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}
/** Origin identity only. No credential/evidence values are rewritten. */
export function normalizeCodingOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
