import { useEffect, useRef } from "react";

import { useAppDispatch, useAppState } from "../../state/AppStore";
import { chartPrefillFromSelection } from "../dock/chartPrefill";
import { isNumericKind, isTextKind, KIND_LABEL } from "../kinds";
import { toEngineParams } from "../presets";
import { useWorkbenchData } from "../WorkbenchData";

/** W2 — column context menu (prototype item order). */
export function ContextMenu() {
  const { ctx, selection, screen, targetColumn } = useAppState();
  const dispatch = useAppDispatch();
  const { columns, profiles, isLatest } = useWorkbenchData();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dispatch({ type: "CLOSE_CTX" });
      }
    };
    // Close on outside pointerdown without a blocking backdrop so the same
    // click can still reach a grid header underneath.
    const onPointerDown = (e: PointerEvent) => {
      const menu = menuRef.current;
      if (!menu) return;
      if (menu.contains(e.target as Node)) return;
      dispatch({ type: "CLOSE_CTX" });
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [ctx, dispatch]);

  if (!ctx || screen !== "bench") return null;

  const col = ctx.col;
  const meta = columns.find((c) => c.name === col);
  const kind = meta?.kind ?? profiles.get(col)?.kind ?? "text";
  const isT = col === targetColumn;
  const others = selection.columns.filter((x) => x !== col);
  const inMulti =
    selection.columns.includes(col) && selection.columns.length > 1;
  const pr = profiles.get(col);
  const multiNumeric = inMulti
    ? selection.columns.filter((name) => {
        const k =
          columns.find((c) => c.name === name)?.kind ??
          profiles.get(name)?.kind;
        return isNumericKind(k);
      })
    : [];

  const openEd = (
    op: string,
    params: Record<string, unknown> = {},
    target: "train" | "test" | "both" = "both",
  ) => {
    if (!isLatest) return;
    dispatch({
      type: "OPEN_EDITOR",
      op,
      params: toEngineParams(op, params),
      target,
    });
  };

  type Item =
    | { kind: "item"; text: string; hint?: string; run: () => void }
    | { kind: "sep" };

  const items: Item[] = [
    {
      kind: "item",
      text: "Inspect",
      run: () => {
        dispatch({ type: "CLEAR_SELECTION" });
        dispatch({ type: "PICK_COL", name: col });
      },
    },
    {
      kind: "item",
      text: inMulti ? "Remove from selection" : "Add to selection",
      hint: "shift-click",
      run: () => {
        const a = [...selection.columns];
        const i = a.indexOf(col);
        if (i >= 0 && a.length > 1) a.splice(i, 1);
        else if (i < 0) a.push(col);
        dispatch({ type: "CLEAR_SELECTION" });
        for (const name of a) {
          dispatch({ type: "PICK_COL", name, add: true });
        }
      },
    },
  ];

  if (others.length) {
    items.push({
      kind: "item",
      text: `Compare with ${others.length} selected`,
      run: () => {
        dispatch({ type: "CLEAR_SELECTION" });
        for (const name of [...others, col]) {
          dispatch({ type: "PICK_COL", name, add: true });
        }
        dispatch({ type: "OPEN_TOOL", id: "compare" });
      },
    });
  }

  items.push({
    kind: "item",
    text: "Distribution",
    run: () => {
      dispatch({ type: "PICK_COL", name: col });
      dispatch({ type: "SET_DIST_BY", by: null });
      dispatch({ type: "OPEN_TOOL", id: "dist" });
    },
  });
  items.push({
    kind: "item",
    text: "Chart…",
    run: () => {
      const names = inMulti
        ? [...selection.columns.filter((c) => c !== col), col]
        : [col];
      dispatch({ type: "CLEAR_SELECTION" });
      for (const name of names) {
        dispatch({ type: "PICK_COL", name, add: true });
      }
      const draftCols = names.map((name) => {
        const m = columns.find((c) => c.name === name);
        const k = m?.kind ?? profiles.get(name)?.kind ?? "text";
        return { name, kind: k };
      });
      dispatch({
        type: "SET_CHART_DRAFT",
        draft: chartPrefillFromSelection(draftCols),
      });
      dispatch({ type: "OPEN_TOOL", id: "chart" });
    },
  });
  items.push({
    kind: "item",
    text: "Distribution by…",
    run: () => {
      const names = columns.map((c) => c.name);
      const by =
        targetColumn && targetColumn !== col && names.includes(targetColumn)
          ? targetColumn
          : names.find((n) => n !== col) ?? null;
      dispatch({ type: "PICK_COL", name: col });
      dispatch({ type: "SET_DIST_BY", by });
      dispatch({ type: "OPEN_TOOL", id: "dist" });
    },
  });
  if (kind === "number") {
    items.push({
      kind: "item",
      text: "Outliers",
      run: () => {
        dispatch({ type: "PICK_COL", name: col });
        dispatch({ type: "OPEN_TOOL", id: "outliers" });
      },
    });
  }
  items.push({ kind: "sep" });

  if (isNumericKind(kind) && kind === "number") {
    items.push({
      kind: "item",
      text: "Replace sentinels…",
      run: () => openEd("replace_sentinels", { column: col, values: [-999] }),
    });
    items.push({
      kind: "item",
      text: "Impute…",
      run: () => openEd("impute", { column: col }),
    });
    items.push({
      kind: "item",
      text: "Clip…",
      run: () => openEd("clip", { column: col, lower: 5, upper: 95 }),
    });
    items.push({
      kind: "item",
      text: "Scale…",
      run: () => openEd("scale", { columns: [col] }),
    });
  }

  if (isTextKind(kind) && pr?.looks_like_dates) {
    items.push({
      kind: "item",
      text: "Parse dates…",
      run: () => openEd("parse_dates", { column: col }),
    });
  } else if (isTextKind(kind)) {
    if (pr?.currency_as_text) {
      const fmt = pr.currency_as_text;
      items.push({
        kind: "item",
        text: "Parse as number…",
        run: () =>
          openEd("to_numeric", {
            column: col,
            decimal: fmt.decimal,
            thousands: fmt.thousands,
            percent: fmt.percent,
          }),
      });
    }
    items.push({
      kind: "item",
      text: "Standardize text…",
      run: () => openEd("standardize_text", { column: col }),
    });
    if (!isT) {
      items.push({
        kind: "item",
        text: "One-hot…",
        run: () => openEd("onehot", { column: col }),
      });
      items.push({
        kind: "item",
        text: "Ordinal…",
        run: () => openEd("ordinal", { column: col }),
      });
    }
  }

  // Text / bool / binary with missing → Impute (most_frequent), like inspector.
  if (
    (isTextKind(kind) || kind === "binary" || kind === "bool") &&
    pr &&
    pr.missing > 0
  ) {
    items.push({
      kind: "item",
      text: "Impute…",
      run: () =>
        openEd("impute", { column: col, strategy: "most_frequent" }),
    });
  }

  items.push({
    kind: "item",
    text: "Rename…",
    run: () => openEd("rename", { column: col, to: "" }, "both"),
  });
  items.push({
    kind: "item",
    text: "Cast type…",
    run: () => openEd("cast", { column: col }),
  });
  items.push({ kind: "sep" });

  // Multi-selection feature ops (MAT-173): prefill from the numeric selection.
  if (multiNumeric.length >= 1) {
    items.push({
      kind: "item",
      text: "New feature…",
      hint: "ƒ",
      run: () => openEd("formula", { expr: "", name: "" }),
    });
    items.push({
      kind: "item",
      text: "Polynomial features…",
      run: () =>
        openEd("polynomial", {
          columns: multiNumeric.slice(),
          degree: 2,
        }),
    });
    items.push({
      kind: "item",
      text: "Power transform…",
      run: () =>
        openEd("power_transform", { columns: multiNumeric.slice() }),
    });
    items.push({
      kind: "item",
      text: "Quantile transform…",
      run: () =>
        openEd("quantile_transform", { columns: multiNumeric.slice() }),
    });
    items.push({ kind: "sep" });
  }

  if (kind === "number") {
    items.push({
      kind: "item",
      text: `New variable: mean(${col})`,
      hint: "@var",
      run: () => dispatch({ type: "SET_LEFT_TAB", tab: "vars" }),
    });
  }
  if (isNumericKind(kind) && !multiNumeric.length) {
    items.push({
      kind: "item",
      text: "Use in formula",
      hint: "ƒ",
      run: () => openEd("formula", { expr: col }),
    });
  }
  items.push({
    kind: "item",
    text: isT ? "Unset target" : "Set as target",
    hint: "label",
    run: () =>
      dispatch({
        type: "SET_TARGET_COLUMN",
        name: isT ? null : col,
      }),
  });
  if (!isT) {
    items.push({
      kind: "item",
      text: "Drop column…",
      run: () => openEd("drop_columns", { columns: [col] }),
    });
  }

  const hh = items.reduce((a, x) => a + (x.kind === "sep" ? 9 : 28), 30);
  const x0 = Math.min(ctx.x, 1440 - 250);
  const y0 = Math.max(8, Math.min(ctx.y, 900 - hh - 8));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Column menu"
      className="ctx-menu"
      style={{ left: Math.round(x0), top: Math.round(y0) }}
    >
      <div className="ctx-title">
        {col} · {KIND_LABEL[kind] ?? kind}
      </div>
      {items.map((it, i) =>
        it.kind === "sep" ? (
          <div key={`sep-${i}`} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={it.text}
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => {
              dispatch({ type: "CLOSE_CTX" });
              it.run();
            }}
          >
            <span>{it.text}</span>
            {it.hint ? <span className="ctx-hint">{it.hint}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}
