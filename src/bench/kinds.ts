import type { ColumnKind } from "../api/types";

/** Prototype KIND_LABEL, keyed by engine kinds. */
export const KIND_LABEL: Record<ColumnKind, string> = {
  number: "number",
  binary: "0 / 1",
  bool: "bool",
  text: "text",
  date: "date",
  identifier: "identifier",
};

export const KIND_BAR: Record<ColumnKind, string> = {
  number: "#8fb0c9",
  binary: "#a9c3a0",
  bool: "#a9c3a0",
  text: "#cdb48a",
  date: "#b3a6d6",
  identifier: "#c9c5ba",
};

export function isNumericKind(kind: ColumnKind | string | null | undefined): boolean {
  return kind === "number" || kind === "binary" || kind === "bool";
}

export function isTextKind(kind: ColumnKind | string | null | undefined): boolean {
  return kind === "text";
}

export function colWidth(kind: ColumnKind | string): number {
  if (kind === "identifier") return 96;
  if (kind === "binary" || kind === "bool") return 112;
  if (kind === "date") return 118;
  return 130;
}
