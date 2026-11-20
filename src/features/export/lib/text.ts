import type { Grid } from "../../../shared/document";
export function textContent(grid: Grid): string {
  const rows = grid.trace
    ? grid.trace.chars
    : grid.cells.map((c) => c.glyph);
  return Array.from({ length: grid.rows }, (_, y) =>
    rows.slice(y * grid.columns, (y + 1) * grid.columns).join(""),
  ).join("\n");
}
