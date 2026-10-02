import { AlignScreen } from "./screens/align/AlignScreen";
import { SourcesScreen } from "./screens/sources/SourcesScreen";
import { AgentBridge } from "./bench/agent/AgentBridge";
import { Workbench } from "./bench/Workbench";
import { useAppDispatch, useAppState } from "./state/AppStore";
import type { ScreenId } from "./state/reducer";
import "./App.css";

const SCREENS: { id: ScreenId; n: number; label: string }[] = [
  { id: "sources", n: 1, label: "Sources" },
  { id: "align", n: 2, label: "Align train / test" },
  { id: "bench", n: 3, label: "Workbench" },
];

export function App() {
  const { screen, role, workspace, alignToDecideCount } = useAppState();
  const dispatch = useAppDispatch();
  const wsName = workspace?.name ?? "no workspace";
  const alignCount =
    alignToDecideCount !== undefined && alignToDecideCount !== null
      ? alignToDecideCount
      : (workspace?.steps.filter((s) => s.align).length ?? 0);

  return (
    <div className="app-shell" data-root="1">
      <header className="app-header">
        <div className="brand" aria-label="datatoolkit Studio">
          <span className="brand-mark">datatoolkit</span>
          <span className="brand-sub">Studio</span>
        </div>

        <nav className="screen-tabs" aria-label="Screens">
          {SCREENS.map((s) => {
            const on = screen === s.id;
            const showBadge = s.id === "align" && alignCount > 0;
            return (
              <button
                key={s.id}
                type="button"
                className={on ? "screen-tab on" : "screen-tab"}
                aria-current={on ? "page" : undefined}
                onClick={() =>
                  dispatch({ type: "SET_SCREEN", screen: s.id })
                }
              >
                <span className="screen-num">{s.n}</span>
                {s.label}
                {showBadge ? (
                  <span className="align-badge" aria-label="Alignment steps">
                    {alignCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="header-spacer" />

        <div className="workspace-chip" title="Active workspace">
          <span>workspace</span>
          <strong>{wsName}</strong>
        </div>

        {screen === "bench" ? (
          <div
            className="role-toggle"
            role="group"
            aria-label="Dataset shown"
          >
            <button
              type="button"
              className={role === "train" ? "on" : undefined}
              aria-pressed={role === "train"}
              onClick={() => dispatch({ type: "SET_ROLE", role: "train" })}
            >
              Train
            </button>
            <button
              type="button"
              className={role === "test" ? "on" : undefined}
              aria-pressed={role === "test"}
              onClick={() => dispatch({ type: "SET_ROLE", role: "test" })}
            >
              Test
            </button>
          </div>
        ) : null}
      </header>

      {screen === "sources" ? <SourcesScreen /> : null}
      {screen === "align" ? <AlignScreen /> : null}
      {screen === "bench" ? <Workbench /> : null}
      <AgentBridge />
    </div>
  );
}
