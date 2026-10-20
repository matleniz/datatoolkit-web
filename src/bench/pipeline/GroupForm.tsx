import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { validateGroupName } from "../../state/stepGroups";

const INTENT_MAX = 400;

/**
 * The name (required) and intent (optional) of a group, inline under the
 * pipeline bar (datatoolkit-issues#249). Enter in the name field saves, Escape
 * cancels, a refused name shows its reason next to the field and nothing is
 * sent. The caller puts the focus back on the row.
 */
export function GroupForm({
  title,
  submitLabel,
  initialName,
  initialIntent,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  initialName: string;
  initialIntent: string;
  onSubmit: (name: string, intent: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [intent, setIntent] = useState(initialIntent);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checked = validateGroupName(name);
    if ("error" in checked) {
      setError(checked.error);
      nameRef.current?.focus();
      return;
    }
    onSubmit(checked.name, intent);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="pipeline-group-form" aria-label={title} onSubmit={submit} onKeyDown={onKeyDown} noValidate>
      <label>
        Group name
        <input
          ref={nameRef}
          type="text"
          value={name}
          required
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "pipeline-group-form-error" : undefined}
          placeholder="e.g. Impute ledd"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </label>
      {error ? (
        <p id="pipeline-group-form-error" className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <label>
        Intent (optional)
        <textarea
          rows={3}
          maxLength={INTENT_MAX}
          value={intent}
          placeholder="Why these steps belong together"
          onChange={(e) => setIntent(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
