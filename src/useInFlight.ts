import { useSyncExternalStore } from "react";
import { inFlightCount, subscribeInFlight, type BusyScope } from "./api/inflight";

/** Requests of `scope` currently on the wire (datatoolkit-issues#247). */
export function useInFlight(scope: BusyScope): number {
  return useSyncExternalStore(subscribeInFlight, () => inFlightCount(scope));
}
