/** Gap between the view bar's flex children (matches `.result-viewbar` gap). */
const VIEWBAR_GAP = 6;

/**
 * Whether the view tabs must fold into the select: true when the tab row's
 * natural width plus the other visible bar items no longer fits the bar.
 * `others` are the widths of the visible non-tab, non-select children.
 */
export function shouldFoldTabs(
  barWidth: number,
  tabsWidth: number,
  others: readonly number[],
  gap: number = VIEWBAR_GAP,
): boolean {
  if (barWidth <= 0 || tabsWidth <= 0) return false;
  const used = others.filter((w) => w > 0);
  const total =
    tabsWidth + used.reduce((a, b) => a + b, 0) + gap * used.length;
  return total > barWidth;
}
