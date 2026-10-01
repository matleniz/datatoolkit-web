import { describe, expect, it } from "vitest";

import type { JsonSchema, Step } from "../src/api/types";
import { editStepParams } from "../src/bench/presets";
import { editorBaseVersion } from "../src/bench/version";
import {
  appReducer,
  emptyWorkspace,
  initialState,
  type AppAction,
  type AppState,
} from "../src/state/reducer";

const impute: Step = {
  op: "impute",
  target: "both",
  params: { columns: ["age"], strategy: "median" },
};
const scale: Step = { op: "scale", target: "train", params: { columns: ["age"] } };
const onehot: Step = { op: "onehot", target: "both", params: { columns: ["plan"] } };

const run = (s: AppState, ...actions: AppAction[]) => actions.reduce(appReducer, s);
const loaded = run(
  initialState,
  { type: "SET_WORKSPACE", workspace: emptyWorkspace("demo") },
  { type: "ADD_STEP", step: impute },
  { type: "ADD_STEP", step: scale },
  { type: "ADD_STEP", step: onehot },
);

describe("edit an applied step (datatoolkit-issues#10)", () => {
  it("EDIT_STEP opens the editor pre-filled and pins the step's input version", () => {
    const s = run(loaded, { type: "EDIT_STEP", index: 1 });
    expect(s.editor).toEqual({
      op: "scale",
      params: { columns: ["age"] },
      target: "train",
      editIndex: 1,
    });
    expect(s.viewVersion).toBe(1);
    expect(editorBaseVersion(s.workspace!, s.editor!.editIndex)).toBe(1);
    expect(editorBaseVersion(s.workspace!, undefined)).toBe(3);
    // Time travel is ignored while editing; an unknown index is a no-op.
    expect(run(s, { type: "SET_VIEW_VERSION", version: null }).viewVersion).toBe(1);
    expect(run(loaded, { type: "EDIT_STEP", index: 9 })).toBe(loaded);
  });

  it("REPLACE_STEP replaces at the same index, keeps later steps, replays at latest", () => {
    const edited: Step = { ...scale, params: { columns: ["age"], method: "minmax" } };
    const s = run(
      loaded,
      { type: "EDIT_STEP", index: 1 },
      { type: "REPLACE_STEP", index: 1, step: edited },
    );
    expect(s.workspace!.steps).toEqual([impute, edited, onehot]);
    expect(s.editor).toBeNull();
    expect(s.viewVersion).toBeNull();
  });

  it("keeps an alignment step's align flag", () => {
    const align: Step = { ...impute, align: true };
    const s = run(
      loaded,
      { type: "ADD_ALIGN_STEP", step: align },
      { type: "REPLACE_STEP", index: 0, step: { ...impute, params: { columns: ["x"] } } },
    );
    expect(s.workspace!.steps[0]).toEqual({ ...impute, params: { columns: ["x"] }, align: true });
  });

  it("an edit is undoable and redoable", () => {
    const edited: Step = { ...impute, params: { columns: ["age"], strategy: "mean" } };
    let s = run(
      loaded,
      { type: "EDIT_STEP", index: 0 },
      { type: "REPLACE_STEP", index: 0, step: edited },
    );
    s = run(s, { type: "UNDO_STEPS" });
    expect(s.workspace!.steps).toEqual([impute, scale, onehot]);
    s = run(s, { type: "REDO_STEPS" });
    expect(s.workspace!.steps).toEqual([edited, scale, onehot]);
  });

  it("Discard or a new step leaves the edit and goes back to latest", () => {
    const editing = run(loaded, { type: "EDIT_STEP", index: 0 });
    const closed = run(editing, { type: "CLOSE_EDITOR" });
    expect(closed.editor).toBeNull();
    expect(closed.viewVersion).toBeNull();
    expect(closed.workspace!.steps).toBe(loaded.workspace!.steps);
    expect(closed.stepHistory).toBe(loaded.stepHistory);
    const fresh = run(editing, { type: "OPEN_EDITOR", op: "impute" });
    expect(fresh.editor?.editIndex).toBeUndefined();
    expect(fresh.viewVersion).toBeNull();
    // Outside an edit, closing keeps the viewed version.
    const travel = run(
      loaded,
      { type: "SET_VIEW_VERSION", version: 1 },
      { type: "OPEN_EDITOR", op: "scale" },
      { type: "CLOSE_EDITOR" },
    );
    expect(travel.viewVersion).toBe(1);
  });

  it("edit params: the step's params over the schema defaults, no Studio preset", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        columns: { type: "array", items: { type: "string" } },
        lower: { type: "boolean", default: false },
        strip: { type: "boolean", default: true },
      },
    };
    // standardize_text's Studio default is lower=true; an edit must not apply it.
    expect(editStepParams(schema, { columns: ["site"], strip: false })).toEqual({
      columns: ["site"],
      lower: false,
      strip: false,
    });
  });
});
