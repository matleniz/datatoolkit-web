import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.0/2.1 level A and AA rules (datatoolkit-issues#241). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Violations that exist today, keyed by axe rule id. Each one is tracked by the
 * follow-up issue named in the PR; remove the entry when the rule is fixed.
 * Anything not listed here fails the spec.
 */
export const KNOWN_VIOLATIONS: Record<string, string> = {};

/**
 * Run axe (WCAG 2.1 A/AA) on the current page and assert there are no
 * violations beyond `KNOWN_VIOLATIONS`. Call it at the final state of a journey.
 * Prints one summary line per scan so a run reports rules checked / violations.
 */
export async function expectNoA11yViolations(
  page: Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const known = results.violations.filter((v) => v.id in KNOWN_VIOLATIONS);
  const unknown = results.violations.filter((v) => !(v.id in KNOWN_VIOLATIONS));
  console.log(
    `[axe] ${label}: ${results.passes.length + results.violations.length} rules checked, ` +
      `${results.violations.length} violations ` +
      `(allow-listed: ${known.map((v) => `${v.id}×${v.nodes.length}`).join(", ") || "none"}; ` +
      `new: ${unknown.map((v) => `${v.id}×${v.nodes.length}`).join(", ") || "none"})`,
  );
  expect(
    unknown.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    })),
    `axe violations on "${label}"`,
  ).toEqual([]);
}
