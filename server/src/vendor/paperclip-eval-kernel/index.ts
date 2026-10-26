/** Source-mode shim, following the existing paperclip-runner vendor boundary.
 * The server build overwrites the emitted shim with the kernel dist tree;
 * published server code must never load a private workspace package/source. */
type KernelModule = typeof import("@paperclipai/paperclip-eval-kernel");
const sourceUrl = new URL("../../../../packages/paperclip-eval-kernel/src/index.ts", import.meta.url);
const kernel = (await import(sourceUrl.href)) as KernelModule;
export const runPaperclipEvalMatrix = kernel.runPaperclipEvalMatrix;
