import type { useGroupEditing } from "./useGroupEditing";
import { GroupForm } from "./GroupForm";

type Editing = ReturnType<typeof useGroupEditing>;

/** "Group N rows" / "Clear" and the reason when the ticked rows cannot be grouped (#249). */
export function GroupToolbar({ editing }: { editing: Editing }) {
  const { selecting, setSelecting, canSelect, picked, setPicked, setForm, refocus, pickedSteps, firstStepOf } = editing;
  if (!selecting) {
    return canSelect ? (
      <button
        type="button"
        className="pipeline-group-select"
        title="Tick neighbouring rows and make them one group"
        onClick={() => setSelecting(true)}
      >
        Group rows…
      </button>
    ) : null;
  }
  let hint = "These rows are not side by side. Select neighbouring rows to group them.";
  if (picked.size === 0) hint = "Tick two or more neighbouring rows.";
  else if (pickedSteps !== null) hint = "Rows side by side: they will become one group.";
  else if (picked.size < 2) hint = "Select at least two rows to group them.";
  return (
    <div className="pipeline-group-tools">
      <button
        type="button"
        className="pipeline-group-do"
        aria-disabled={pickedSteps === null}
        aria-describedby="pipeline-group-hint"
        onClick={() => {
          if (pickedSteps !== null) setForm({ kind: "group" });
        }}
      >
        Group {picked.size} rows
      </button>
      <button
        type="button"
        onClick={() => {
          refocus.current = firstStepOf(picked);
          setPicked(new Set());
          setSelecting(false);
        }}
      >
        Cancel
      </button>
      <span id="pipeline-group-hint" className="hint" role="status">
        {hint}
      </span>
    </div>
  );
}

/** The name / intent form of a new group or of a rename, when one is open. */
export function GroupFormHost({ editing }: { editing: Editing }) {
  const { picked, form, setForm, refocus, firstStepOf, submitForm } = editing;
  if (!form) return null;
  const isNew = form.kind === "group";
  return (
    <GroupForm
      key={isNew ? "group" : form.id}
      title={isNew ? "Name the new group" : "Rename group"}
      submitLabel={isNew ? "Group" : "Save"}
      initialName={isNew ? "" : form.name}
      initialIntent={isNew ? "" : form.intent}
      onSubmit={submitForm}
      onCancel={() => {
        refocus.current = firstStepOf(isNew ? picked : [form.id]);
        setForm(null);
      }}
    />
  );
}
