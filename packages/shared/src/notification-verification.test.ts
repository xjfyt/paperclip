import { describe, expect, it } from "vitest";
import { notificationSnapshotMatches } from "./notification-verification.js";
const scope = { endpointId: "endpoint", configVersion: 2, verificationEpoch: 3, kind: "wecom_webhook", secretRef: "secret", secretVersion: 1 };
const snapshot = { configVersion: 2, verificationEpoch: 3, kind: "wecom_webhook", secretRef: "secret", secretVersion: 1 };
describe("exact notification observation scope", () => {
  it("matches only the frozen current configuration and credential epoch", () => expect(notificationSnapshotMatches(scope, snapshot)).toBe(true));
  it.each(["configVersion", "verificationEpoch", "kind", "secretRef", "secretVersion"])("does not inherit another %s", key => {
    expect(notificationSnapshotMatches(scope, { ...snapshot, [key]: "other" })).toBe(false);
    expect(notificationSnapshotMatches(scope, { ...snapshot, [key]: undefined })).toBe(false);
  });
});
