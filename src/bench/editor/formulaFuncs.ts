/**
 * Formula function / operator palette for the step editor (MAT-173).
 * One-line help mirrors the engine formula whitelist (where/clip/isnull/…).
 */

export interface FormulaPaletteItem {
  /** Text inserted into the expression (may include trailing "("). */
  insert: string;
  /** Short label shown on the chip. */
  label: string;
  /** One-line help for title / aria. */
  help: string;
  kind: "func" | "op" | "const";
}

export const FORMULA_FUNCS: FormulaPaletteItem[] = [
  {
    insert: "where(",
    label: "where",
    help: "where(cond, a, b) — a if cond else b",
    kind: "func",
  },
  {
    insert: "clip(",
    label: "clip",
    help: "clip(x, lo, hi) — clamp values to [lo, hi]",
    kind: "func",
  },
  {
    insert: "isnull(",
    label: "isnull",
    help: "isnull(x) — 1 where missing, else 0",
    kind: "func",
  },
  {
    insert: "log(",
    label: "log",
    help: "log(x) — natural logarithm",
    kind: "func",
  },
  {
    insert: "log1p(",
    label: "log1p",
    help: "log1p(x) — log(1 + x)",
    kind: "func",
  },
  {
    insert: "log2(",
    label: "log2",
    help: "log2(x) — base-2 logarithm",
    kind: "func",
  },
  {
    insert: "log10(",
    label: "log10",
    help: "log10(x) — base-10 logarithm",
    kind: "func",
  },
  {
    insert: "exp(",
    label: "exp",
    help: "exp(x) — e^x",
    kind: "func",
  },
  {
    insert: "sqrt(",
    label: "sqrt",
    help: "sqrt(x) — square root",
    kind: "func",
  },
  {
    insert: "abs(",
    label: "abs",
    help: "abs(x) — absolute value",
    kind: "func",
  },
  {
    insert: "square(",
    label: "square",
    help: "square(x) — x²",
    kind: "func",
  },
  {
    insert: "sign(",
    label: "sign",
    help: "sign(x) — −1, 0, or 1",
    kind: "func",
  },
  {
    insert: "floor(",
    label: "floor",
    help: "floor(x) — round down",
    kind: "func",
  },
  {
    insert: "ceil(",
    label: "ceil",
    help: "ceil(x) — round up",
    kind: "func",
  },
  {
    insert: "round(",
    label: "round",
    help: "round(x[, n]) — round to n decimals",
    kind: "func",
  },
  {
    insert: "min(",
    label: "min",
    help: "min(a, b, …) — element-wise minimum",
    kind: "func",
  },
  {
    insert: "max(",
    label: "max",
    help: "max(a, b, …) — element-wise maximum",
    kind: "func",
  },
  {
    insert: "sin(",
    label: "sin",
    help: "sin(x) — sine (radians)",
    kind: "func",
  },
  {
    insert: "cos(",
    label: "cos",
    help: "cos(x) — cosine (radians)",
    kind: "func",
  },
  {
    insert: "tanh(",
    label: "tanh",
    help: "tanh(x) — hyperbolic tangent",
    kind: "func",
  },
];

export const FORMULA_OPS: FormulaPaletteItem[] = [
  { insert: "+", label: "+", help: "Addition", kind: "op" },
  { insert: "-", label: "−", help: "Subtraction", kind: "op" },
  { insert: "*", label: "×", help: "Multiplication", kind: "op" },
  { insert: "/", label: "÷", help: "Division", kind: "op" },
  { insert: "**", label: "^", help: "Power (a ** b)", kind: "op" },
  { insert: "<", label: "<", help: "Less than (comparison → 0/1)", kind: "op" },
  { insert: "<=", label: "≤", help: "Less or equal", kind: "op" },
  { insert: ">", label: ">", help: "Greater than", kind: "op" },
  { insert: ">=", label: "≥", help: "Greater or equal", kind: "op" },
  { insert: "==", label: "==", help: "Equal", kind: "op" },
  { insert: "!=", label: "!=", help: "Not equal", kind: "op" },
  { insert: "(", label: "(", help: "Open parenthesis", kind: "op" },
  { insert: ")", label: ")", help: "Close parenthesis", kind: "op" },
  { insert: "pi", label: "pi", help: "Constant π", kind: "const" },
];

/** Token under caret for autocomplete (column name or @variable). */
export function formulaTokenAt(
  expr: string,
  caret: number,
): { start: number; end: number; token: string } | null {
  const left = expr.slice(0, Math.max(0, Math.min(caret, expr.length)));
  const m = left.match(/(@?[A-Za-z_][A-Za-z0-9_]*)$/);
  if (!m) return null;
  const token = m[1]!;
  const start = left.length - token.length;
  return { start, end: caret, token };
}

/** Ranked autocomplete candidates for the current token. */
export function formulaAutocomplete(
  token: string,
  columns: string[],
  variables: string[],
  limit = 8,
): string[] {
  if (!token) return [];
  const lower = token.toLowerCase();
  const wantAt = token.startsWith("@");
  const needle = wantAt ? lower.slice(1) : lower;
  const out: string[] = [];
  if (wantAt || token.startsWith("@")) {
    for (const v of variables) {
      if (v.toLowerCase().startsWith(needle) || v.toLowerCase().includes(needle)) {
        out.push(`@${v}`);
      }
      if (out.length >= limit) return out;
    }
    return out;
  }
  for (const c of columns) {
    if (c.toLowerCase().startsWith(needle)) out.push(c);
    if (out.length >= limit) return out;
  }
  for (const c of columns) {
    if (!c.toLowerCase().startsWith(needle) && c.toLowerCase().includes(needle)) {
      out.push(c);
    }
    if (out.length >= limit) return out;
  }
  for (const v of variables) {
    if (v.toLowerCase().startsWith(needle) || `@${v}`.toLowerCase().startsWith(lower)) {
      out.push(`@${v}`);
    }
    if (out.length >= limit) return out;
  }
  return out;
}

/** Replace the token at caret with `pick` and return new expr + caret. */
export function applyFormulaAutocomplete(
  expr: string,
  caret: number,
  pick: string,
): { expr: string; caret: number } {
  const tok = formulaTokenAt(expr, caret);
  if (!tok) {
    const next = `${expr.slice(0, caret)}${pick}${expr.slice(caret)}`;
    return { expr: next, caret: caret + pick.length };
  }
  const next = `${expr.slice(0, tok.start)}${pick}${expr.slice(tok.end)}`;
  return { expr: next, caret: tok.start + pick.length };
}
