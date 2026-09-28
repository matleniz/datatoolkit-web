/**
 * In-flight request dedupe: identical method+path+body shares one Promise.
 * Collapses React StrictMode double-mounts and concurrent duplicate callers.
 */

export type RequestRunner<T> = () => Promise<T>;

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

  clear(): void {
    this.inflight.clear();
  }
}
