import type { Grid } from "../../../shared/document";
export function gridRows(grid: Grid): string[] {
  const glyphs = grid.trace ? grid.trace.chars : grid.cells.map((c) => c.glyph);
  return Array.from({ length: grid.rows }, (_, y) =>
    glyphs.slice(y * grid.columns, (y + 1) * grid.columns).join(""),
  );
}
