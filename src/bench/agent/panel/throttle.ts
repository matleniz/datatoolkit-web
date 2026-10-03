/**
 * Forward pushed values to `emit` at most once per `ms`; the last value always
 * lands (trailing emit). Used to throttle the Markdown render of a streaming
 * agent reply (datatoolkit-issues#131).
 */
export interface Throttle<T> {
  push(value: T): void;
  cancel(): void;
}

export function createThrottle<T>(ms: number, emit: (value: T) => void): Throttle<T> {
  let lastAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: T;
  const flush = () => {
    timer = undefined;
    lastAt = Date.now();
    emit(pending);
  };
  return {
    push(value) {
      pending = value;
      if (timer !== undefined) return;
      const wait = lastAt + ms - Date.now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
