# Studio behaviour notes

Implementation notes on how Studio behaves; the spec is `FRONT-WEB.md` in
the docs hub (see the [README](../README.md#docs)).

Saved charts (datatoolkit-issues#11) live on the engine workspace
(`Workspace.charts`, `{name, params}`): **Save chart** PUTs the workspace with
the new chart through the save gate's ordered chain (`saveWorkspaceNow`) and
only then updates the store, so the engine's error is shown in the chart bar;
a name already saved gets the engine's 422 `duplicate chart name '<name>'`
with a **Replace** action. Charts come back with the workspace on load /
reload, ride along on any later PUT (the Sources rebuild carries them like
steps), and are left out of frame / analysis request bodies and of the data
identity, so a chart save never refetches data. Charts saved by older builds
in `localStorage["dtk.charts.<workspace>"]` are adopted once when the engine
workspace has none, and the key is removed after the next successful save.

Workspace saves (`src/state/workspaceSaveGate.ts`): every autosave and
explicit gate save runs on one ordered chain. A workspace read from the engine
(bootstrap, selecting it on Sources) is marked as saved, so it is not PUT
straight back. Deleting workspaces tombstones their names (no queued or
debounced save runs for them; other workspaces keep saving) and waits for the
PUT already on the wire before the DELETE: an aborted fetch could still be
applied by the engine after the delete (datatoolkit-issues#13). A PUT that
lands for a tombstoned name is deleted again, and the sidebar treats a 404 on
DELETE as already deleted.

Suggestions can be dismissed (datatoolkit-issues#15): browser-local, per
workspace (`localStorage["dtk.dismissedSuggestions.<workspace>"]`). The id
hashes the key, the suggested step (op / target / params) and the finding
(column, title, detail), so a finding stays hidden after an unrelated step
and shows again once its content changes; "Show dismissed" lists the hidden
ones with a Restore action. No key-specific logic.

Step editor fields come from the transform schema (`src/bench/schemaFields.ts`),
with two generic hints (datatoolkit-issues#48), no op-specific code:
`x-dtk-when` (`{sibling: value or list of values}`) shows, validates and sends
a param only while every listed sibling has one of those values (e.g. impute's
`by` / `order` / `fallback` / `expr` / `fill_value` follow `strategy`); an
empty `x-dtk-semantic` param (e.g. `impute.by`, `ffill.by` = `group_id`) is
prefilled when the editor opens with the frame's column whose `workspace_rows`
`semantic` matches, only when exactly one column does. The formula palette and
autocomplete also offer `group_mean` / `group_prev` / `group_interp`. An engine error on the formula
(`formula` and `impute(strategy=formula)`) is shown right under the Expr field,
which gets a red outline, not at the bottom of the panel.

No router: the three screens (Sources, Alignment, Workbench) are reducer
state (`SET_SCREEN`); nginx serves `index.html` for any path.

Workbench layout (prototype sizes, `src/theme/tokens.css`): pipeline
**96px**, left **280px**, inspector **318px**, tool rail **56px**.

Pipeline undo / redo (datatoolkit-issues#16): the pipeline bar's ↶ / ↷
buttons, Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (or Ctrl+Y) undo / redo changes to
the workspace's steps (add, edit, remove, alignment steps) and replay at the latest
version. History is in memory (`AppState.stepHistory`, 100 levels,
`src/state/stepHistory.ts`), reset when another workspace is loaded; disabled
while a step is being edited, and the shortcuts leave text fields alone.
Variables, charts and the target are not part of it.

Edit an applied step (datatoolkit-issues#10): a pipeline step node's ✎ button,
or right-click → **Edit step**, opens the step editor pre-filled with the
step's op, target and params (`EDIT_STEP`; the params are the step's own over
the schema defaults, no Studio preset or prefill). While editing, the view is
pinned to the step's input version, the live preview runs on the steps before
it, and Apply stays disabled until something changed; Apply replaces the step
at its index (`REPLACE_STEP`, alignment flag kept, later steps kept) and the
pipeline replays at the latest version, as one undoable change. Discard goes
back to the latest version.
