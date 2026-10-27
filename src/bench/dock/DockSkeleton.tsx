import { PendingRegion, Skeleton, SkeletonText } from "../../placeholder/Skeleton";

/**
 * An analysis window while its result is awaited: a title, a chart-sized block
 * (`.hist-bars.tall` is 110px) and a few lines. The label stays "Loading…":
 * the e2e helpers wait for that text to go.
 */
export function DockSkeleton() {
  return (
    <PendingRegion label="Loading…" className="dock-skeleton">
      <Skeleton width="40%" height={12} />
      <Skeleton height={110} radius={6} />
      <SkeletonText lines={3} seed={7} lineHeight={18} />
    </PendingRegion>
  );
}
