import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listSuggestions,
  suggestionDismissId,
  type SuggestionCard,
} from "../src/bench/left/suggestions";
import {
  loadDismissedSuggestions,
  saveDismissedSuggestions,
} from "../src/state/suggestionDismissStorage";

function card(patch: Partial<SuggestionCard> = {}): SuggestionCard {
  return {
    id: "some_key:recommendations:0",
    title: "age: impute",
    detail: "impute with median",
    stage: "clean",
    step: {
      op: "impute",
      target: "both",
      params: { columns: ["age"], strategy: "median" },
    },
    column: "age",
    sourceKey: "some_key",
    ...patch,
  };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe("suggestionDismissId (datatoolkit-issues#15)", () => {
  it("ignores the card's position and the params' key order", () => {
    const a = card();
    const b = card({
      id: "some_key:recommendations:3",
      step: {
        op: "impute",
        target: "both",
        params: { strategy: "median", columns: ["age"] },
      },
    });
    expect(suggestionDismissId(a)).toBe(suggestionDismissId(b));
  });

  it("changes with the key, the suggested params or the finding", () => {
    const base = suggestionDismissId(card());
    expect(suggestionDismissId(card({ sourceKey: "other_key" }))).not.toBe(base);
    expect(
      suggestionDismissId(
        card({
          step: {
            op: "impute",
            target: "both",
            params: { columns: ["age"], strategy: "mean" },
          },
        }),
      ),
    ).not.toBe(base);
    expect(suggestionDismissId(card({ detail: "12 missing" }))).not.toBe(base);
    expect(suggestionDismissId(card({ column: "income" }))).not.toBe(base);
  });

  it("works for findings without a step", () => {
    const a = suggestionDismissId(card({ step: null, detail: "3" }));
    const b = suggestionDismissId(card({ step: null, detail: "4" }));
    expect(a).toMatch(/^[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });
});

describe("listSuggestions", () => {
  const cards = [
    card(),
    card({ id: "k:1", column: "city", title: "city: onehot", stage: "transform" }),
    card({ id: "k:2", column: "zip", title: "zip: drop", stage: "select" }),
  ];
  const dismissed = new Set([suggestionDismissId(cards[1]!)]);

  it("hides dismissed cards and counts them", () => {
    const r = listSuggestions(cards, "all", dismissed, false);
    expect(r.shown.map((s) => s.card.id)).toEqual([cards[0]!.id, "k:2"]);
    expect(r.active).toBe(2);
    expect(r.dismissed).toBe(1);
  });

  it("lists them, flagged, when show dismissed is on", () => {
    const r = listSuggestions(cards, "all", dismissed, true);
    expect(r.shown).toHaveLength(3);
    expect(r.shown.find((s) => s.card.id === "k:1")?.dismissed).toBe(true);
    expect(r.active).toBe(2);
  });

  it("applies the stage filter first", () => {
    const r = listSuggestions(cards, "transform", dismissed, false);
    expect(r.shown).toEqual([]);
    expect(r.active).toBe(0);
    expect(r.dismissed).toBe(1);
  });
});

describe("dismissed suggestions storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips per workspace", () => {
    saveDismissedSuggestions("a", ["x", "y"]);
    expect(loadDismissedSuggestions("a")).toEqual(["x", "y"]);
    expect(loadDismissedSuggestions("b")).toEqual([]);
  });

  it("drops garbage and keeps the newest 500", () => {
    localStorage.setItem("dtk.dismissedSuggestions.a", "{not json");
    expect(loadDismissedSuggestions("a")).toEqual([]);
    localStorage.setItem("dtk.dismissedSuggestions.a", '["x", 3, null]');
    expect(loadDismissedSuggestions("a")).toEqual(["x"]);
    const ids = Array.from({ length: 510 }, (_, i) => `id${i}`);
    saveDismissedSuggestions("a", ids);
    const kept = loadDismissedSuggestions("a");
    expect(kept).toHaveLength(500);
    expect(kept[0]).toBe("id10");
  });
});
