import { useEffect, useState } from "react";
import { cancelInFlight, type BusyScope } from "./api/inflight";
import { useInFlight } from "./useInFlight";

/** A request shorter than this never flashes the indicator. */
const SHOW_AFTER_MS = 150;
/** ...and it stays this long once shown, bridging back-to-back requests. */
const HOLD_MS = 250;

interface BusyIndicatorProps {
  scope: BusyScope;
  /** What is loading, e.g. "Loading the dataset…". */
  label: string;
  /** Show the Cancel button (the request is abortable). */
  cancellable?: boolean;
}

/**
 * Spinner + label + Cancel while a `scope` request is in flight. The slot
 * keeps its height when idle, so the layout does not jump.
 */
export function BusyIndicator({ scope, label, cancellable = true }: BusyIndicatorProps) {
  const count = useInFlight(scope);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (count === 0) {
      // Hold briefly: sequential requests must not make the indicator blink.
      const t = window.setTimeout(() => setShown(false), HOLD_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [count > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = count > 0 && shown;
  return (
    <div
      className="busy-slot"
      role="status"
      aria-live="polite"
      data-busy={busy ? scope : undefined}
    >
      {busy ? (
        <>
          <span className="busy-spinner" aria-hidden="true" />
          <span className="busy-label">{label}</span>
          {cancellable ? (
            <button
              type="button"
              className="link-btn busy-cancel"
              onClick={() => cancelInFlight(scope)}
            >
              Cancel
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
