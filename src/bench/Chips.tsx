import type { ReactNode } from "react";

/** Row of toggle chips; `small` = column chips. */
export function Chips<T extends string | boolean>({
  options,
  isOn,
  onPick,
  label,
  small,
  text = String,
  chipLabel,
  children,
}: {
  options: readonly T[];
  isOn: (o: T) => boolean;
  onPick: (o: T) => void;
  label?: string;
  small?: boolean;
  text?: (o: T) => string;
  chipLabel?: (o: T) => string;
  children?: ReactNode;
}) {
  const cls = small ? "small-chip" : "chip";
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {options.map((o) => {
        const on = isOn(o);
        return (
          <button
            key={String(o)}
            type="button"
            className={on ? `${cls} on` : cls}
            aria-pressed={on}
            aria-label={chipLabel?.(o)}
            onClick={() => onPick(o)}
          >
            {text(o)}
          </button>
        );
      })}
      {children}
    </div>
  );
}
