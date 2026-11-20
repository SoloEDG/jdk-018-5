<script setup lang="ts">
import { computed, ref } from "vue";
import { Crosshair, GitBranch, MousePointer2 } from "lucide-vue-next";
import { useStudio } from "../../../shared/useStudio";
import { useTraceText } from "../model/useTraceText";
import { useTraceEditor } from "../model/useTraceEditor";
const { doc } = useStudio();
const text = useTraceText();
const editor = useTraceEditor();
const trace = computed(() => doc.grid?.trace ?? null);
const selected = computed(() => doc.trace.selectedCell);
const inspect = computed(() => {
  const t = trace.value;
  const cell = selected.value;
  if (!t || cell === null) return null;
  const x = cell % t.columns;
  const y = Math.floor(cell / t.columns);
  const guide =
    t.guideCells.find((g) => g.cells.includes(cell))?.guide ??
    t.junctionCells.find((j) => j.cell === cell)?.junction ??
    null;
  const issue = t.issues.find((i) => i.cell === cell) ?? null;
  return {
    cell,
    x,
    y,
    glyph: t.chars[cell] ?? " ",
    source: t.provenance[cell]?.source ?? "—",
    reason: t.provenance[cell]?.reason ?? "",
    guide,
    issue,
    density: t.densities[cell] ?? 0,
  };
});
const issueCells = computed(() => text.issueCells.value);
const guideCells = computed(() => {
  const set = new Set<number>();
  for (const g of trace.value?.guideCells ?? []) for (const c of g.cells) set.add(c);
  return set;
});
const showMarks = ref(true);
function cellClicked(cell: number) {
  editor.selectCell(cell);
}
/** Reject the automatic edge segment that owns the inspected cell. */
const autoSegment = computed(() => {
  const t = trace.value;
  const cell = selected.value;
  if (!t || cell === null) return null;
  return t.autoSegments.find((s) => s.cells.includes(cell)) ?? null;
});
function rejectAuto() {
  const cell = selected.value;
  if (cell === null) return;
  editor.rejectAutoAt(cell);
}
function classFor(cell: number) {
  return {
    selected: cell === selected.value,
    "in-guide": guideCells.value.has(cell),
    "in-issue": issueCells.value.has(cell),
  };
}
</script>
<template>
  <div class="trace-text" v-if="trace">
    <div class="trace-text-head">
      <span class="mono"
        >CHARACTER MAP · {{ trace.columns }} × {{ trace.rows }} ·
        hash {{ doc.grid?.trace?.hash }}</span
      >
      <label class="color-toggle"
        ><span class="color-dot" /> 标记约束<input
          aria-label="标记约束单元"
          type="checkbox"
          v-model="showMarks"
      /></label>
    </div>
    <div class="trace-text-body">
      <div class="text-rows" role="grid" aria-label="结构字符文本">
        <div class="text-row" v-for="row in text.rows.value" :key="row.y">
          <span class="row-no mono">{{ String(row.y).padStart(3, "0") }}</span>
          <span class="row-cells mono">
            <button
              v-for="cell in row.cells"
              :key="cell"
              :class="['text-cell', showMarks ? classFor(cell) : { selected: cell === selected }]"
              :aria-label="`第 ${Math.floor(cell / trace.columns)} 行第 ${cell % trace.columns} 列`"
              @click="cellClicked(cell)"
              >{{ trace.chars[cell] === " " ? "·" : trace.chars[cell] }}</button
            >
          </span>
        </div>
      </div>
      <aside class="text-inspector">
        <template v-if="inspect">
          <div class="inspector-title">
            <MousePointer2 :size="12" />
            <b>{{ inspect.source }}</b>
          </div>
          <dl class="inspector-grid">
            <dt>单元</dt>
            <dd class="mono">({{ inspect.x }}, {{ inspect.y }}) · #{{ inspect.cell }}</dd>
            <dt>字符</dt>
            <dd class="mono">「{{ inspect.glyph === " " ? "空" : inspect.glyph }}」</dd>
            <dt>密度</dt>
            <dd class="mono">{{ inspect.density.toFixed(2) }}</dd>
            <dt>决定来源</dt>
            <dd>{{ inspect.guide ?? inspect.source }}</dd>
            <dt>理由</dt>
            <dd>{{ inspect.reason }}</dd>
          </dl>
          <div v-if="inspect.issue" class="inspector-issue">
            <em class="chip" :class="inspect.issue.code">{{ inspect.issue.id }}</em>
            <p>{{ inspect.issue.label }}</p>
            <small>{{ inspect.issue.detail }}</small>
            <div class="issue-actions" v-if="inspect.issue.options.length">
              <button
                v-for="option in inspect.issue.options"
                :key="option.code"
                class="relax-button"
                @click="editor.relax(option.code)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <p v-else class="inspector-ok">该单元由 <b>{{ inspect.source }}</b> 决定，未违反约束。</p>
          <div v-if="autoSegment" class="inspector-auto">
            <div class="inspector-auto-head">
              自动边缘 <b>{{ autoSegment.id }}</b> · {{ autoSegment.cells.length }} 个单元
            </div>
            <button class="relax-button danger" @click="rejectAuto">
              拒绝此自动边缘
            </button>
            <small>拒绝后该段将不再绘制，并重新求解；未满足的约束会重新列出。</small>
          </div>
        </template>
        <p v-else class="trace-hint muted">
          <GitBranch :size="12" /> 点击任一字符，查看是哪段约束决定了它。
        </p>
        <div class="legend-mini">
          <span><i class="lg-guide" />引导线单元</span>
          <span><i class="lg-break" />诊断单元</span>
          <span><Crosshair :size="10" />交点单元</span>
        </div>
      </aside>
    </div>
  </div>
</template>
