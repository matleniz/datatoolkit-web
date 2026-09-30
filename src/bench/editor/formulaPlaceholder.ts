import { formulaColumnRef as ref } from "./formulaFuncs";
import { isNumericKind } from "../kinds";

/** Derive an Expr placeholder from current columns / variables (not churn demo). */
export function formulaPlaceholder(
  columns: { name: string; kind: string }[],
  variables: readonly { name: string }[],
): string {
  const num = columns.find((c) => isNumericKind(c.kind));
  const v = variables[0];
  if (num && v) return `1 if ${ref(num.name)} > @${v.name} else 0`;
  if (num) return `np.log1p(${ref(num.name)})`;
  if (v) return `@${v.name}`;
  return "np.log1p(col)";
}
