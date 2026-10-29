import { mkdtempSync, readFileSync, rmSync, statSync, fstatSync, existsSync, mkdirSync, writeFileSync, readdirSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "@paperclipai/adapter-utils/test-fixtures/windows-private-acl";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completePaperclipCloudConnectorEnrollment,
  loadPaperclipCloudConnectorIdentity,
  paperclipCloudConnectorEnrollmentStatus,
  paperclipCloudConnectorIdentityPath,
  startPaperclipCloudConnectorEnrollment,
} from "./paperclip-cloud-connector-enrollment.js";
import { paperclipCloudConnectorConfigFromEnv } from "./paperclip-cloud-connector.js";
import { reconcilePaperclipCloudConnectorEnrollmentStatus } from "./paperclip-cloud-connector-status.js";

const storageHooks = vi.hoisted(() => ({
  beforeOpen: undefined as undefined | ((filename: string) => void),
  beforeWrite: undefined as undefined | ((descriptor: string | number) => void),
  beforeRead: undefined as undefined | ((descriptor: string | number) => void),
  temporary: undefined as undefined | { filename: string; descriptor: number },
}));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      const filename = String(args[0]);
      storageHooks.beforeOpen?.(filename);
      const descriptor = actual.openSync(...args);
      if (filename.includes("paperclip-cloud-connector.json.") && filename.endsWith(".tmp")) storageHooks.temporary = { filename, descriptor };
      return descriptor;
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      storageHooks.beforeRead?.(args[0] as string | number);
      return actual.readFileSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      storageHooks.beforeWrite?.(args[0] as string | number);
      return actual.writeFileSync(...args);
    },
  };
});

