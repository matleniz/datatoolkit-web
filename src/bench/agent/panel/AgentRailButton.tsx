import { setAgentPanelOpen, useAgentPanelOpen } from "./panelOpen";

/** Tool rail icon that opens / closes the agent panel (datatoolkit-issues#67). */
export function AgentRailButton() {
  const open = useAgentPanelOpen();
  return (
    <button
      type="button"
      className={open ? "tool-btn tool-btn-agent on" : "tool-btn tool-btn-agent"}
      aria-label="Agent"
      aria-pressed={open}
      title="Agent · chat"
      onClick={() => setAgentPanelOpen(!open)}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 4.5h13v9h-7l-3.5 3v-3h-2.5z" />
        <path d="M7 9h.01M10 9h.01M13 9h.01" strokeWidth="2" />
      </svg>
    </button>
  );
}
