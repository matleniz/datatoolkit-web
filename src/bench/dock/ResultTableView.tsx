import { useMemo, useState } from "react";

import type { ResultTable } from "../../api/types";
import { sortRecords, TABLE_PAGE_SIZE, type SortState } from "./resultTable";

/** One engine table: click a header to sort, pages instead of truncation. */
export function ResultTableView({ table }: { table: ResultTable }) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const heads = useMemo(() => Object.keys(table.records[0] ?? {}), [table]);
  const sorted = useMemo(() => sortRecords(table.records, sort), [table, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * TABLE_PAGE_SIZE;
  const shown = sorted.slice(start, start + TABLE_PAGE_SIZE);

  const toggle = (col: string) => {
    setPage(0);
    setSort((s) =>
      s?.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null,
    );
  };

  return (
    <div className="result-table-block" data-table-title={table.title}>
      <div className="result-table-title">{table.title}</div>
      <div className="result-table-scroll">
        <table>
          <thead>
            <tr>
              {heads.map((h) => (
                <th
                  key={h}
                  aria-sort={
                    sort?.col === h
                      ? sort.dir === 1
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="result-th-btn"
                    title={`Sort by ${h}`}
                    onClick={() => toggle(h)}
                  >
                    {h}
                    {sort?.col === h ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={start + i}>
                {heads.map((h) => (
                  <td key={h} className="mono">
                    {String(row[h] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="result-pager muted" data-table-pager="">
          <button
            type="button"
            className="link-btn"
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ‹
          </button>
          <span>
            {start + 1}–{start + shown.length} of {sorted.length}
          </span>
          <button
            type="button"
            className="link-btn"
            aria-label="Next page"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
