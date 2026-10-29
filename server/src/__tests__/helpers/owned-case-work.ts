/** A timeout ends Vitest's wait, not the callback or its SQL work. */
class OwnedCaseWork {
  private readonly work = new Set<Promise<unknown>>();
  private readonly releases = new Set<() => void>();
  private readonly finalizers: Array<() => Promise<unknown> | void> = [];
  private closing = false;
  private cleanup: Promise<void> | null = null;
  private cleanupFinished = false;
  private cleanupFailed = false;
  private cleanupFailure: unknown;

  track<T>(work: Promise<T>): Promise<T> {
    this.work.add(work);
    // Attach an observer immediately, but return the exact original promise:
    // the test still owns its success/rejection assertions.
    void work.then(() => undefined, () => undefined);
    return work;
  }

  signal() {
    let open!: () => void;
    const promise = new Promise<void>(resolve => { open = resolve; });
    const resolve = () => { this.releases.delete(resolve); open(); };
    this.releases.add(resolve);
    // A timed-out body may create another fixture gate while it is draining.
    if (this.closing) resolve();
    return { promise, resolve };
  }

  finally(finalizer: () => Promise<unknown> | void) { this.finalizers.push(finalizer); }

  async close() {
    // Do not spend another full hook deadline on every refused successor.
    // If the original cleanup eventually finishes, observing it is safe.
    if (this.cleanupFailed && !this.cleanupFinished) throw this.cleanupFailure;
    this.closing = true;
    for (const release of [...this.releases]) release();
    this.cleanup ??= (async () => {
      let observed: number;
      do {
        observed = this.work.size;
        await Promise.allSettled([...this.work]);
      } while (this.work.size !== observed);
      let failed: { error: unknown } | undefined;
      for (const finalizer of this.finalizers) {
        try { await finalizer(); } catch (error) { failed ??= { error }; }
      }
      if (failed) throw failed.error;
      this.cleanupFinished = true;
    })();
    let deadline!: ReturnType<typeof setTimeout>;
    try {
      // This leaves headroom inside the existing 30s hook budget.
      await Promise.race([this.cleanup, new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(Error("Owned test work did not drain within 25000ms; preserving its scope")), 25_000);
      })]);
    } catch (error) { this.cleanupFailed = true; this.cleanupFailure = error; throw error; }
    finally { clearTimeout(deadline); }
  }
}

export function ownedCaseWorkScope() {
  let active: OwnedCaseWork | null = null;
  return {
    assertIdle() {
      if (active) throw Error("Previous owned test work has not drained; refusing another case");
    },
    run(body: () => Promise<void>) {
      this.assertIdle();
      active = new OwnedCaseWork();
      // Register the body before its first instruction, including setup awaits.
      return active.track(Promise.resolve().then(body));
    },
    current() {
      if (!active) throw Error("Fixture work must be registered inside an owned case");
      return active;
    },
    async drain() {
      if (!active) return;
      await active.close();
      active = null;
    },
  };
}
