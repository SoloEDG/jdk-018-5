import { computed } from "vue";
import { useStudio } from "../../../shared/useStudio";

/**
 * Text-panel model. Rows are rendered directly from `grid.trace.chars`, the
 * same array the solver diagnosed and the exporter will serialise.
 */
export function useTraceText() {
  const { doc } = useStudio();
  const trace = computed(() => doc.grid?.trace ?? null);
  const rows = computed(() => {
    const t = trace.value;
    if (!t) return [] as { y: number; text: string; cells: number[] }[];
    return Array.from({ length: t.rows }, (_, y) => {
      const cells = t.chars.slice(y * t.columns, (y + 1) * t.columns);
      return {
        y,
        text: cells.join(""),
        cells: cells.map((_, x) => y * t.columns + x),
      };
    });
  });
  const guideRanges = computed(() => {
    const t = trace.value;
    if (!t) return [] as { guide: string; cells: number[] }[];
    return t.guideCells;
  });
  const issueCells = computed(() => {
    const set = new Set<number>();
    for (const issue of trace.value?.issues ?? [])
      if (issue.cell !== null) set.add(issue.cell);
    return set;
  });
  return { doc, trace, rows, guideRanges, issueCells };
}
