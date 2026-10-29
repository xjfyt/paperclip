import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onboard } from "../commands/onboard.js";
import type { PaperclipConfig } from "../config/schema.js";

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../commands/run.js", () => ({
  runCommand: runCommandMock,
}));

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();
const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_EXIT_CODE = process.exitCode;

const aclInitializationTimeout = process.platform === "win32" ? 20_000 : 5_000;
const pendingOnboard = new Set<ReturnType<typeof onboard>>();
const ownedDirectories = new Set<string>();
function temporaryDirectory(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  ownedDirectories.add(root); return root;
}
function runOnboard(...args: Parameters<typeof onboard>) {
  const operation = onboard(...args); pendingOnboard.add(operation); return operation;
}

function createExistingConfigFixture() {
  const root = temporaryDirectory("paperclip-onboard-");
  const runtimeRoot = path.join(root, "runtime");
  const configPath = path.join(root, ".paperclip", "config.json");
  const config: PaperclipConfig = {
    $meta: {
      version: 1,
      updatedAt: "2026-03-29T00:00:00.000Z",
      source: "configure",
    },
    database: {
      mode: "embedded-postgres",
      embeddedPostgresDataDir: path.join(runtimeRoot, "db"),
      embeddedPostgresPort: 54329,
      backup: {
        enabled: true,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: path.join(runtimeRoot, "backups"),
      },
    },
    logging: {
      mode: "file",
      logDir: path.join(runtimeRoot, "logs"),
    },
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      host: "127.0.0.1",
      port: 3100,
      allowedHostnames: [],
      serveUi: true,
    },
    auth: {
      baseUrlMode: "auto",
      disableSignUp: false,
    },
    telemetry: {
      enabled: true,
    },
    storage: {
      provider: "local_disk",
      localDisk: {
        baseDir: path.join(runtimeRoot, "storage"),
      },
      s3: {
        bucket: "paperclip",
        region: "us-east-1",
        prefix: "",
        forcePathStyle: false,
      },
    },
    secrets: {
      provider: "local_encrypted",
      strictMode: false,
      localEncrypted: {
        keyFilePath: path.join(runtimeRoot, "secrets", "master.key"),
      },
    },
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  return { configPath, configText: fs.readFileSync(configPath, "utf8") };
}

function createFreshConfigPath() {
  const root = temporaryDirectory("paperclip-onboard-fresh-");
  return path.join(root, ".paperclip", "config.json");
}

