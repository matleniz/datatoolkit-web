import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { ColumnKind } from "../../api/types";
import { useAppState } from "../../state/AppStore";
import { isNumericKind } from "../kinds";
import { useWorkbenchData } from "../WorkbenchData";
import { formulaPlaceholder } from "./formulaPlaceholder";
import {
  FORMULA_FUNCS,
  FORMULA_OPS,
  formulaPyExamples,
  formulaColumnRef,
  applyFormulaAutocomplete,
  formulaAutocomplete,
  formulaTokenAt,
} from "./formulaFuncs";

interface PaletteItem {
  insert: string;
  label: string;
  help: string;
}

function Palette<T extends PaletteItem>({
  items,
  marker,
  aria,
  onPick,
}: {
  items: readonly T[];
  marker: Record<string, string>;
  aria: (item: T) => string;
  onPick: (item: T) => void;
}) {
  return (
    <div className="chip-row formula-palette" {...marker}>
      {items.map((f) => (
        <button
          key={f.insert}
          type="button"
          className="tiny-chip"
          title={f.help}
          aria-label={aria(f)}
          onClick={() => onPick(f)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** Formula expression widget: chips, function palette, autocomplete, inline status. */
export function FormulaField({
  label,
  expr,
  onExprChange,
  columns,
  variables,
  nameSet,
}: {
  label: string;
  expr: string;
  onExprChange: (expr: string) => void;
  columns: { name: string; kind: ColumnKind }[];
  variables: { name: string; stat: string; column: string }[];
  /** True when output name is set (used for OK status). */
  nameSet: boolean;
}) {
  const { selection } = useAppState();
  const { preview, previewError } = useWorkbenchData();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const selected = selection.columns;
  const numCols = columns.filter((c) => isNumericKind(c.kind));
  const selectedNums = selected.filter((n) =>
    numCols.some((c) => c.name === n),
  );
  const otherNums = numCols
    .map((c) => c.name)
    .filter((n) => !selectedNums.includes(n));
  // Selected columns first as chips (MAT-173), then the rest.
  const chipCols = [...selectedNums, ...otherNums];
  const varNames = variables.map((v) => v.name);

  const insertAtCaret = useCallback(
    (txt: string, withSpace = true) => {
      const el = inputRef.current;
      const start = el?.selectionStart ?? expr.length;
      const end = el?.selectionEnd ?? start;
      const before = expr.slice(0, start);
      const after = expr.slice(end);
      const padBefore =
        withSpace && before.length > 0 && !/\s$/.test(before) ? " " : "";
      const padAfter =
        withSpace && after.length > 0 && !/^\s/.test(after) ? " " : "";
      const next = `${before}${padBefore}${txt}${padAfter}${after}`;
      const newCaret = before.length + padBefore.length + txt.length;
      onExprChange(next);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(newCaret, newCaret);
        setCaret(newCaret);
      });
    },
    [expr, onExprChange],
  );

  const syncCaret = () => {
    const el = inputRef.current;
    if (el) setCaret(el.selectionStart ?? 0);
  };

  const token = formulaTokenAt(expr, caret);
  const suggestions = useMemo(() => {
    if (!token || token.token.length < 1) return [];
    return formulaAutocomplete(
      token.token,
      columns.map((c) => c.name),
      varNames,
    );
  }, [token, columns, varNames]);

  const tokenText = token?.token;
  useEffect(() => {
    setActiveIdx(0);
    // Nothing left to complete once the token is already the only candidate.
    const complete = suggestions.every((s) => s === tokenText);
    setSuggestOpen(suggestions.length > 0 && !complete);
  }, [suggestions, tokenText]);

  const applyPick = (pick: string) => {
    const { expr: next, caret: nextCaret } = applyFormulaAutocomplete(
      expr,
      caret,
      pick,
    );
    onExprChange(next);
    setSuggestOpen(false);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOpen || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyPick(suggestions[activeIdx]!);
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  };

  let status =
    "Columns, numbers, @variables, np.<f>(…), a if cond else b, and/or/not, comparisons.";
  let statusClass = "formula-status muted";
  if (previewError) {
    status = previewError;
    statusClass = "formula-status err";
  } else if (preview && nameSet) {
    status = "OK · expression accepted by the engine";
    statusClass = "formula-status ok";
  }

  return (
    <div className="ed-field" data-formula-editor="">
      <span className="ed-label">{label}</span>
      <div className="formula-input-wrap">
        <input
          ref={inputRef}
          aria-label="Expression"
          aria-autocomplete="list"
          aria-controls="formula-suggest"
          aria-expanded={suggestOpen}
          className={
            previewError ? "ed-input formula invalid" : "ed-input formula"
          }
          aria-invalid={previewError ? true : undefined}
          value={expr}
          placeholder={formulaPlaceholder(columns, variables)}
          onChange={(e) => {
            onExprChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Delay so suggestion click can fire.
            window.setTimeout(() => setSuggestOpen(false), 120);
          }}
          autoComplete="off"
          spellCheck={false}
        />
        {suggestOpen && suggestions.length > 0 ? (
          <ul
            id="formula-suggest"
            role="listbox"
            className="formula-suggest"
            aria-label="Formula suggestions"
          >
            {suggestions.map((s, i) => (
              <li key={s} role="option" aria-selected={i === activeIdx}>
                <button
                  type="button"
                  className={
                    i === activeIdx
                      ? "formula-suggest-item on"
                      : "formula-suggest-item"
                  }
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyPick(s);
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className={statusClass} data-formula-status="">
        {status}
      </div>

      <span className="ed-help">
        {selectedNums.length
          ? "Selected columns (click to insert)"
          : "Insert a column"}
      </span>
      <div className="chip-row" data-formula-col-chips="">
        {chipCols.map((name) => {
          const isSel = selectedNums.includes(name);
          return (
            <button
              key={name}
              type="button"
              className={isSel ? "tiny-chip on" : "tiny-chip"}
              title={isSel ? "From selection" : undefined}
              onClick={() => insertAtCaret(formulaColumnRef(name))}
            >
              {name}
            </button>
          );
        })}
        {!chipCols.length ? (
          <span className="ed-help">No numeric columns.</span>
        ) : null}
      </div>

      {variables.length ? (
        <>
          <span className="ed-help">Variables</span>
          <div className="chip-row" data-formula-var-chips="">
            {variables.map((v) => (
              <button
                key={v.name}
                type="button"
                className="tiny-chip var"
                onClick={() => insertAtCaret(`@${v.name}`)}
              >
                @{v.name}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <span className="ed-help">Functions</span>
      <Palette
        items={FORMULA_FUNCS}
        marker={{ "data-formula-func-palette": "" }}
        aria={(f) => f.help}
        onPick={(f) => insertAtCaret(f.insert, false)}
      />

      <span className="ed-help">Python</span>
      <Palette
        items={formulaPyExamples(chipCols)}
        marker={{ "data-formula-py-palette": "" }}
        aria={(f) => `Insert ${f.label}`}
        onPick={(f) => insertAtCaret(f.insert)}
      />

      <span className="ed-help">Operators</span>
      <Palette
        items={FORMULA_OPS}
        marker={{ "data-formula-op-palette": "" }}
        aria={(f) => f.help}
        onPick={(f) => insertAtCaret(f.insert)}
      />
    </div>
  );
}
