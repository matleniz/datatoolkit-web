/**
 * In-flight request dedupe: identical method+path+body shares one Promise.
 * Collapses React StrictMode double-mounts and concurrent duplicate callers.
 */

type RequestRunner<T> = () => Promise<T>;

export class InFlightDedupe {
  private readonly inflight = new Map<string, Promise<unknown>>();

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
   * Forget the in-flight requests whose path starts with `prefix`: the next
   * identical call goes out again instead of joining an answer that was
   * computed before a write (#244). Callers already holding a promise keep it.
   */
  invalidate(prefix: string): void {
    for (const key of this.inflight.keys()) {
      if (key.split("\0")[1]?.startsWith(prefix)) this.inflight.delete(key);
    }
  }

  clear(): void {
    this.inflight.clear();
  }
}
