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
    op === "impute_knn" ||
    op === "impute_iterative" ||
    op === "interactions" ||
    op === "align_to_train" ||
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

  if (op === "drop_missing_target") {
    if (!p.target && typeof p.column === "string") {
      return { ...p, target: p.column };
    }
  }

  if (op === "ffill") {
    if (!p.sort_by && typeof p.column === "string") {
      return { ...p, sort_by: p.column };
    }
  }

  if (op === "bin") {
    if (typeof p.edges === "string") {
      p.edges = p.edges
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n));
    }
    if (typeof p.labels === "string") {
      p.labels = p.labels.split(",").map((s) => s.trim()).filter(Boolean);
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

  if (op === "filter_rows") {
    const conds =
      (p.conditions as Array<Record<string, unknown>> | undefined) ?? [];
    const cleaned = conds.map((c) => {
      const col = String(c.column ?? "");
      const operator = String(c.op ?? "eq");
      let val = c.value;
      if (operator === "isna" || operator === "notna") {
        val = null;
      } else if (operator === "isin" || operator === "notin") {
        if (typeof val === "string") {
          val = val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => (Number.isNaN(Number(s)) ? s : Number(s)));
        } else if (!Array.isArray(val)) {
          val = val !== undefined && val !== null ? [val] : [];
        }
      } else if (typeof val === "string" && val.trim() !== "") {
        const num = Number(val);
        if (!Number.isNaN(num)) val = num;
      }
      return {
        column: col,
        op: operator,
        value: val,
      };
    });
    return {
      ...p,
      conditions: cleaned,
      combine: p.combine ?? "and",
    };
  }

  return p;
}

/** Resolve UI alias ops to real engine op names. */
export function resolveOp(op: string): string {
  if (op === "map_value") return "standardize_text";
  return op;
}
