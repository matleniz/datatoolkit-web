import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { skeletonWidths } from "./widths";
import "./placeholder.css";

type Size = number | string;
const px = (v: Size | undefined) => (typeof v === "number" ? `${v}px` : v);

interface SkeletonProps {
  /** Width in px, or any CSS length. Default: the full width of the parent. */
  width?: Size;
  /** Height in px, or any CSS length. Default: one line of text (1em). */
  height?: Size;
  /** Border radius; defaults to `--dtk-skeleton-radius`. */
  radius?: Size;
  className?: string;
  style?: CSSProperties;
}

/**
 * One shimmering block. Purely decorative (`aria-hidden`): wrap blocks in a
 * {@link PendingRegion} to tell assistive tech what is loading. Give it the
 * size of the content it stands for, so nothing moves when the data arrives.
 */
export function Skeleton({ width, height, radius, className, style }: SkeletonProps) {
  return (
    <span
      className={className ? `sk ${className}` : "sk"}
      aria-hidden="true"
      style={{ width: px(width), height: px(height), borderRadius: px(radius), ...style }}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  /** Varies the line lengths; the last line is always shorter. */
  seed?: number;
  /** Height of one line box in px (the glyph bar is a little shorter). */
  lineHeight?: number;
}

/** A paragraph of `lines` bars, `lineHeight` px apart. */
export function SkeletonText({ lines = 3, seed = 0, lineHeight = 18 }: SkeletonTextProps) {
  const widths = skeletonWidths(lines, seed, 70, 100);
  if (lines > 1) widths[lines - 1] = Math.min(widths[lines - 1]!, 60);
  return (
    <span className="sk-text" aria-hidden="true">
      {widths.map((w, i) => (
        <span key={i} className="sk-text-line" style={{ height: lineHeight }}>
          <Skeleton width={`${w}%`} height={Math.round(lineHeight * 0.6)} />
        </span>
      ))}
    </span>
  );
}

interface SkeletonRowProps {
  /** One width (px) per cell. */
  widths: number[];
  /** Cell height (px or CSS length); match the real row (its borders come on top). */
  height: Size;
  className: string;
  cellClassName: string;
  /** Shown before the cells (e.g. the row number column). */
  lead?: ReactNode;
  /** Fraction of the cell filled by the bar, varied per cell. */
  seed?: number;
}

/** A row of cells, each `widths[i]` px wide, with a varied bar in each. */
export function SkeletonRow({
  widths,
  height,
  className,
  cellClassName,
  lead,
  seed = 0,
}: SkeletonRowProps) {
  const bars = skeletonWidths(widths.length, seed, 40, 85);
  return (
    <div className={className} aria-hidden="true">
      {lead}
      {widths.map((w, i) => (
        <span
          key={i}
          className={cellClassName}
          style={{ width: w, height: px(height), flexShrink: 0 }}
        >
          <Skeleton width={`${bars[i]}%`} height={12} />
        </span>
      ))}
    </div>
  );
}

interface SpinnerProps {
  className?: string;
}

/** The indeterminate spinner. Decorative: pair it with a text label. */
export function Spinner({ className }: SpinnerProps) {
  const cls = className ? `sk-spinner ${className}` : "sk-spinner";
  return <span className={cls} aria-hidden="true" />;
}

interface PendingRegionProps {
  /** What is loading; read out by screen readers, e.g. "Loading suggestions". */
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps skeletons with a polite live-region label (visually hidden). Mount it
 * while data is awaited and unmount it on arrival; the children are hidden
 * from assistive tech, so only the label is announced.
 */
export function PendingRegion({ label, className, children }: PendingRegionProps) {
  // A live region announces changes, not its first content: mount it empty.
  const [announced, setAnnounced] = useState("");
  useEffect(() => setAnnounced(label), [label]);
  return (
    <div className={className} role="status" aria-live="polite" data-pending="1">
      <span className="sr-only">{announced}</span>
      <div aria-hidden="true" className="sk-region-body">
        {children}
      </div>
    </div>
  );
}
