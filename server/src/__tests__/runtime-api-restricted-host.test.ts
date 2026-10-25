import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { collectReachableInterfaceHosts } from "../runtime-api.js";
afterEach(() => vi.restoreAllMocks());
it("keeps configured loopback deployment usable when interface enumeration is unavailable", () => {
  vi.spyOn(os, "networkInterfaces").mockImplementation(() => { throw new Error("restricted host"); });
  expect(collectReachableInterfaceHosts()).toEqual([]);
});
