import type { TraceResult } from "../../../shared/document";

const FONT_STACK =
  '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", ui-monospace, monospace';

export function breakCells(trace: TraceResult): number[] {
  const cells = new Set<number>();
  for (const issue of trace.issues)
    if (issue.code === "break" || issue.code === "corner" || issue.code === "crossing")
      if (issue.cell !== null) cells.add(issue.cell);
  return [...cells];
}
export interface ArmDrawOptions {
  columns: number;
  rows: number;
  chars: string[];
  background: string;
  /** cells whose glyph differs between the two policies */
  differing: number[];
  /** per-cell |density - target|, used to tint brightness deviation */
  toneError: Float32Array;
  /** cells on a break, marked in the margin */
  breakCells: number[];
  hover: number | null;
  zoom: number;
}
/**
 * Comparison board. It draws the arm's own character array, so the preview and
 * the numbers in the table always describe the same solve.
 */
export function drawArm(
  canvas: HTMLCanvasElement,
  options: ArmDrawOptions,
): { cellWidth: number; cellHeight: number } {
  const cellW = Math.max(3, Math.round(6 * options.zoom));
  const cellH = Math.round(cellW * 1.8);
  canvas.width = options.columns * cellW;
  canvas.height = options.rows * cellH;
  const g = canvas.getContext("2d")!;
  g.fillStyle = options.background;
  g.fillRect(0, 0, canvas.width, canvas.height);
  // brightness deviation underlay: amber where the glyph departs from the tone
  for (let i = 0; i < options.chars.length; i++) {
    const err = options.toneError[i] ?? 0;
    if (err < 0.18) continue;
    g.fillStyle = `rgba(217,170,90,${Math.min(0.55, (err - 0.18) * 1.6)})`;
    g.fillRect(
      (i % options.columns) * cellW,
      Math.floor(i / options.columns) * cellH,
      cellW,
      cellH,
    );
  }
  const diffSet = new Set(options.differing);
  for (const cell of diffSet) {
    g.fillStyle = "rgba(120,150,190,0.22)";
    g.fillRect(
      (cell % options.columns) * cellW,
      Math.floor(cell / options.columns) * cellH,
      cellW,
      cellH,
    );
  }
  g.font = `${Math.round(cellH * 0.8)}px ${FONT_STACK}`;
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillStyle = "#dfe6d4";
  for (let i = 0; i < options.chars.length; i++) {
    const glyph = options.chars[i]!;
    if (glyph === " ") continue;
    g.fillText(
      glyph,
      (i % options.columns) * cellW + cellW / 2,
      Math.floor(i / options.columns) * cellH + cellH / 2,
    );
  }
  g.fillStyle = "#d0684a";
  for (const cell of options.breakCells) {
    if (cell < 0) continue;
    g.fillRect(
      (cell % options.columns) * cellW,
      Math.floor(cell / options.columns) * cellH + cellH - 2,
      cellW,
      2,
    );
  }
  if (options.hover !== null && options.hover >= 0) {
    g.strokeStyle = "#f0ffbd";
    g.lineWidth = 1.5;
    g.strokeRect(
      (options.hover % options.columns) * cellW + 0.5,
      Math.floor(options.hover / options.columns) * cellH + 0.5,
      cellW - 1,
      cellH - 1,
    );
  }
  return { cellWidth: cellW, cellHeight: cellH };
}
export function boardCellAt(
  canvas: HTMLCanvasElement,
  e: MouseEvent | PointerEvent,
  columns: number,
  rows: number,
) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(
    ((e.clientX - rect.left) / rect.width) * columns,
  );
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * rows);
  if (x < 0 || y < 0 || x >= columns || y >= rows) return null;
  return y * columns + x;
}
