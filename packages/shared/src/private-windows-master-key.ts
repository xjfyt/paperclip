import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hasPrivatePermissions, protectNewPrivatePath } from "./private-filesystem-permissions.js";

function privateStorageError() {
  return new Error("Local encrypted master key requires verified private Windows storage; existing keys and ACLs are never repaired.");
}
function assertUnlinkedParents(file: string) {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    try {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw privateStorageError();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (path.dirname(directory) === directory) break;
  }
}
function privateDirectory(directory: string) {
  assertUnlinkedParents(path.join(directory, "key"));
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !hasPrivatePermissions(directory, Number(stat.mode))) throw privateStorageError();
  return stat;
}

function ensurePrivateDirectory(directory: string) {
  try { return privateDirectory(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  assertUnlinkedParents(path.join(directory, "key"));
  mkdirSync(path.dirname(directory), { recursive: true });
  // Publish the directory only after its empty DACL is protected. Concurrent
  // first writers never observe a public final directory during initialization.
  const staging = mkdtempSync(path.join(path.dirname(directory), ".paperclip-private-key-directory-"));
  const owned = lstatSync(staging, { bigint: true });
  try {
    protectNewPrivatePath(staging);
    privateDirectory(staging);
    try { renameSync(staging, directory); }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      // Windows refuses replacement of an existing directory. A competitor is
      // accepted only after read-only private validation, never permission repair.
      privateDirectory(directory);
    }
  } finally {
    try {
      const entry = lstatSync(staging, { bigint: true });
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.dev !== owned.dev || entry.ino !== owned.ino || readdirSync(staging).length) throw privateStorageError();
      rmdirSync(staging);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return privateDirectory(directory);
}

export function readPrivateWindowsMasterKey(file: string): string {
  privateDirectory(path.dirname(file));
  const entry = lstatSync(file, { bigint: true });
  if (!entry.isFile() || entry.isSymbolicLink() || !hasPrivatePermissions(file, Number(entry.mode))) throw privateStorageError();
  let descriptor: number;
  try { descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw privateStorageError(); throw error; }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) throw privateStorageError();
    const raw = readFileSync(descriptor, "utf8");
    for (const stat of [fstatSync(descriptor, { bigint: true }), lstatSync(file, { bigint: true })]) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== opened.dev || stat.ino !== opened.ino
        || stat.size !== opened.size || stat.mtimeNs !== opened.mtimeNs || stat.ctimeNs !== opened.ctimeNs) throw privateStorageError();
    }
    return raw;
  } catch (error) {
    // Health must not describe an observed identity disappearing during its
    // verification as an uninitialized instance's first-write opportunity.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw privateStorageError();
    throw error;
  } finally { closeSync(descriptor); }
}

export function loadOrCreatePrivateWindowsMasterKey(file: string, allowCreate: boolean): string {
  assertUnlinkedParents(file);
  let existed = false;
  try { lstatSync(file); existed = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Once this attempt observed an existing identity, a later ENOENT is a read
  // race, not authorization to mint a replacement key for existing ciphertext.
  if (existed) return readPrivateWindowsMasterKey(file);
  if (!allowCreate) throw new Error(`Secrets master key file is missing: ${file}`);
  const directory = path.dirname(file);
  const parent = ensurePrivateDirectory(directory);
  const temporary = `${file}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
  let owned: { dev: bigint; ino: bigint } | undefined;
  let created = false;
  const ownsTemporaryEntry = () => {
    const stat = lstatSync(temporary, { bigint: true });
    return owned !== undefined && stat.isFile() && !stat.isSymbolicLink() && stat.dev === owned.dev && stat.ino === owned.ino;
  };
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    created = true;
    try {
      owned = fstatSync(descriptor, { bigint: true });
      protectNewPrivatePath(temporary);
      if (!ownsTemporaryEntry() || fstatSync(descriptor, { bigint: true }).size !== 0n) throw privateStorageError();
      writeFileSync(descriptor, randomBytes(32).toString("base64"), "utf8");
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    readPrivateWindowsMasterKey(temporary);
    const current = privateDirectory(directory);
    if (current.dev !== parent.dev || current.ino !== parent.ino || !ownsTemporaryEntry()) throw privateStorageError();
    try { linkSync(temporary, file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return readPrivateWindowsMasterKey(file);
  } finally {
    if (created) {
      try { if (!ownsTemporaryEntry()) throw privateStorageError(); unlinkSync(temporary); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
}
