import { afterEach, expect, it, vi } from "vitest";
import { openWorkbuddyCredential, sealWorkbuddyCredential, workbuddyCredentialIdentity } from "../services/workbuddy/credentials.js";
afterEach(() => vi.unstubAllEnvs());
it("seals personal tokens outside generic company bindings and binds owner/company/version", async () => {
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "01".repeat(32));
  const owner = { id: "connection", companyId: "company", ownerUserId: "owner" };
  const token = { access_token: "private-access", refresh_token: "private-refresh", token_type: "Bearer" as const, expires_in: 300, scope: "user.task.readable user.task.invokable", open_id: "provider-owner" };
  const tokenMaterial = await sealWorkbuddyCredential(owner, token, 1);
  expect(JSON.stringify(tokenMaterial)).not.toContain("private-access"); expect(JSON.stringify(tokenMaterial)).not.toContain("private-refresh");
  const bound = { ...owner, tokenMaterial, tokenVersion: 1, credentialIdentity: workbuddyCredentialIdentity(token) };
  expect((await openWorkbuddyCredential(bound)).access_token).toBe("private-access");
  for (const changed of [{ ownerUserId: "other" }, { companyId: "other" }, { id: "other" }, { tokenVersion: 2 }, { credentialIdentity: "other" }]) await expect(openWorkbuddyCredential({ ...bound, ...changed })).rejects.toThrow("credential_unavailable_or_mismatched");
});
