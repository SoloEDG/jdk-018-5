import { computed, ref } from "vue";
import { useStudio } from "../../../shared/useStudio";
import type { RelaxCode, TracePoint } from "../../../shared/document";
import { nearestGuideEnd, distance } from "../lib/geometry";

/**
 * Editing state for the tracing layer: guides, junctions, selection and the
 * explicit relaxations the solver is allowed to use.
 */
export function useTraceEditor() {
  const { doc, invalidate, notice } = useStudio();
  const trace = doc.trace;
  const drawing = ref<TracePoint[] | null>(null);
  const hoverCell = ref<number | null>(null);
  const result = computed(() => doc.grid?.trace ?? null);
  function claimId(prefix: "G" | "J") {
    return `${prefix}${trace.nextId++}`;
  }
  /** Weld to a nearby endpoint/junction so guides form a real continuous path. */
  function weld(point: TracePoint): TracePoint {
    if (!trace.settings.weld || !doc.asset) return point;
    const radius = 1.6 / Math.max(30, doc.settings.columns);
    let best = point;
    let bestD = radius;
    for (const guide of trace.guides) {
      const end = nearestGuideEnd(point, [guide], null, radius);
      if (end) {
        const d = distance(end, point);
        if (d < bestD) {
          bestD = d;
          best = end;
        }
      }
    }
    for (const junction of trace.junctions) {
      const d = distance(junction.point, point);
      if (d < bestD) {
        bestD = d;
        best = junction.point;
      }
    }
    return { ...best };
  }
  function begin(point: TracePoint, snapped: TracePoint) {
    void point;
    if (trace.tool === "junction") {
      const id = claimId("J");
      trace.junctions.push({ id, label: id, point: snapped });
      trace.selectedGuide = null;
      invalidate();
      notice.value = `已放置交点 ${id}，需要至少两条引导线经过`;
      return;
    }
    drawing.value = [weld(snapped)];
    trace.selectedGuide = null;
  }
  function extend(point: TracePoint, snapped: TracePoint) {
    void point;
    if (!drawing.value) return;
    const last = drawing.value[drawing.value.length - 1]!;
    if (distance(last, snapped) < 1e-4) return;
    drawing.value.push(snapped);
  }
  function commit() {
    if (!drawing.value) return;
    const points = drawing.value;
    drawing.value = null;
    if (!points.length) return;
    const id = claimId("G");
    trace.guides.push({
      id,
      label: id,
      points: [weld(points[0]!), ...points.slice(1)],
      required: true,
    });
    invalidate();
    notice.value = `已添加引导线 ${id}（${points.length} 个节点）`;
  }
  function cancel() {
    drawing.value = null;
  }
  function removeGuide(id: string) {
    const i = trace.guides.findIndex((g) => g.id === id);
    if (i >= 0) trace.guides.splice(i, 1);
    if (trace.selectedGuide === id) trace.selectedGuide = null;
    invalidate();
  }
  function removeJunction(id: string) {
    const i = trace.junctions.findIndex((j) => j.id === id);
    if (i >= 0) trace.junctions.splice(i, 1);
    invalidate();
  }
  function clearGuides() {
    trace.guides.splice(0, trace.guides.length);
    trace.junctions.splice(0, trace.junctions.length);
    trace.rejected.splice(0, trace.rejected.length);
    trace.selectedCell = null;
    trace.selectedGuide = null;
    invalidate();
  }
  function toggleRequired(id: string) {
    const guide = trace.guides.find((g) => g.id === id);
    if (!guide) return;
    guide.required = !guide.required;
    invalidate();
  }
  function selectGuide(id: string | null) {
    trace.selectedGuide = id;
    trace.focusConstraint = id;
  }
  function selectCell(cell: number | null) {
    trace.selectedCell = cell;
    if (cell === null) return;
    const owner = result.value?.provenance[cell]?.source;
    if (owner && owner !== "TONE" && !/^A\d+$/.test(owner)) {
      trace.focusConstraint = owner;
      trace.selectedGuide = owner;
    }
  }
  /**
   * Reject the automatic contour segment that owns a cell. The segment is
   * stored as normalised centres, so the rejection survives density changes.
   */
  function rejectAutoAt(cell: number) {
    const res = result.value;
    if (!res) return;
    const seg = res.autoSegments.find((s) => s.cells.includes(cell));
    if (!seg) {
      notice.value = "该单元不属于自动轮廓";
      return;
    }
    trace.rejected.push(seg.signatures.map((p) => ({ ...p })));
    invalidate();
    notice.value = `已拒绝 ${seg.id} 的 ${seg.cells.length} 个单元，正在重新求解`;
  }
  function clearRejections() {
    trace.rejected.splice(0, trace.rejected.length);
    invalidate();
    notice.value = "已恢复被拒绝的自动边缘";
  }
  /** Apply a relaxation the user picked from a specific constraint. */
  function relax(code: RelaxCode) {
    const s = trace.settings;
    switch (code) {
      case "crossing":
        s.allowCross = true;
        break;
      case "diagonals":
        s.allowDiag = true;
        break;
      case "budget":
        s.budgetPercent = Math.min(90, s.budgetPercent + 8);
        break;
      case "density":
        doc.settings.columns = Math.min(220, doc.settings.columns + 12);
        break;
    }
    invalidate();
    notice.value = `已放宽约束：${labelOf(code)}，重新求解`;
  }
  return {
    doc,
    trace,
    result,
    drawing,
    hoverCell,
    begin,
    extend,
    commit,
    cancel,
    removeGuide,
    removeJunction,
    clearGuides,
    toggleRequired,
    selectGuide,
    selectCell,
    rejectAutoAt,
    clearRejections,
    relax,
  };
}
function labelOf(code: RelaxCode) {
  return (
    {
      crossing: "允许单元内交叉",
      diagonals: "允许对角线",
      budget: "提高字符预算",
      density: "提高字符密度",
    }[code] ?? code
  );
}
