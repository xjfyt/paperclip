import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withWorktreePortRegistryLock, withWorktreePortRegistryLockSync } from "./worktree-port-registry.js";

const roots: string[] = [];
function root() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-registry-sharing-")); roots.push(directory); return directory; }
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const directory of roots.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("paperclip-registry-sharing-")) throw Error("Unexpected registry fixture root");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// A real .NET handle deliberately omits FILE_SHARE_DELETE. The worker releases
// it only after the calling thread has observed an actual failed rename.
const HOLDER = String.raw`
const {spawn} = require('node:child_process');
const {workerData, parentPort} = require('node:worker_threads');
const control = new Int32Array(workerData.control);
const script = '$file=[IO.File]::Open($env:PAPERCLIP_REGISTRY_TEST_TARGET,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);try{[Console]::Out.WriteLine("ready");[Console]::Out.Flush();[Console]::ReadLine()|Out-Null}finally{$file.Dispose()}';
const child = spawn(workerData.powershell, ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], {
  windowsHide:true, timeout:20000, env:{SystemRoot:workerData.systemRoot,PAPERCLIP_REGISTRY_TEST_TARGET:workerData.file}, stdio:['pipe','pipe','pipe']
});
child.stderr.resume();
let ready = false;
child.stdout.on('data', chunk => {
 if (ready || !chunk.toString().includes('ready')) return;
 ready = true; Atomics.store(control,0,1); Atomics.notify(control,0);
 while (Atomics.load(control,1) === 0) Atomics.wait(control,1,0,1000);
 child.stdin.end(String.fromCharCode(10));
});
child.on('error', () => {Atomics.store(control,0,-1);Atomics.notify(control,0);});
child.on('close', () => {
 if(!ready){Atomics.store(control,0,-1);Atomics.notify(control,0);}
 Atomics.store(control,2,1);Atomics.notify(control,2);parentPort.close();
});
`;
function holdWithoutDeleteSharing(file: string) {
  const control = new Int32Array(new SharedArrayBuffer(12));
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const worker = new Worker(HOLDER, { eval: true, execArgv: [], workerData: {
    control: control.buffer, file, systemRoot,
    powershell: path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  } });
  let workerFailure: Error | undefined;
  const exited = new Promise<void>(resolve => {
    worker.once("error", error => { workerFailure = error; Atomics.store(control,0,-1); Atomics.notify(control,0); });
    worker.once("exit", code => { if (code !== 0 && !workerFailure) workerFailure = Error("Sharing fixture worker failed"); resolve(); });
  });
  const release = () => { Atomics.store(control,1,1); Atomics.notify(control,1); };
  Atomics.wait(control,0,0,15000);
  if (Atomics.load(control,0) !== 1) { release(); throw Error("Real Windows sharing handle could not be established"); }
  return { release, close: async () => { release(); await exited; if (workerFailure) throw workerFailure; } };
}

