import type { PreviewCheck } from "../../api/types";

const EXAMPLES_SHOWN = 3;

/** Findings of a contract step (`expected_schema`) as returned in a preview's `checks`. */
export function ViolationsTable({ checks }: { checks?: PreviewCheck[] }) {
  // Only contract steps return findings; every other op renders nothing.
  if (!checks) return null;
  const count = (sev: string) =>
    checks.filter((c) => c.severity === sev && c.check !== "truncated").length;
  if (!checks.length) {
    return (
      <div className="violations" data-violations="0">
        <div className="ed-label-caps">Violations</div>
        <div className="ed-help">No violation: the data satisfies this schema.</div>
      </div>
    );
  }
  return (
    <div className="violations" data-violations={checks.length}>
      <div className="ed-label-caps">
        Violations · {count("error")} error · {count("warning")} warning · {count("info")} info
      </div>
      <table aria-label="Schema violations">
        <thead>
          <tr>
            <th>Split</th>
            <th>Severity</th>
            <th>Column</th>
            <th>Finding</th>
            <th>Rows</th>
            <th>Examples</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c, i) => (
            <tr key={i} data-violation-check={c.check}>
              <td>{c.split ?? "—"}</td>
              <td className={`sev-${c.severity}`}>{c.severity}</td>
              <td>{c.column ?? "—"}</td>
              <td>{c.message}</td>
              <td>{c.count}</td>
              <td>
                {(c.examples ?? [])
                  .slice(0, EXAMPLES_SHOWN)
                  .map((e) => `row ${e.row}: ${String(e.value)}`)
                  .join("; ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