describe("onboard", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    delete process.env.PAPERCLIP_TOOL_ACTION_SIGNING_SECRET;
    delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
    delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    delete process.env.PAPERCLIP_DB_BACKUP_DIR;
    delete process.env.PAPERCLIP_DB_BACKUP_ENABLED;
    delete process.env.PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES;
    delete process.env.PAPERCLIP_DB_BACKUP_RETENTION_DAYS;
    delete process.env.PAPERCLIP_STORAGE_PROVIDER;
    delete process.env.PAPERCLIP_STORAGE_LOCAL_DIR;
    delete process.env.PAPERCLIP_SECRETS_PROVIDER;
    delete process.env.PAPERCLIP_SECRETS_STRICT_MODE;
    delete process.env.PAPERCLIP_HOME;
    delete process.env.PAPERCLIP_CONFIG;
    delete process.env.PAPERCLIP_INSTANCE_ID;
    delete process.env.PAPERCLIP_BIND;
    delete process.env.PAPERCLIP_BIND_HOST;
    delete process.env.PAPERCLIP_TAILNET_BIND_HOST;
    delete process.env.PAPERCLIP_OPEN_ON_LISTEN;
    delete process.env.PAPERCLIP_NO_BROWSER;
    delete process.env.HOST;
    // A custom config path does not relocate default secrets/managed state.
    // Every case must therefore supply an owned native home as well.
    const home = temporaryDirectory("paperclip-onboard-home-");
    process.env.PAPERCLIP_HOME = home;
    process.env.HOME = home; process.env.USERPROFILE = home;
    process.env.APPDATA = path.join(home, "AppData", "Roaming");
    process.env.LOCALAPPDATA = path.join(home, "AppData", "Local");
    runCommandMock.mockReset();
  });

  afterEach(async () => {
    try {
      // A test timeout does not cancel its real command promise. Settle it
      // before releasing environment/cwd or deleting its owned directories.
      await Promise.all(pendingOnboard);
    } finally {
      pendingOnboard.clear();
      process.env = { ...ORIGINAL_ENV };
      process.chdir(ORIGINAL_CWD);
      process.exitCode = ORIGINAL_EXIT_CODE;
      for (const directory of ownedDirectories) {
        if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("paperclip-onboard-")) throw new Error("Refusing cleanup outside the owned onboarding fixture");
        fs.rmSync(directory, { recursive: true, force: true });
      }
      ownedDirectories.clear();
    }
  }, process.platform === "win32" ? 120_000 : 10_000);

  it("preserves an existing config when rerun without flags", async () => {
    const fixture = createExistingConfigFixture();

    await runOnboard({ config: fixture.configPath });

    expect(fs.readFileSync(fixture.configPath, "utf8")).toBe(fixture.configText);
    expect(fs.existsSync(`${fixture.configPath}.backup`)).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(fixture.configPath), ".env"))).toBe(true);
  }, aclInitializationTimeout);

  it("preserves an existing config when rerun with --yes", async () => {
    const fixture = createExistingConfigFixture();

    await runOnboard({ config: fixture.configPath, yes: true, invokedByRun: true });

    expect(fs.readFileSync(fixture.configPath, "utf8")).toBe(fixture.configText);
    expect(fs.existsSync(`${fixture.configPath}.backup`)).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(fixture.configPath), ".env"))).toBe(true);
  }, aclInitializationTimeout);

  it("does not opt into opening a browser for a non-interactive existing setup", async () => {
    const fixture = createExistingConfigFixture();

    await runOnboard({ config: fixture.configPath, yes: true });

    expect(runCommandMock).toHaveBeenCalledWith({ config: fixture.configPath, repair: true, yes: true });
    expect(process.env.PAPERCLIP_OPEN_ON_LISTEN).toBeUndefined();
  }, aclInitializationTimeout);

  for (const [label, configPathForTest] of [
    ["existing", () => createExistingConfigFixture().configPath],
    ["fresh", () => createFreshConfigPath()],
  ] as const) {
    it(`opens the browser once while an interactive ${label} setup starts`, async () => {
      const configPath = configPathForTest();
      const stdinIsTTY = process.stdin.isTTY;
      const stdoutIsTTY = process.stdout.isTTY;
      let openOnListenDuringRun: string | undefined;
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
      runCommandMock.mockImplementation(async () => {
        openOnListenDuringRun = process.env.PAPERCLIP_OPEN_ON_LISTEN;
      });

      try {
        await runOnboard({ config: configPath, yes: true });
      } finally {
        Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: stdinIsTTY });
        Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: stdoutIsTTY });
      }

      expect(runCommandMock).toHaveBeenCalledWith({ config: configPath, repair: true, yes: true });
      expect(openOnListenDuringRun).toBe("true");
      expect(process.env.PAPERCLIP_OPEN_ON_LISTEN).toBeUndefined();
    }, aclInitializationTimeout);
  }

  it.each([
    ["PAPERCLIP_NO_BROWSER", "1"],
    ["PAPERCLIP_OPEN_ON_LISTEN", "false"],
  ])("respects the interactive browser opt-out %s", async (key, value) => {
    const configPath = createFreshConfigPath();
    const stdinIsTTY = process.stdin.isTTY;
    const stdoutIsTTY = process.stdout.isTTY;
    let openOnListenDuringRun: string | undefined;
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    process.env[key] = value;
    runCommandMock.mockImplementation(async () => {
      openOnListenDuringRun = process.env.PAPERCLIP_OPEN_ON_LISTEN;
    });

    try {
      await runOnboard({ config: configPath, yes: true });
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: stdinIsTTY });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: stdoutIsTTY });
    }

    expect(runCommandMock).toHaveBeenCalledWith({ config: configPath, repair: true, yes: true });
    expect(openOnListenDuringRun).not.toBe("true");
    expect(process.env[key]).toBe(value);
  }, aclInitializationTimeout);

  it("backs up invalid config bytes and refuses --yes replacement", async () => {
    const configPath = createFreshConfigPath();
    const invalidBytes = Buffer.from('{"database": invalid}\n', "utf8");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, invalidBytes);

    await runOnboard({ config: configPath, yes: true, invokedByRun: true });

    expect(process.exitCode).toBe(1);
    expect(fs.readFileSync(configPath)).toEqual(invalidBytes);
    expect(fs.readFileSync(`${configPath}.invalid-1`)).toEqual(invalidBytes);
    expect(fs.existsSync(`${configPath}.backup`)).toBe(false);
  });

  it("keeps --yes onboarding on local trusted loopback defaults", async () => {
    const configPath = createFreshConfigPath();
    process.env.HOST = "0.0.0.0";
    process.env.PAPERCLIP_BIND = "lan";

    await runOnboard({ config: configPath, yes: true, invokedByRun: true });

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as PaperclipConfig;
    expect(raw.server.deploymentMode).toBe("local_trusted");
    expect(raw.server.exposure).toBe("private");
    expect(raw.server.bind).toBe("loopback");
    expect(raw.server.host).toBe("127.0.0.1");
  }, aclInitializationTimeout);

  it("creates instance-root config and data paths for a fresh PAPERCLIP_HOME", async () => {
    const home = temporaryDirectory("paperclip-onboard-home-");
    const cwd = temporaryDirectory("paperclip-onboard-cwd-");
    process.chdir(cwd);
    process.env.PAPERCLIP_HOME = home;

    await runOnboard({ yes: true, invokedByRun: true });

    const instanceRoot = path.join(home, "instances", "default");
    const configPath = path.join(instanceRoot, "config.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as PaperclipConfig;

    expect(raw.database.embeddedPostgresDataDir).toBe(path.join(instanceRoot, "db"));
    expect(raw.database.backup.dir).toBe(path.join(instanceRoot, "data", "backups"));
    expect(raw.logging.logDir).toBe(path.join(instanceRoot, "logs"));
    expect(raw.storage.localDisk.baseDir).toBe(path.join(instanceRoot, "data", "storage"));
    expect(raw.secrets.localEncrypted.keyFilePath).toBe(path.join(instanceRoot, "secrets", "master.key"));
    expect(fs.existsSync(path.join(instanceRoot, ".env"))).toBe(true);
    expect(fs.readFileSync(path.join(instanceRoot, ".env"), "utf8"))
      .toContain("PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=");
    expect(fs.existsSync(path.join(instanceRoot, "secrets", "master.key"))).toBe(true);
  }, aclInitializationTimeout);

  it("supports authenticated/private quickstart bind presets", async () => {
    const configPath = createFreshConfigPath();
    process.env.PAPERCLIP_TAILNET_BIND_HOST = "100.64.0.8";

    await runOnboard({ config: configPath, yes: true, invokedByRun: true, bind: "tailnet" });

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as PaperclipConfig;
    expect(raw.server.deploymentMode).toBe("authenticated");
    expect(raw.server.exposure).toBe("private");
    expect(raw.server.bind).toBe("tailnet");
    expect(raw.server.host).toBe("100.64.0.8");
  }, aclInitializationTimeout);

  it("keeps tailnet quickstart on loopback until tailscale is available", async () => {
    const configPath = createFreshConfigPath();
    delete process.env.PAPERCLIP_TAILNET_BIND_HOST;
    process.env.PATH = "";

    try {
      await runOnboard({ config: configPath, yes: true, invokedByRun: true, bind: "tailnet" });
    } finally {
      process.env.PATH = ORIGINAL_PATH;
    }

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as PaperclipConfig;
    expect(raw.server.deploymentMode).toBe("authenticated");
    expect(raw.server.exposure).toBe("private");
    expect(raw.server.bind).toBe("tailnet");
    expect(raw.server.host).toBe("127.0.0.1");
  }, aclInitializationTimeout);

  it("ignores deployment env overrides during --yes quickstart", async () => {
    const configPath = createFreshConfigPath();
    process.env.PAPERCLIP_DEPLOYMENT_MODE = "authenticated";

    await runOnboard({ config: configPath, yes: true, invokedByRun: true });

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as PaperclipConfig;
    expect(raw.server.deploymentMode).toBe("local_trusted");
    expect(raw.server.exposure).toBe("private");
    expect(raw.server.bind).toBe("loopback");
    expect(raw.server.host).toBe("127.0.0.1");
  }, aclInitializationTimeout);
});
