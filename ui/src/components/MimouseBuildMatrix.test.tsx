// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { MIMOUSE_BUILD_TARGETS, type MimouseBuildMatrix as BuildMatrix } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import { MimouseBuildMatrix } from "./MimouseBuildMatrix";
const sha = "a".repeat(40);
const matrix: BuildMatrix = { schemaVersion: 1, companyId: "company-a", deliveryId: "delivery-a", commitSha: sha, projectId: 1, gitlabOrigin: "https://git.example",
  targets: MIMOUSE_BUILD_TARGETS.map((target, index) => ({ ...target, status: "blocked", artifactEvidence: index === 4 ? "local_bytes_hashed" : "none", artifacts: index === 4 ? [{ fileName: "Customer App.bin", sha256: "b".repeat(64), sizeBytes: 1234, declaredBuildJob: "customer-job" }] : [], blockers: ["runner_evidence_missing"], runnerVerified: false, testVerified: false, signatureVerified: false })),
  upload: { status: "blocked", reason: "upload_contract_missing" }, readyForRelease: false };
afterEach(async () => { await i18n.changeLanguage("en"); });
function render(value: BuildMatrix | undefined) { const host = document.createElement("div"); host.innerHTML = renderToStaticMarkup(<MimouseBuildMatrix matrix={value} companyId="company-a" deliveryId="delivery-a" commitSha={sha} />); return host; }
it.each(["en", "zh-CN", "es", "ja"])("shows all six blocked targets and unchanged artifact identities in %s", async locale => {
  await i18n.changeLanguage(locale); const host = render(matrix);
  expect(host.querySelectorAll("[data-build-target]")).toHaveLength(6);
  expect(host.textContent).toContain("Customer App.bin"); expect(host.textContent).toContain("customer-job");
  expect(host.textContent).toContain("b".repeat(64)); expect(host.textContent).toContain(i18n.t("buildMatrixUi.upload"));
  expect(host.textContent?.split(i18n.t("buildMatrixUi.blocked"))).toHaveLength(7);
});
it.each([undefined, { ...matrix, companyId: "company-b" }, { ...matrix, deliveryId: "delivery-b" }, { ...matrix, commitSha: "c".repeat(40) }])("never shows stale or foreign snapshot artifact names", value => {
  const host = render(value); expect(host.querySelectorAll("[data-build-target]")).toHaveLength(0); expect(host.textContent).not.toContain("Customer App.bin"); expect(host.textContent).toContain(i18n.t("buildMatrixUi.unavailable"));
});
