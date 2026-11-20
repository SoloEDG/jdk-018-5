import { computed, ref } from "vue";
import { useStudio } from "../../../shared/useStudio";
import { comparePolicies } from "../lib/solve";

/**
 * Two policies, one budget.
 *
 * Both arms are solved with identical grids, tone curve and accepted
 * relaxations; only the fill priority differs. The comparison is therefore
 * like-for-like: same character budget, same constraints, different choices.
 * It is a pure computed value, so it can never disagree with the current
 * document state.
 */
export function usePolicyCompare() {
  const { doc } = useStudio();
  const enabled = ref(false);
  const board = ref<"structure" | "tonal">("structure");
  const hover = ref<number | null>(null);
  const zoom = ref(1.6);
  const comparison = computed(() => {
    if (!enabled.value || !doc.asset || !doc.grid) return null;
    const s = doc.settings;
    return comparePolicies({
      asset: doc.asset,
      crop: doc.crop,
      columns: doc.grid.columns,
      rows: doc.grid.rows,
      trace: doc.trace,
      background: s.background,
      toned: (luma) => {
        let v = Math.max(0, Math.min(1, (luma - 0.5) * s.contrast + 0.5));
        v = Math.pow(v, 1 / s.gamma);
        return s.invert ? 1 - v : v;
      },
    });
  });
  const active = computed(() =>
    board.value === "structure" ? comparison.value?.structure ?? null : comparison.value?.tonal ?? null,
  );
  const stats = computed(() => {
    const c = comparison.value;
    if (!c) return null;
    return {
      budget: c.budget,
      columns: c.columns,
      rows: c.rows,
      structure: c.structure,
      tonal: c.tonal,
      differing: c.structure.differing,
    };
  });
  /** Which arm wins each metric – never assumed, always measured. */
  const verdict = computed(() => {
    const s = stats.value;
    if (!s) return null;
    return {
      connectivity:
        s.structure.connectivity > s.tonal.connectivity + 0.01
          ? ("structure" as const)
          : s.tonal.connectivity > s.structure.connectivity + 0.01
            ? ("tonal" as const)
            : ("tie" as const),
      brightness:
        s.structure.brightnessError < s.tonal.brightnessError - 0.002
          ? ("structure" as const)
          : s.tonal.brightnessError < s.structure.brightnessError - 0.002
            ? ("tonal" as const)
            : ("tie" as const),
    };
  });
  /** Per-cell breakdown of a single arm, used by the comparison board. */
  function cellReport(arm: "structure" | "tonal", cell: number) {
    const c = comparison.value;
    if (!c) return null;
    const a = c[arm];
    const glyph = a.chars[cell] ?? " ";
    const other = c[arm === "structure" ? "tonal" : "structure"].chars[cell] ?? " ";
    return {
      glyph,
      other,
      differs: glyph !== other,
      toneError: a.toneError[cell] ?? 0,
      break: a.breakCells.includes(cell),
    };
  }
  function toggle() {
    enabled.value = !enabled.value;
  }
  return {
    doc,
    enabled,
    board,
    hover,
    zoom,
    comparison,
    active,
    stats,
    verdict,
    toggle,
    cellReport,
  };
}
