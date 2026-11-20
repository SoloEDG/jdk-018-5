import { useStudio } from "../../../shared/useStudio";
import { textContent } from "../lib/text";
import { download, exportName } from "../lib/download";
import { drawGrid } from "../../preview";
import { hashChars } from "../../trace/lib/hash";
import { breakCells } from "../../trace/lib/render";
import type { Grid } from "../../../shared/document";

/**
 * Export guard.
 *
 * The tracing layer produces characters AND diagnostics from a single solve.
 * Before a file leaves the browser we re-hash the exact array about to be
 * written and compare it with the hash stored next to the diagnostics. If they
 * differ, the export is refused rather than shipping characters that the
 * panel never validated.
 */
export function useExport() {
  const { doc, notice, busy } = useStudio();
  function fresh() {
    return !!(doc.grid && doc.grid.revision === doc.revision && !busy.value);
  }
  function state() {
    const grid = doc.grid;
    if (!grid?.trace)
      return { ready: fresh(), traced: false, mismatch: false, hash: "" };
    return {
      ready: fresh(),
      traced: true,
      mismatch:
        grid.trace.hash !== hashChars(grid.trace.chars, grid.columns, grid.rows),
      hash: grid.trace.hash,
    };
  }
  function guard(): Grid | null {
    const grid = doc.grid;
    if (!grid || !fresh()) {
      notice.value = "字符画尚未同步，请等待生成完成";
      return null;
    }
    if (!grid.trace) return grid;
    if (grid.trace.hash !== hashChars(grid.trace.chars, grid.columns, grid.rows)) {
      notice.value = "导出被拒绝：字符与诊断所指不是同一次求解";
      return null;
    }
    return grid;
  }
  function saveText() {
    const grid = guard();
    if (!grid) return;
    download(
      new Blob([textContent(grid)], { type: "text/plain;charset=utf-8" }),
      exportName(doc.asset?.name ?? "art", "txt"),
    );
    notice.value = grid.trace
      ? `文本已导出 · ${grid.trace.diagnostics.glyphCount} 字符 · hash ${grid.trace.hash}`
      : "文本已导出";
  }
  async function copy() {
    const grid = guard();
    if (!grid) return;
    try {
      await navigator.clipboard.writeText(textContent(grid));
      notice.value = "字符画已复制";
    } catch {
      notice.value = "无法访问剪贴板，请使用文本导出";
    }
  }
  function png() {
    const grid = guard();
    if (!grid) return;
    const c = document.createElement("canvas");
    drawGrid(c, grid, doc.settings.color, doc.settings.background);
    c.toBlob((b) => {
      if (b) download(b, exportName(doc.asset?.name ?? "art", "png"));
    }, "image/png");
  }
  /** Diagnostics snapshot exported alongside the characters, same hash. */
  function saveDiagnostics() {
    const grid = guard();
    if (!grid?.trace) return;
    const trace = grid.trace;
    const payload = {
      hash: trace.hash,
      columns: trace.columns,
      rows: trace.rows,
      budget: trace.diagnostics.budget,
      glyphCount: trace.diagnostics.glyphCount,
      connectivity: trace.diagnostics.connectivity,
      autoConnectivity: trace.diagnostics.autoConnectivity,
      brightnessError: trace.diagnostics.brightnessError,
      breaks: trace.diagnostics.breaks,
      cornerBreaks: trace.diagnostics.cornerBreaks,
      breakCells: breakCells(trace),
      issues: trace.issues.map((i) => ({
        code: i.code,
        id: i.id,
        label: i.label,
        detail: i.detail,
        cell: i.cell,
      })),
    };
    download(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      exportName(doc.asset?.name ?? "art", "trace.json"),
    );
    notice.value = `诊断已导出 · hash ${trace.hash} · 与字符同源`;
  }
  return { doc, busy, fresh, state, saveText, copy, png, saveDiagnostics };
}
