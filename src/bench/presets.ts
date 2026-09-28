/**
 * Convert prototype-style editor presets into engine param shapes.
 * UI may open with column/values; engine expects sentinels/columns/etc.
 */

export function toEngineParams(
  op: string,
  preset: Record<string, unknown>,
): Record<string, unknown> {
  const p = { ...preset };

  // Prototype aliases → engine ops handled by caller (map_value → standardize_text).
  if (op === "replace_sentinels") {
    const existing = p.sentinels;
    const hasSentinels =
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      Object.keys(existing as object).length > 0;
    if (hasSentinels) {
      return { sentinels: existing };
    }
    if (typeof p.column === "string" && p.values !== undefined) {
      return {
        sentinels: {
          [p.column]: Array.isArray(p.values) ? p.values : [p.values],
        },
      };
    }
    return { sentinels: existing && typeof existing === "object" ? existing : {} };
  }

  if (
    op === "impute" ||
    op === "onehot" ||
    op === "clip" ||
    op === "log1p" ||
    op === "parse_dates" ||
    op === "standardize_text"
  ) {
    if (p.columns) return p;
    if (typeof p.column === "string") {
      const { column, ...rest } = p;
      return { ...rest, columns: [column] };
    }
  }

  if (op === "scale") {
    if (p.columns) return p;
    if (typeof p.column === "string") {
      return { columns: [p.column], method: p.method ?? "standard" };
    }
  }

  if (op === "rename") {
    if (p.mapping) return p;
    if (typeof p.column === "string") {
      return { mapping: { [p.column]: String(p.to ?? "") } };
    }
  }

  if (op === "cast") {
    if (p.dtypes) return p;
    if (typeof p.column === "string") {
      return { dtypes: { [p.column]: String(p.dtype ?? "float") } };
    }
  }

  if (op === "ordinal") {
    if (p.categories) return p;
    if (typeof p.column === "string") {
      return {
        categories: {
          [p.column]: Array.isArray(p.order) ? p.order : [],
        },
      };
    }
  }

  if (op === "map_value" || (op === "standardize_text" && p.from !== undefined)) {
    const col = String(p.column ?? "");
    const from = String(p.from ?? "");
    const to = String(p.to ?? "");
    return {
      columns: col ? [col] : [],
      strip: false,
      lower: false,
      mapping: from ? { [from]: to } : {},
    };
  }

  if (op === "drop_duplicates") {
    return {
      subset: p.subset ?? null,
      keep: p.keep ?? "none",
      sort_by: p.sort_by ?? null,
    };
  }

  if (op === "formula") {
    return {
      name: p.name ?? "",
      expr: p.expr ?? "",
      variables: p.variables ?? p.vars ?? [],
    };
  }

  return p;
}

/** Resolve UI alias ops to real engine op names. */
export function resolveOp(op: string): string {
  if (op === "map_value") return "standardize_text";
  return op;
}
