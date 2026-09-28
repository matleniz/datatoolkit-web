import { isNumericKind } from "../kinds";

/** Derive an Expr placeholder from current columns / variables (not churn demo). */
export function formulaPlaceholder(
  columns: { name: string; kind: string }[],
  variables: readonly { name: string }[],
): string {
  const num = columns.find((c) => isNumericKind(c.kind));
  const v = variables[0];
  if (num && v) return `${num.name} - @${v.name}`;
  if (num) return `${num.name} - @${num.name}_med`;
  if (v) return `@${v.name}`;
  return "col - @var";
}