describe.runIf(process.platform === "win32")("Windows port-registry metadata publication", { timeout: 30000 }, () => {
  for (const kind of ["sync", "async"] as const) {
    it(`keeps the ${kind} critical section exclusive across a real transient sharing violation`, async () => {
      const home = root(), lock = path.join(home, ".worktree-port-reservations.lock");
      const actualWrite = fs.writeFileSync.bind(fs), actualRename = fs.renameSync.bind(fs), actualOpen = fs.openSync.bind(fs);
      const files = new Map<number,string>();
      vi.spyOn(fs,"openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
        const descriptor = actualOpen(...args); files.set(descriptor,String(args[0])); return descriptor;
      }) as typeof fs.openSync);
      let holder: ReturnType<typeof holdWithoutDeleteSharing> | undefined;
      let held = "", realFailures = 0, entered = false;
      vi.spyOn(fs, "writeFileSync").mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
        actualWrite(...args);
        const file = typeof args[0] === "number" ? files.get(args[0]) : String(args[0]);
        if (!holder && file?.startsWith(path.join(lock,"owner.json.")) && file.endsWith(".tmp")) {
          held = file; holder = holdWithoutDeleteSharing(held);
        }
      }) as typeof fs.writeFileSync);
      vi.spyOn(fs,"renameSync").mockImplementation((source,target) => {
        try { return actualRename(source,target); }
        catch (error) {
          if (String(source) === held && ["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
            realFailures++; holder!.release();
          }
          throw error;
        }
      });
      const critical = () => {
        entered = true;
        const owner = JSON.parse(fs.readFileSync(path.join(lock,"owner.json"),"utf8"));
        const backup = JSON.parse(fs.readFileSync(path.join(lock,"owner.backup.json"),"utf8"));
        expect(owner).toEqual(backup); expect(owner.pid).toBe(process.pid); expect(owner.probePort).toBeGreaterThan(1);
        expect(fs.readdirSync(lock).sort()).toEqual(["owner.backup.json","owner.json"]);
      };
      try {
        if (kind === "sync") withWorktreePortRegistryLockSync(home, critical);
        else await withWorktreePortRegistryLock(home, async () => critical());
        expect(realFailures).toBeGreaterThan(0); expect(entered).toBe(true); expect(fs.existsSync(lock)).toBe(false);
      } finally { await holder?.close(); }
    });
  }
  it("fails closed while a real sharing handle remains open beyond the publication deadline", async () => {
    const home = root(), lock = path.join(home, ".worktree-port-reservations.lock");
    const actualWrite = fs.writeFileSync.bind(fs), actualOpen = fs.openSync.bind(fs);
    const files = new Map<number,string>();
    let holder: ReturnType<typeof holdWithoutDeleteSharing> | undefined, entered = false;
    vi.spyOn(fs,"openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
      const descriptor = actualOpen(...args); files.set(descriptor,String(args[0])); return descriptor;
    }) as typeof fs.openSync);
    vi.spyOn(fs,"writeFileSync").mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
      actualWrite(...args);
      const file = typeof args[0] === "number" ? files.get(args[0]) : String(args[0]);
      if (!holder && file?.startsWith(path.join(lock,"owner.json.")) && file.endsWith(".tmp")) holder = holdWithoutDeleteSharing(file);
    }) as typeof fs.writeFileSync);
    try {
      expect(() => withWorktreePortRegistryLockSync(home, () => { entered = true; })).toThrow();
      expect(entered).toBe(false); expect(fs.existsSync(path.join(lock,"owner.json"))).toBe(false);
    } finally { await holder?.close(); }
  });

  it("preserves a replaced temporary entry and refuses the critical section", () => {
    const home = root(), lock = path.join(home, ".worktree-port-reservations.lock");
    const actualWrite = fs.writeFileSync.bind(fs), actualOpen = fs.openSync.bind(fs), actualClose = fs.closeSync.bind(fs);
    const files = new Map<number,string>();
    let replaced = "", entered = false;
    vi.spyOn(fs,"openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
      const descriptor = actualOpen(...args); files.set(descriptor,String(args[0])); return descriptor;
    }) as typeof fs.openSync);
    vi.spyOn(fs,"closeSync").mockImplementation(descriptor => {
      actualClose(descriptor);
      const file = files.get(descriptor);
      if (!replaced && file?.startsWith(path.join(lock,"owner.json.")) && file.endsWith(".tmp")) {
        replaced = file; fs.renameSync(file, `${file}.retained`); actualWrite(file,"foreign temporary bytes",{flag:"wx"});
      }
    });
    expect(() => withWorktreePortRegistryLockSync(home, () => { entered = true; })).toThrow("identity changed");
    expect(entered).toBe(false); expect(replaced).not.toBe("");
    expect(fs.readFileSync(replaced,"utf8")).toBe("foreign temporary bytes");
    expect(fs.existsSync(`${replaced}.retained`)).toBe(true); expect(fs.existsSync(path.join(lock,"owner.json"))).toBe(false);
  });

  it("preserves a replacement lock directory instead of publishing into or deleting it", () => {
    const home = root(), lock = path.join(home, ".worktree-port-reservations.lock"), retained = `${lock}.retained`;
    const actualWrite = fs.writeFileSync.bind(fs), actualOpen = fs.openSync.bind(fs), actualClose = fs.closeSync.bind(fs);
    const files = new Map<number,string>();
    let replaced = false, entered = false;
    vi.spyOn(fs,"openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
      const descriptor = actualOpen(...args); files.set(descriptor,String(args[0])); return descriptor;
    }) as typeof fs.openSync);
    vi.spyOn(fs,"closeSync").mockImplementation(descriptor => {
      actualClose(descriptor);
      const file = files.get(descriptor);
      if (!replaced && file?.startsWith(path.join(lock,"owner.json.")) && file.endsWith(".tmp")) {
        replaced = true; fs.renameSync(lock,retained); fs.mkdirSync(lock); actualWrite(path.join(lock,"foreign.txt"),"foreign lock bytes");
      }
    });
    expect(() => withWorktreePortRegistryLockSync(home, () => { entered = true; })).toThrow("identity changed");
    expect(entered).toBe(false); expect(replaced).toBe(true);
    expect(fs.readdirSync(lock)).toEqual(["foreign.txt"]); expect(fs.readFileSync(path.join(lock,"foreign.txt"),"utf8")).toBe("foreign lock bytes");
    expect(fs.readdirSync(retained)).toHaveLength(1);
  });

  it("preserves a competing wx temporary file and does not misclassify its EEXIST as lock contention", () => {
    const home = root(), lock = path.join(home, ".worktree-port-reservations.lock");
    const actualWrite = fs.writeFileSync.bind(fs), actualOpen = fs.openSync.bind(fs), actualClose = fs.closeSync.bind(fs);
    let collision = "", entered = false;
    vi.spyOn(fs,"openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
      const file = String(args[0]);
      if (!collision && args[1] === "wx" && file.startsWith(path.join(lock,"owner.json."))) {
        collision = file; const descriptor = actualOpen(file,"wx"); actualWrite(descriptor,"competing temporary bytes"); actualClose(descriptor);
      }
      return actualOpen(...args);
    }) as typeof fs.openSync);
    expect(() => withWorktreePortRegistryLockSync(home, () => { entered = true; })).toThrow(expect.objectContaining({code:"EEXIST"}));
    expect(entered).toBe(false); expect(collision).not.toBe(""); expect(fs.readFileSync(collision,"utf8")).toBe("competing temporary bytes");
  });

  for (const publication of ["initial", "rewrite"] as const) {
    it(`refuses a foreign target installed after a real ${publication} publication sharing failure`, async () => {
      const home = root(), lock = path.join(home, ".worktree-port-reservations.lock"), target = path.join(lock,"owner.json");
      const actualWrite = fs.writeFileSync.bind(fs), actualOpen = fs.openSync.bind(fs), actualRename = fs.renameSync.bind(fs);
      const files = new Map<number,string>();
      let holder: ReturnType<typeof holdWithoutDeleteSharing> | undefined, held = "", writes = 0, entered = false, replaced = false;
      vi.spyOn(fs,"openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
        const descriptor = actualOpen(...args); files.set(descriptor,String(args[0])); return descriptor;
      }) as typeof fs.openSync);
      vi.spyOn(fs,"writeFileSync").mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
        actualWrite(...args); const file = typeof args[0] === "number" ? files.get(args[0]) : String(args[0]);
        if (file?.startsWith(`${target}.`) && file.endsWith(".tmp")) {
          writes++;
          if (writes === (publication === "initial" ? 1 : 2)) { held = file; holder = holdWithoutDeleteSharing(file); }
        }
      }) as typeof fs.writeFileSync);
      vi.spyOn(fs,"renameSync").mockImplementation((source,destination) => {
        try { return actualRename(source,destination); }
        catch (error) {
          if (!replaced && String(source) === held && ["EPERM","EACCES","EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
            replaced = true;
            if (publication === "rewrite") actualRename(target,`${target}.retained`);
            actualWrite(target,"foreign owner target bytes",{flag:"wx"}); holder!.release();
          }
          throw error;
        }
      });
      try {
        expect(() => withWorktreePortRegistryLockSync(home, () => { entered = true; })).toThrow("owner target identity changed");
        expect(replaced).toBe(true); expect(entered).toBe(false); expect(fs.readFileSync(target,"utf8")).toBe("foreign owner target bytes");
        expect(fs.existsSync(held)).toBe(true);
        if (publication === "rewrite") expect(fs.existsSync(`${target}.retained`)).toBe(true);
      } finally { await holder?.close(); }
    });
  }

  it("never executes a CWD or PATH powershell impersonator when resolving the owner identity", async () => {
    const home = root(), fake = path.join(home,"fake-bin"), marker = path.join(home,"fake-ran.txt");
    // Reuse the existing fixed no-network native test bridge without adding a
    // production dependency from shared back to adapter-utils.
    const fixtureModule = new URL("../../adapter-utils/src/test-fixtures/native-cli.ts", import.meta.url).href;
    const { writeCliFixture } = await import(fixtureModule);
    await writeCliFixture(path.join(fake,"powershell"), 'require("node:fs").writeFileSync(process.env.PAPERCLIP_REGISTRY_FAKE_MARKER,"unexpected");process.exit(77);');
    const originalCwd = process.cwd();
    vi.stubEnv("PATH",fake); vi.stubEnv("PAPERCLIP_REGISTRY_FAKE_MARKER",marker);
    try {
      process.chdir(fake);
      let entered = false;
      withWorktreePortRegistryLockSync(path.join(home,"registry"), () => { entered = true; });
      expect(entered).toBe(true); expect(fs.existsSync(marker)).toBe(false);
    } catch (error) {
      if (fs.existsSync(marker)) {
        expect(fs.readFileSync(marker,"utf8")).toBe("unexpected");
        throw new Error("The untrusted CWD/PATH powershell impersonator executed", { cause: error });
      }
      throw error;
    } finally { process.chdir(originalCwd); }
  });

  it("retains a live owner when its ownership probe and OS identity inspector are unavailable", () => {
    const home = root(), lock = path.join(home,".worktree-port-reservations.lock"), ownerFile = path.join(lock,"owner.json");
    fs.mkdirSync(lock);
    const bytes = JSON.stringify({version:1,pid:process.pid,processIdentity:"unverified-live-owner",probePort:1,token:"retained-owner"});
    fs.writeFileSync(ownerFile,bytes);
    const identity = fs.lstatSync(lock,{bigint:true});
    const old = new Date(Date.now()-10000); fs.utimesSync(lock,old,old);
    vi.stubEnv("SystemRoot",path.join(home,"unavailable-system"));
    let entered = false;
    expect(() => withWorktreePortRegistryLockSync(home, () => {entered=true;})).toThrow("Timed out waiting");
    expect(entered).toBe(false); expect(fs.readFileSync(ownerFile,"utf8")).toBe(bytes);
    expect(fs.lstatSync(lock,{bigint:true}).ino).toBe(identity.ino);
  });

});