describe("Paperclip Cloud self-host enrollment", () => {
  let root = "";
  let previousHome: string | undefined;
  let previousInstance: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "paperclip-cloud-connector-"));
    previousHome = process.env.PAPERCLIP_HOME;
    previousInstance = process.env.PAPERCLIP_INSTANCE_ID;
    process.env.PAPERCLIP_HOME = root;
    process.env.PAPERCLIP_INSTANCE_ID = "connector-test";
  });

  afterEach(() => {
    storageHooks.beforeOpen = undefined; storageHooks.beforeWrite = undefined; storageHooks.beforeRead = undefined; storageHooks.temporary = undefined;
    if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = previousHome;
    if (previousInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = previousInstance;
    rmSync(root, { recursive: true, force: true });
  });

  const localEnrollment = (request: typeof fetch) => startPaperclipCloudConnectorEnrollment({
    origin: "https://private.example.test",
    env: { PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.example.test", PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "development" },
    request,
  });
  const brokerResponse = () => Response.json({ enrollmentId: "enroll-test",
    verificationUrl: "https://my.example.test/connections/enroll?id=enroll-test", expiresAt: new Date(Date.now() + 60_000).toISOString() }, { status: 201 });
  const digest = (filename: string) => createHash("sha256").update(readFileSync(filename)).digest("hex");
  function acl(filename: string): string {
    return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`
$ErrorActionPreference='Stop'
$target=$env:PAPERCLIP_FIXTURE_ACL_TARGET
$acl=if([IO.Directory]::Exists($target)){[IO.Directory]::GetAccessControl($target)}else{[IO.File]::GetAccessControl($target)}
[Console]::Out.Write($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Access,Owner,Group'))
`, "utf16le").toString("base64")], { env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: filename },
        encoding: "utf8", windowsHide: true, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  }

  it("establishes real private permissions before the first private-key byte", async () => {
    let writes = 0;
    storageHooks.beforeWrite = descriptor => {
      const temporary = storageHooks.temporary;
      if (!temporary || descriptor !== temporary.descriptor) return;
      const empty = fstatSync(temporary.descriptor);
      expect(empty.size).toBe(0);
      expect(hasPrivatePermissions(temporary.filename, empty.mode)).toBe(true);
      const directory = path.dirname(temporary.filename);
      expect(hasPrivatePermissions(directory, statSync(directory).mode)).toBe(true);
      writes++;
    };
    await localEnrollment(vi.fn(async () => brokerResponse()) as typeof fetch);
    expect(writes).toBeGreaterThanOrEqual(2);
  });

  it("does not delete a colliding temporary file or contact the broker", async () => {
    let collision: string | undefined;
    storageHooks.beforeOpen = filename => {
      if (!filename.includes("paperclip-cloud-connector.json.") || !filename.endsWith(".tmp")) return;
      collision = filename;
      storageHooks.beforeOpen = undefined;
      writeFileSync(filename, "pre-existing fixture bytes");
    };
    const request = vi.fn();
    await expect(localEnrollment(request as typeof fetch)).rejects.toMatchObject({ code: "EEXIST" });
    expect(request).not.toHaveBeenCalled();
    expect(readFileSync(collision!, "utf8")).toBe("pre-existing fixture bytes");
    expect(existsSync(paperclipCloudConnectorIdentityPath())).toBe(false);
  });

  it("cleans only its own empty protected temporary file when key writing fails", async () => {
    storageHooks.beforeWrite = descriptor => {
      if (descriptor === storageHooks.temporary?.descriptor) throw new Error("injected credential write failure");
    };
    const request = vi.fn();
    await expect(localEnrollment(request as typeof fetch)).rejects.toThrow("injected credential write failure");
    expect(request).not.toHaveBeenCalled();
    expect(readdirSync(path.dirname(paperclipCloudConnectorIdentityPath()))).toEqual([]);
  });

  if (process.platform === "win32") describe("native Windows private identity refusal", () => {
    it("does not read an unused wide local key when managed identity overrides it", async () => {
      await localEnrollment(vi.fn(async () => brokerResponse()) as typeof fetch);
      const filename = paperclipCloudConnectorIdentityPath();
      setFixtureAcl(root, filename, true);
      const originalBytes = digest(filename), originalAcl = acl(filename);
      let reads = 0;
      storageHooks.beforeRead = descriptor => {
        if (descriptor === filename || typeof descriptor === "number") reads++;
      };
      const env = { PAPERCLIP_CLOUD_CONNECTOR_INSTANCE_ID: "managed-instance",
        PAPERCLIP_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY: "synthetic-managed-signing-key",
        PAPERCLIP_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY: "synthetic-managed-sealing-key",
        PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "development",
        PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.example.test" };
      expect(paperclipCloudConnectorEnrollmentStatus(env)).toMatchObject({ configured: true, instanceId: "managed-instance" });
      expect(paperclipCloudConnectorConfigFromEnv(env)).toMatchObject({ instanceId: "managed-instance" });
      expect(reads).toBe(0);
      storageHooks.beforeRead = undefined;
      expect(digest(filename)).toBe(originalBytes);
      expect(acl(filename)).toBe(originalAcl);
    });

    it.each(["directory", "file"] as const)("refuses an existing wide %s without reading, rotating, or changing its ACL", async kind => {
      const request = vi.fn(async () => brokerResponse());
      await localEnrollment(request as typeof fetch);
      const filename = paperclipCloudConnectorIdentityPath();
      const target = kind === "directory" ? path.dirname(filename) : filename;
      setFixtureAcl(root, target, true);
      const originalBytes = digest(filename), originalAcl = acl(target);
      request.mockClear();
      expect(() => loadPaperclipCloudConnectorIdentity()).toThrow("verified private storage");
      await expect(localEnrollment(request as typeof fetch)).rejects.toMatchObject({ code: "EACCES" });
      expect(request).not.toHaveBeenCalled();
      expect(digest(filename)).toBe(originalBytes);
      expect(acl(target)).toBe(originalAcl);
    });

    it("refuses an existing identity symlink and leaves its target unchanged", async () => {
      const filename = paperclipCloudConnectorIdentityPath();
      const directory = path.dirname(filename);
      mkdirSync(directory, { recursive: true });
      protectNewPrivatePath(directory);
      const outside = path.join(root, "outside-identity");
      writeFileSync(outside, "outside synthetic identity");
      symlinkSync(outside, filename);
      const originalBytes = digest(outside);
      const request = vi.fn();
      expect(() => loadPaperclipCloudConnectorIdentity()).toThrow("verified private storage");
      await expect(localEnrollment(request as typeof fetch)).rejects.toMatchObject({ code: "EACCES" });
      expect(request).not.toHaveBeenCalled();
      expect(digest(outside)).toBe(originalBytes);
    });

    it("revalidates the existing identity before replacing it and cleans only its new temporary file", async () => {
      let brokerReturned = false, originalBytes = "", originalAcl = "";
      const filename = paperclipCloudConnectorIdentityPath();
      storageHooks.beforeWrite = descriptor => {
        if (!brokerReturned || descriptor !== storageHooks.temporary?.descriptor) return;
        storageHooks.beforeWrite = undefined;
        originalBytes = digest(filename);
        setFixtureAcl(root, filename, true);
        originalAcl = acl(filename);
      };
      const request = vi.fn(async () => { brokerReturned = true; return brokerResponse(); });
      await expect(localEnrollment(request as typeof fetch)).rejects.toMatchObject({ code: "EACCES" });
      expect(request).toHaveBeenCalledOnce();
      expect(originalBytes).not.toBe("");
      expect(digest(filename)).toBe(originalBytes);
      expect(acl(filename)).toBe(originalAcl);
      expect(readdirSync(path.dirname(filename))).toEqual([path.basename(filename)]);
    });
  });

  it("keeps private keys owner-only and activates only the matching one-time callback", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith("/v1/connector/enrollments")) {
        return Response.json({
          enrollmentId: "enroll-test",
          verificationUrl: "https://my.example.test/connections/enroll?id=enroll-test",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }, { status: 201 });
      }
      const token = String(body.request);
      const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
      expect(claims).toMatchObject({
        iss: loadPaperclipCloudConnectorIdentity()?.instanceId,
        aud: "https://my.example.test/v1/connector/enrollment-claims",
        env: "development",
        op: "enroll",
      });
      expect(typeof claims.ah).toBe("string");
      return Response.json({
        id: loadPaperclipCloudConnectorIdentity()?.instanceId,
        environment: "development",
        origins: ["https://private.example.test"],
      });
    });

    const pending = await startPaperclipCloudConnectorEnrollment({
      origin: "https://private.example.test",
      env: {
        PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.example.test",
        PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "development",
      },
      request: request as typeof fetch,
    });
    expect(pending.status).toBe("pending");
    expect(pending.verificationUrl).toBe("https://my.example.test/connections/enroll?id=enroll-test");
    const directory = path.dirname(paperclipCloudConnectorIdentityPath());
    if (process.platform === "win32") {
      expect(hasPrivatePermissions(directory, statSync(directory).mode)).toBe(true);
      expect(hasPrivatePermissions(paperclipCloudConnectorIdentityPath(), statSync(paperclipCloudConnectorIdentityPath()).mode)).toBe(true);
    } else {
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(paperclipCloudConnectorIdentityPath()).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(paperclipCloudConnectorIdentityPath(), "utf8")).not.toContain("approval-code");

    await expect(completePaperclipCloudConnectorEnrollment({
      enrollmentId: "enroll-test",
      approvalCode: "approval-code",
      state: "wrong-state",
      request: request as typeof fetch,
    })).rejects.toThrow(/Invalid or expired/);

    const state = loadPaperclipCloudConnectorIdentity()?.pending?.returnState;
    const active = await completePaperclipCloudConnectorEnrollment({
      enrollmentId: "enroll-test",
      approvalCode: "approval-code",
      state: state!,
      request: request as typeof fetch,
    });
    expect(active).toMatchObject({ configured: true, status: "active", origins: ["https://private.example.test"] });
    const config = paperclipCloudConnectorConfigFromEnv({});
    expect(config).toMatchObject({ baseUrl: "https://my.example.test", environment: "development" });
    expect(requests).toHaveLength(2);

    const statusRequest = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://my.example.test/v1/connector/instance-status");
      return Response.json({ active: false, status: "suspended" });
    });
    await expect(reconcilePaperclipCloudConnectorEnrollmentStatus({}, statusRequest as typeof fetch)).resolves.toMatchObject({
      configured: false,
      status: "suspended",
      instanceId: active.instanceId,
    });
  }, process.platform === "win32" ? 40_000 : undefined);

  it("rejects non-loopback plain HTTP destinations before creating keys", async () => {
    await expect(startPaperclipCloudConnectorEnrollment({
      origin: "http://private.example.test",
      request: vi.fn() as typeof fetch,
    })).rejects.toThrow(/requires HTTPS/);
    expect(paperclipCloudConnectorEnrollmentStatus().status).toBe("not_configured");
  });

  it.each([
    "https://my.example.test/connections/enroll?id=another-enrollment",
    "https://my.example.test/connections/enroll",
    "https://my.example.test/connections/enroll?id=enroll-test&next=%2Faccount",
    "https://my.example.test/connections/enroll?id=enroll-test#fragment",
    "https://user@my.example.test/connections/enroll?id=enroll-test",
  ])("rejects an imprecise broker verification destination: %s", async (verificationUrl) => {
    await expect(startPaperclipCloudConnectorEnrollment({
      origin: "https://private.example.test",
      env: {
        PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.example.test",
        PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "development",
      },
      request: vi.fn(async () => Response.json({
        enrollmentId: "enroll-test",
        verificationUrl,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, { status: 201 })) as typeof fetch,
    })).rejects.toThrow(/invalid enrollment destination/);
  });

  it("serializes overlapping starts and reuses one unexpired enrollment", async () => {
    let releaseBroker!: () => void;
    const brokerMayRespond = new Promise<void>((resolve) => {
      releaseBroker = resolve;
    });
    const request = vi.fn(async () => {
      await brokerMayRespond;
      return Response.json({
        enrollmentId: "enroll-shared",
        verificationUrl: "https://my.example.test/connections/enroll?id=enroll-shared",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, { status: 201 });
    });
    const values = {
      origin: "https://private.example.test",
      companyId: "company-test",
      initiatedBy: "user:admin-test",
      env: {
        PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.example.test",
        PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "development",
      },
      request: request as typeof fetch,
    };

    const first = startPaperclipCloudConnectorEnrollment(values);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    const second = startPaperclipCloudConnectorEnrollment(values);
    releaseBroker();

    const [firstStatus, secondStatus] = await Promise.all([first, second]);
    expect(request).toHaveBeenCalledOnce();
    expect(firstStatus).toMatchObject({ status: "pending", verificationUrl: expect.stringContaining("enroll-shared") });
    expect(secondStatus).toEqual(firstStatus);
    expect(loadPaperclipCloudConnectorIdentity()?.pending).toMatchObject({
      enrollmentId: "enroll-shared",
      companyId: "company-test",
      initiatedBy: "user:admin-test",
    });
    await expect(startPaperclipCloudConnectorEnrollment({
      ...values,
      initiatedBy: "user:another-admin",
    })).rejects.toThrow(/another administrator/);
    await expect(startPaperclipCloudConnectorEnrollment({
      ...values,
      companyId: "another-company",
    })).rejects.toThrow(/another company/);
    expect(request).toHaveBeenCalledOnce();
  });

  it("defaults an enrollment to the environment of the standard Cloud broker", () => {
    expect(paperclipCloudConnectorEnrollmentStatus({})).toMatchObject({
      brokerBaseUrl: "https://my.paperclip.app",
      environment: "production",
    });
    expect(paperclipCloudConnectorEnrollmentStatus({
      PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.paperclip.app",
    })).toMatchObject({ environment: "staging" });
  });

  it("rotates a non-active identity instead of mixing enrollment targets", async () => {
    const origin = "https://private.example.test";
    const productionRequest = vi.fn(async () => Response.json({
      enrollmentId: "enroll-production",
      verificationUrl: "https://my.paperclip.app/connections/enroll?id=enroll-production",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, { status: 201 }));
    await startPaperclipCloudConnectorEnrollment({
      origin,
      env: { PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.paperclip.app" },
      request: productionRequest as typeof fetch,
    });
    const productionIdentity = loadPaperclipCloudConnectorIdentity()!;

    expect(paperclipCloudConnectorEnrollmentStatus({
      PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.paperclip.app",
    })).toEqual({
      configured: false,
      status: "unverified",
      brokerBaseUrl: "https://my-staging.paperclip.app",
      instanceId: null,
      environment: "staging",
      origins: [],
    });

    const stagingRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://my-staging.paperclip.app/v1/connector/enrollments");
      expect(JSON.parse(String(init?.body))).toMatchObject({ environment: "staging", origin });
      return Response.json({
        enrollmentId: "enroll-staging",
        verificationUrl: "https://my-staging.paperclip.app/connections/enroll?id=enroll-staging",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, { status: 201 });
    });
    const stagingStatus = await startPaperclipCloudConnectorEnrollment({
      origin,
      env: { PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.paperclip.app" },
      request: stagingRequest as typeof fetch,
    });
    const stagingIdentity = loadPaperclipCloudConnectorIdentity()!;

    expect(stagingStatus).toMatchObject({
      status: "pending",
      brokerBaseUrl: "https://my-staging.paperclip.app",
      environment: "staging",
      verificationUrl: "https://my-staging.paperclip.app/connections/enroll?id=enroll-staging",
    });
    expect(stagingIdentity.instanceId).not.toBe(productionIdentity.instanceId);
    expect(stagingIdentity.signPublicKey).not.toBe(productionIdentity.signPublicKey);
    expect(stagingIdentity.sealPublicKey).not.toBe(productionIdentity.sealPublicKey);
    expect(stagingRequest).toHaveBeenCalledOnce();
  }, process.platform === "win32" ? 40_000 : undefined);

  it("fails closed when the configured target changes during callback or after activation", async () => {
    const origin = "https://private.example.test";
    const productionEnv = {
      PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.paperclip.app",
      PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "production",
    };
    const request = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/v1/connector/enrollments")) {
        return Response.json({
          enrollmentId: "enroll-production",
          verificationUrl: "https://my.paperclip.app/connections/enroll?id=enroll-production",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }, { status: 201 });
      }
      return Response.json({
        id: loadPaperclipCloudConnectorIdentity()?.instanceId,
        environment: "production",
        origins: [origin],
      });
    });
    await startPaperclipCloudConnectorEnrollment({ origin, env: productionEnv, request: request as typeof fetch });
    const pending = loadPaperclipCloudConnectorIdentity()!;
    const changedTargetRequest = vi.fn();

    await expect(completePaperclipCloudConnectorEnrollment({
      enrollmentId: "enroll-production",
      approvalCode: "approval-code",
      state: pending.pending!.returnState,
      env: {
        PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.paperclip.app",
        PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
      },
      request: changedTargetRequest as typeof fetch,
    })).rejects.toThrow(/Invalid or expired/);
    expect(changedTargetRequest).not.toHaveBeenCalled();

    await completePaperclipCloudConnectorEnrollment({
      enrollmentId: "enroll-production",
      approvalCode: "approval-code",
      state: pending.pending!.returnState,
      env: productionEnv,
      request: request as typeof fetch,
    });
    const activeIdentity = loadPaperclipCloudConnectorIdentity()!;
    const activeSwitchRequest = vi.fn();
    const stagingEnv = {
      PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.paperclip.app",
      PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
    };

    await expect(startPaperclipCloudConnectorEnrollment({
      origin,
      env: stagingEnv,
      request: activeSwitchRequest as typeof fetch,
    })).rejects.toThrow(/another target/);
    expect(activeSwitchRequest).not.toHaveBeenCalled();
    expect(loadPaperclipCloudConnectorIdentity()).toEqual(activeIdentity);
    expect(paperclipCloudConnectorConfigFromEnv(stagingEnv)).toBeNull();
  }, process.platform === "win32" ? 40_000 : undefined);

  it("treats managed environment identity as an atomic override of local identity", async () => {
    const origin = "https://private.example.test";
    const productionEnv = {
      PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.paperclip.app",
      PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "production",
    };
    const request = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/v1/connector/enrollments")) {
        return Response.json({
          enrollmentId: "enroll-production",
          verificationUrl: "https://my.paperclip.app/connections/enroll?id=enroll-production",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }, { status: 201 });
      }
      return Response.json({
        id: loadPaperclipCloudConnectorIdentity()?.instanceId,
        environment: "production",
        origins: [origin],
      });
    });
    await startPaperclipCloudConnectorEnrollment({ origin, env: productionEnv, request: request as typeof fetch });
    const pending = loadPaperclipCloudConnectorIdentity()!;
    await completePaperclipCloudConnectorEnrollment({
      enrollmentId: "enroll-production",
      approvalCode: "approval-code",
      state: pending.pending!.returnState,
      env: productionEnv,
      request: request as typeof fetch,
    });
    const localIdentity = loadPaperclipCloudConnectorIdentity()!;

    const managedEnv = {
      PAPERCLIP_CLOUD_CONNECTOR_INSTANCE_ID: "managed-staging-instance",
      PAPERCLIP_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY: "managed-signing-key",
      PAPERCLIP_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY: "managed-sealing-key",
      PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
      PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.paperclip.app",
      PAPERCLIP_PUBLIC_URL: "https://managed-stack.example.test",
    };
    expect(paperclipCloudConnectorEnrollmentStatus(managedEnv)).toEqual({
      configured: true,
      status: "active",
      brokerBaseUrl: "https://my-staging.paperclip.app",
      instanceId: "managed-staging-instance",
      environment: "staging",
      origins: ["https://managed-stack.example.test"],
    });
    expect(paperclipCloudConnectorConfigFromEnv(managedEnv)).toMatchObject({
      baseUrl: "https://my-staging.paperclip.app",
      instanceId: "managed-staging-instance",
      environment: "staging",
      signPrivateKey: "managed-signing-key",
      sealPrivateKey: "managed-sealing-key",
    });
    expect(loadPaperclipCloudConnectorIdentity()).toEqual(localIdentity);

    for (const omitted of [
      "PAPERCLIP_CLOUD_CONNECTOR_INSTANCE_ID",
      "PAPERCLIP_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY",
      "PAPERCLIP_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY",
      "PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT",
    ] as const) {
      const partialManagedEnv: NodeJS.ProcessEnv = { ...managedEnv };
      delete partialManagedEnv[omitted];
      expect(paperclipCloudConnectorEnrollmentStatus(partialManagedEnv)).toMatchObject({
        configured: false,
        status: "unverified",
        instanceId: null,
        environment: "staging",
      });
      expect(() => paperclipCloudConnectorConfigFromEnv(partialManagedEnv)).toThrow(/incomplete/);
      expect(loadPaperclipCloudConnectorIdentity()).toEqual(localIdentity);
    }

    expect(paperclipCloudConnectorConfigFromEnv(productionEnv)).toMatchObject({
      baseUrl: localIdentity.brokerBaseUrl,
      instanceId: localIdentity.instanceId,
      environment: localIdentity.environment,
      signPrivateKey: localIdentity.signPrivateKey,
      sealPrivateKey: localIdentity.sealPrivateKey,
    });
  }, process.platform === "win32" ? 40_000 : undefined);

  it("rejects known Cloud broker and environment mismatches", () => {
    const managedIdentity = {
      PAPERCLIP_CLOUD_CONNECTOR_INSTANCE_ID: "managed-instance",
      PAPERCLIP_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY: "managed-signing-key",
      PAPERCLIP_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY: "managed-sealing-key",
    };
    const mismatches = [
      {
        ...managedIdentity,
        PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my.paperclip.app",
        PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
      },
      {
        ...managedIdentity,
        PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.paperclip.app",
        PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "production",
      },
    ];
    for (const env of mismatches) {
      expect(() => paperclipCloudConnectorEnrollmentStatus(env)).toThrow(/do not match/);
      expect(() => paperclipCloudConnectorConfigFromEnv(env)).toThrow(/do not match/);
    }
    expect(() => paperclipCloudConnectorEnrollmentStatus({
      PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
    })).toThrow(/do not match/);
  });

  it("does not create or complete self-host enrollment with managed identity configuration", async () => {
    const origin = "https://private.example.test";
    const localEnv = {
      PAPERCLIP_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.paperclip.app",
      PAPERCLIP_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
    };
    const enrollmentRequest = vi.fn(async () => Response.json({
      enrollmentId: "enroll-local",
      verificationUrl: "https://my-staging.paperclip.app/connections/enroll?id=enroll-local",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, { status: 201 }));
    await startPaperclipCloudConnectorEnrollment({
      origin,
      env: localEnv,
      request: enrollmentRequest as typeof fetch,
    });
    const pendingIdentity = loadPaperclipCloudConnectorIdentity()!;
    const managedEnv = {
      ...localEnv,
      PAPERCLIP_CLOUD_CONNECTOR_INSTANCE_ID: "managed-staging-instance",
      PAPERCLIP_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY: "managed-signing-key",
      PAPERCLIP_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY: "managed-sealing-key",
    };
    const managedRequest = vi.fn();

    await expect(startPaperclipCloudConnectorEnrollment({
      origin,
      env: managedEnv,
      request: managedRequest as typeof fetch,
    })).rejects.toThrow(/unavailable with managed identity/);
    await expect(completePaperclipCloudConnectorEnrollment({
      enrollmentId: "enroll-local",
      approvalCode: "approval-code",
      state: pendingIdentity.pending!.returnState,
      env: managedEnv,
      request: managedRequest as typeof fetch,
    })).rejects.toThrow(/Invalid or expired/);
    expect(managedRequest).not.toHaveBeenCalled();
    expect(loadPaperclipCloudConnectorIdentity()).toEqual(pendingIdentity);
  });

  it("does not treat legacy Paperclip ID keys as a Cloud enrollment", () => {
    expect(paperclipCloudConnectorEnrollmentStatus({
      PAPERCLIP_ID_CONNECTOR_INSTANCE_ID: "legacy-instance",
      PAPERCLIP_ID_CONNECTOR_SIGN_PRIVATE_KEY: "legacy-signing-key",
      PAPERCLIP_ID_CONNECTOR_SEAL_PRIVATE_KEY: "legacy-sealing-key",
      PAPERCLIP_ID_CONNECTOR_ENVIRONMENT: "production",
      PAPERCLIP_ID_CONNECTOR_BASE_URL: "https://id.paperclip.app",
    })).toMatchObject({
      configured: false,
      status: "not_configured",
      brokerBaseUrl: "https://my.paperclip.app",
      instanceId: null,
    });
  });
});
