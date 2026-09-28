/**
 * Prefer viewport column names that still exist on the current rows page.
 * Keeps preferred order; drops stale names (dropped / renamed / other role).
 */
export function preferKnownColumns(
  preferred: string[],
  knownNames: Iterable<string>,
): string[] {
  const known = new Set(knownNames);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of preferred) {
    if (!known.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
