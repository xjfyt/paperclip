import { createHash } from "node:crypto";
import { localEncryptedProvider } from "../../secrets/local-encrypted-provider.js";
import { parseToken, WorkBuddyProtocolError, type WorkBuddyToken } from "./protocol.js";
interface Owner { id: string; companyId: string; ownerUserId: string }
export const workbuddyCredentialIdentity = (token: WorkBuddyToken) => createHash("sha256").update(JSON.stringify(["workbuddy-cn", token.open_id])).digest("hex");
export async function sealWorkbuddyCredential(owner: Owner, token: WorkBuddyToken, version: number) {
  const value = JSON.stringify({ schema: "mimouse-workbuddy-token-v1", companyId: owner.companyId, connectionId: owner.id, ownerUserId: owner.ownerUserId, version, identity: workbuddyCredentialIdentity(token), token });
  // Reuse the existing AES-GCM provider/master key, but keep this credential
  // out of generic company-secret declarations and Agent environment bindings.
  return (await localEncryptedProvider.createVersion({ value })).material;
}
export async function openWorkbuddyCredential(owner: Owner & { tokenMaterial: Record<string, unknown> | null; tokenVersion: number; credentialIdentity: string | null }) {
  if (!owner.tokenMaterial) throw new WorkBuddyProtocolError("reauthorization_required", false);
  try {
    const payload = JSON.parse(await localEncryptedProvider.resolveVersion({ material: owner.tokenMaterial, externalRef: null }));
    if (payload?.schema !== "mimouse-workbuddy-token-v1" || payload.companyId !== owner.companyId || payload.connectionId !== owner.id || payload.ownerUserId !== owner.ownerUserId || payload.version !== owner.tokenVersion || payload.identity !== owner.credentialIdentity) throw Error("binding mismatch");
    const token = parseToken(payload.token);
    if (workbuddyCredentialIdentity(token) !== owner.credentialIdentity) throw Error("provider identity mismatch");
    return token;
  } catch { throw new WorkBuddyProtocolError("credential_unavailable_or_mismatched", false); }
}
