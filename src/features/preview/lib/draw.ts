import type { Grid } from "../../../shared/document";
const CELL_W = 12,
  CELL_H = 20;
export function drawGrid(
  canvas: HTMLCanvasElement,
  grid: Grid,
  color: boolean,
  background: string,
) {
  canvas.width = grid.columns * CELL_W;
  canvas.height = grid.rows * CELL_H;
  const g = canvas.getContext("2d")!;
  g.fillStyle = background;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = `16px "DejaVu Sans Mono", "Noto Sans Mono", ui-monospace, monospace`;
  g.textBaseline = "middle";
  g.textAlign = "center";
  // Traced grids expose their single source-of-truth character array; tone
  // grids fall back to the per-cell glyph. The exporter and the canvas read
  // the same array either way.
  const glyphs = grid.trace ? grid.trace.chars : grid.cells.map((c) => c.glyph);
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i]!;
    if (glyph === " ") continue;
    const c = grid.cells[i];
    g.fillStyle = color ? (c?.color ?? "#e9eceb") : "#e9eceb";
    g.fillText(
      glyph,
      (i % grid.columns) * CELL_W + CELL_W / 2,
      Math.floor(i / grid.columns) * CELL_H + CELL_H / 2 + 0.5,
    );
  }
}
export const PREVIEW_CELL = { width: CELL_W, height: CELL_H };
