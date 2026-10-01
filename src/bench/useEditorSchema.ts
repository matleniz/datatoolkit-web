/**
 * Transform catalogue + schema of the op open in the editor (fields, gap
 * error, params seeding).
 */
import { useRef, type Dispatch } from "react";

import { apiClient } from "../api/client";
import type { WorkspaceRowsColumn } from "../api/types";
import { useKeyedAsync } from "../hooks";
import type { AppAction, EditorState } from "../state/reducer";
import { editStepParams, resolveOp, seedEditorParams } from "./presets";
import {
  schemaFieldsGap,
  schemaToFields,
  type EditorField,
} from "./schemaFields";

export interface TransformInfo {
  op: string;
  title: string;
  description: string;
}

const NO_TRANSFORMS: TransformInfo[] = [];
const NO_FIELDS: EditorField[] = [];

/**
 * Key of the editor "session": the op plus how many times the editor went from
 * closed to open, so reopening the same op re-seeds its params.
 */
function useEditorSessionKey(op: string | null): string | null {
  const session = useRef<{ op: string | null; opened: number }>({
    op: null,
    opened: 0,
  });
  if (session.current.op !== op) {
    if (!session.current.op) session.current.opened++;
    session.current.op = op;
  }
  return op ? `${op}#${session.current.opened}` : null;
}

export function useEditorSchema(
  editor: EditorState | null,
  columns: WorkspaceRowsColumn[],
  dispatch: Dispatch<AppAction>,
) {
  // The picker still works from OP_STAGE when the catalogue fails to load.
  const catalogue = useKeyedAsync("catalogue", async () =>
    (await apiClient.listTransforms()).map((t): TransformInfo => ({
      op: t.op,
      title: t.title,
      description: t.description,
    })),
  );

  // Keyed on the op only (not columns) so the fetch is not cancelled when the
  // grid reloads after Apply.
  const sessionKey = useEditorSessionKey(editor?.op ?? null);
  const schema = useKeyedAsync(sessionKey, async (alive) => {
    const op = resolveOp(editor!.op!);
    const json = await apiClient.transformSchema(op);
    const fields = schemaToFields(json, op);
    if (alive()) {
      const { params, editIndex } = editor!;
      dispatch({
        type: "SET_EDITOR_PARAMS",
        params:
          editIndex === undefined
            ? seedEditorParams(json, op, params, columns)
            : editStepParams(json, params),
      });
    }
    return { fields, gap: schemaFieldsGap(json, fields) };
  });

  const loaded = sessionKey !== null && schema.ready;
  return {
    transforms: catalogue.value ?? NO_TRANSFORMS,
    schemaFields: loaded ? (schema.value?.fields ?? NO_FIELDS) : NO_FIELDS,
    schemaLoading: sessionKey !== null && !schema.ready,
    schemaError: loaded ? (schema.error ?? schema.value?.gap ?? null) : null,
  };
}
