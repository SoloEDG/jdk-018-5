export interface GridDims {
  columns: number;
  rows: number;
  /** true when the requested shape exceeded a hard limit and was clamped */
  clamped: boolean;
  /** human readable explanation of the clamp, for the constraint report */
  detail: string;
}
export function gridSize(width: number, height: number, columns: number): GridDims {
  const requestedColumns = Math.round(columns);
  const n = Math.round(Math.max(30, Math.min(220, columns)));
  const rawRows = (height / width) * n * 0.5;
  const rows = Math.max(1, Math.round(rawRows));
  if (!Number.isFinite(rows)) {
    return {
      columns: n,
      rows: 1,
      clamped: true,
      detail: "裁剪区域尺寸无法换算成网格，已退回单行；请恢复裁剪。",
    };
  }
  if (rows > 1200) {
    // Clamping keeps the app usable, but the clamp is a real constraint loss:
    // a very tall crop cannot be expressed at the requested density, and the
    // solver must say so instead of silently drawing a coarser picture.
    return {
      columns: n,
      rows: 1200,
      clamped: true,
      detail: `裁剪区域过于狭长：按 ${n} 列计算需要 ${rows} 行，已钳制到 1200 行。竖线会被压缩，请缩小裁剪范围或降低字符密度。`,
    };
  }
  if (requestedColumns !== n) {
    return {
      columns: n,
      rows,
      clamped: true,
      detail: `字符密度被钳制到 ${n} 列（请求 ${requestedColumns} 列）。`,
    };
  }
  return { columns: n, rows, clamped: false, detail: "" };
}
