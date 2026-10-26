# Placeholders

How Studio shows data that is still on its way (datatoolkit-issues#328). Back
to the [README](../README.md) and [Development](development.md#styling).

One small system, `src/placeholder/`, no dependency:

| Piece | Use |
|---|---|
| `Skeleton` | One shimmering block; give it the size of the content it stands for |
| `SkeletonText`, `SkeletonRow` | A paragraph of bars; a row of fixed-width cells |
| `Spinner` | The indeterminate spinner (`BusyIndicator`, next to a label) |
| `PendingRegion` | Wraps skeletons with a visually hidden `role="status"` label, announced once |
| `skeletonWidths` | Deterministic bar widths (same seed, same widths: no flicker) |

Colours, radius and timing are tokens in `src/theme/tokens.css`
(`--dtk-skeleton-*`); the grid box is `--dtk-grid-row-h` / `--dtk-grid-header-h`.

## Where it is used

| Place | Placeholder | Replaced by |
|---|---|---|
| Workbench grid, rows not loaded | header band + 14 rows with the real column widths | the rows |
| Grid header, profiles not loaded | histogram and quality bar shimmer | the profile |
| Suggestions | 3 card-shaped placeholders (kept cards stay, "Re-checking…") | the cards |
| Analysis windows | title, 110px chart block, 3 lines (label stays `Loading…`) | the result |
| Compare matrix, full-frame stats | a bar in each value cell | the numbers |
| Sources: column line of each file, merge-key chips, Result shapes and chips | bars | the values |

## Rules

- **No layout shift.** A placeholder has the box of the thing it replaces: same
  row height (`--dtk-grid-row-h` + the 1px row border), same column widths, same
  header band, same matrix cell. `e2e/issue328-placeholders.spec.ts` holds each
  request at the network, then checks the loaded boxes against the placeholder
  ones. Not reserved: the wrapping of a file's "detected" line on Sources, which
  depends on the engine's text.
- **Accessible.** Skeletons are `aria-hidden`. A `PendingRegion` is a polite
  live region carrying the label ("Loading rows"); the grid keeps `aria-busy`.
  Classes of real rows (`.grid-row`, `.grid-td`) are never used by placeholders,
  so specs and tools count only data.
- **Reduced motion.** `prefers-reduced-motion: reduce` turns the shimmer off
  (flat bars). The spinner is the activity signal itself, so it slows down
  (2.4s a turn) instead of stopping. The shimmer only animates `transform`.
- **Errors win.** A failed load shows its error, not a placeholder; the Sources
  Result card hides errors computed from columns not read yet.

Out of scope until the engine publishes the contract: windowed reads,
virtualisation, approximate-value markers.
