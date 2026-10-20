/**
 * In-flight request dedupe: identical method+path+body shares one Promise.
 * Collapses React StrictMode double-mounts and concurrent duplicate callers.
 */

type RequestRunner<T> = () => Promise<T>;

interface Shared {
  promise: Promise<unknown>;
  refs: number;
  settled: boolean;
  ac: AbortController;
}

/** One caller's stake in a shared request (reference-counted, #250). */
export interface Subscription<T> {
  promise: Promise<T>;
  /** Drop this caller; the fetch is aborted once every caller has left. */
  leave(): void;
}

export class InFlightDedupe {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly shared = new Map<string, Shared>();

  key(method: string, path: string, body?: string): string {
    return `${method}\0${path}\0${body ?? ""}`;
  }

  run<T>(key: string, run: RequestRunner<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = run().finally(() => {
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key);
      }
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Like `run`, but each caller gets its own `leave()`: the underlying request
   * (started with an abort signal) is aborted only when every subscriber has
   * left, so one caller cancelling never fails the others (#250).
   */
  join<T>(key: string, start: (signal: AbortSignal) => Promise<T>): Subscription<T> {
    let entry = this.shared.get(key);
    if (!entry) {
      const ac = new AbortController();
      const created: Shared = {
        ac,
        refs: 0,
        settled: false,
        promise: Promise.resolve(),
      };
      created.promise = start(ac.signal).finally(() => {
        created.settled = true;
        if (this.shared.get(key) === created) this.shared.delete(key);
      });
      this.shared.set(key, created);
      entry = created;
    }
    const e = entry;
    e.refs += 1;
    let left = false;
    return {
      promise: e.promise as Promise<T>,
      leave: () => {
        if (left) return;
        left = true;
        e.refs -= 1;
        if (e.refs === 0 && !e.settled) {
          if (this.shared.get(key) === e) this.shared.delete(key);
          e.ac.abort();
        }
      },
    };
  }

  /**
   * Forget the in-flight GETs whose path starts with `prefix`: the next
   * identical read goes out again instead of joining an answer that was
   * computed before a write (#244). Writes keep their dedupe; callers already
   * holding a promise keep it.
   */
  invalidateReads(prefix: string): void {
    for (const key of this.inflight.keys()) {
      const [method, path] = key.split("\0");
      if (method === "GET" && path?.startsWith(prefix)) {
        this.inflight.delete(key);
      }
    }
    for (const key of this.shared.keys()) {
      const [method, path] = key.split("\0");
      if (method === "GET" && path?.startsWith(prefix)) {
        this.shared.delete(key);
      }
    }
  }

  clear(): void {
    this.inflight.clear();
    this.shared.clear();
  }
}
