import { setTerminalPanelOpen, useTerminalPanelOpen } from "./terminalOpen";

/** Tool rail icon that opens / closes the opt-in terminal panel (datatoolkit-issues#115). */
export function TerminalRailButton() {
  const open = useTerminalPanelOpen();
  return (
    <button
      type="button"
      className={open ? "tool-btn on" : "tool-btn"}
      aria-label="Terminal"
      aria-pressed={open}
      title="Terminal · run a CLI agent as-is (weaker guarantee)"
      onClick={() => setTerminalPanelOpen(!open)}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
        <path d="M6 8.5l2.5 2L6 12.5M10.5 13h3.5" />
      </svg>
    </button>
  );
}
