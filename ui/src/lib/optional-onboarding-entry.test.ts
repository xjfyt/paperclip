import { describe, expect, it } from "vitest";
import app from "../App.tsx?raw";
import standard from "../components/Layout.tsx?raw";
import production from "../components/Layout.production.tsx?raw";
import dashboard from "../pages/Dashboard.tsx?raw";

describe("optional setup entry-point regression contracts", () => {
  it.each([["standard", standard], ["production", production]])("never launches onboarding from the %s shell", (_name, source) => {
    expect(source).not.toContain("openOnboarding");
    expect(source).not.toContain("onboardingTriggered");
  });
  it("lets all three companyless route entry points render the welcome instead of redirecting", () => {
    expect(app.match(/return <NoCompaniesStartPage \/>;/g)).toHaveLength(3);
    expect(app).not.toContain('to="/onboarding"');
    expect(app).not.toContain("shouldRedirectCompanylessRouteToOnboarding");
  });
  it("does not retain an automatic zero-agent setup effect", () => {
    expect(dashboard).not.toContain("claimOnboardingOffer");
    expect(dashboard).not.toContain("shouldOpenOnboarding");
  });
});
