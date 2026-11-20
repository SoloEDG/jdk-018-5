<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle, Check, Info, Split, X } from "lucide-vue-next";
import { useStudio } from "../../../shared/useStudio";
import { useTraceEditor } from "../model/useTraceEditor";
import { usePolicyCompare } from "../model/usePolicyCompare";
import PolicyBoard from "./PolicyBoard.vue";
import type { IssueCode, RelaxCode } from "../../../shared/document";
const { doc } = useStudio();
const t = useTraceEditor();
const compare = usePolicyCompare();
const trace = computed(() => doc.grid?.trace ?? null);
const diag = computed(() => trace.value?.diagnostics ?? null);
const issues = computed(
  () => (trace.value?.issues ?? []).filter((i) => i.code !== "auto"),
);
const codeLabel: Record<IssueCode, string> = {
  corner: "角接触",
  crossing: "单元交叉",
  density: "密度不足",
  charset: "字符集",
  budget: "预算",
  break: "断开",
  orphan: "孤立交点",
  auto: "自动边缘",
};
const kindLabel = { guide: "引导线", junction: "交点", auto: "自动轮廓", policy: "策略" } as const;
const whoName = { structure: "结构优先", tonal: "灰阶优先", tie: "持平" } as const;
function focusIssue(cell: number | null, id: string) {
  t.trace.focusConstraint = id;
  t.trace.selectedGuide = id;
  if (cell !== null) t.trace.selectedCell = cell;
}
function apply(code: RelaxCode) {
  t.relax(code);
}
const selected = computed(() => {
  const cell = compare.hover.value;
  if (cell === null) return null;
  const arm = compare.board.value;
  return compare.cellReport(arm, cell);
});
</script>
<template>
  <section class="panel diag-panel" v-if="trace && diag">
    <div class="section-title">
      <span>06 / CONSTRAINTS</span><AlertTriangle :size="15" />
    </div>
    <div class="diag-metrics">
      <div>
        <b>{{ diag.glyphCount }}</b><small>/ {{ diag.budget }} 字符</small>
      </div>
      <div>
        <b>{{ diag.connectivity.toFixed(0) }}%</b><small>引导连通</small>
      </div>
      <div>
        <b>{{ diag.autoConnectivity.toFixed(0) }}%</b><small>轮廓连通</small>
      </div>
      <div>
        <b>{{ (diag.brightnessError * 100).toFixed(1) }}</b><small>平均亮度误差 %</small>
      </div>
    </div>
    <div class="diagnosis-head">
      <span>未满足的约束</span>
      <small v-if="issues.length" class="issue-count">{{ issues.length }} 项</small>
      <span v-else class="ok"><Check :size="12" /> 全部满足</span>
    </div>
    <ul class="issue-list" v-if="issues.length">
      <li
        v-for="issue in issues"
        :key="issue.key"
        :class="{ focused: doc.trace.focusConstraint === issue.id }"
        @click="focusIssue(issue.cell, issue.id)"
      >
        <div class="issue-top">
          <em :class="['chip', issue.code]">{{ codeLabel[issue.code] }}</em>
          <span class="issue-kind">{{ kindLabel[issue.kind] }}</span>
          <em v-if="issue.label.includes('必须连续')" class="chip must">硬约束</em>
          <b class="issue-id">{{ issue.id }}</b>
        </div>
        <p>{{ issue.label }}</p>
        <small>{{ issue.detail }}</small>
        <div class="issue-actions" v-if="issue.options.length">
          <button
            v-for="option in issue.options"
            :key="option.code"
            class="relax-button"
            :title="option.effect"
            @click.stop="apply(option.code)"
          >
            <Info :size="10" /> {{ option.label }}
          </button>
        </div>
      </li>
    </ul>
    <p v-else class="trace-hint muted">
      当前引导线与交点均可在现有字符集内连续表达。
    </p>
    <div class="list-head" v-if="t.trace.rejected.length">
      <span>已拒绝的自动边缘 {{ t.trace.rejected.length }}</span>
      <button class="text-button" @click="t.clearRejections">
        <X :size="11" /> 全部恢复
      </button>
    </div>

    <div class="compare-head">
      <span><Split :size="12" /> 相同预算下的两种优先级</span>
      <button class="text-button" @click="compare.toggle">
        {{ compare.enabled.value ? "收起" : "展开比较" }}
      </button>
    </div>
    <template v-if="compare.enabled.value && compare.stats.value">
      <div class="compare-grid">
        <button
          v-for="arm in (['structure', 'tonal'] as const)"
          :key="arm"
          class="compare-col"
          :class="{ active: compare.board.value === arm }"
          @click="compare.board.value = arm"
        >
          <h4>{{ whoName[arm] }}</h4>
          <dl>
            <dt>引导连通</dt>
            <dd>{{ compare.stats.value[arm].connectivity.toFixed(1) }}%</dd>
            <dt>轮廓连通</dt>
            <dd>{{ compare.stats.value[arm].autoConnectivity.toFixed(1) }}%</dd>
            <dt>引导断点</dt>
            <dd>{{ compare.stats.value[arm].breaks + compare.stats.value[arm].cornerBreaks }}</dd>
            <dt>轮廓断点</dt>
            <dd>{{ compare.stats.value[arm].autoBreaks }}</dd>
            <dt>亮度误差</dt>
            <dd>{{ (compare.stats.value[arm].brightnessError * 100).toFixed(2) }}%</dd>
          </dl>
        </button>
      </div>
      <p class="verdict" v-if="compare.verdict.value">
        连通性 <b>{{ whoName[compare.verdict.value.connectivity] }}</b> ·
        亮度 <b>{{ whoName[compare.verdict.value.brightness] }}</b> ·
        {{ compare.stats.value.differing.length }} 个单元不同（预算
        {{ compare.stats.value.budget }}）
      </p>
      <p class="trace-hint muted">
        同一字符预算、同一批约束，仅填充顺序不同。断点与亮度偏差并列显示，
        避免一种指标掩盖另一种；点选单元可核对它由哪段约束决定。
      </p>
      <div class="compare-board">
        <div class="board-label mono">
          对照画布 / {{ whoName[compare.board.value] }} /
          {{ compare.stats.value.columns }}×{{ compare.stats.value.rows }} ·
          预算 {{ compare.stats.value.budget }}
        </div>
        <PolicyBoard
          :arm="compare.active.value!"
          :columns="compare.stats.value.columns"
          :rows="compare.stats.value.rows"
          :background="doc.settings.background"
          :zoom="compare.zoom.value"
          @hover="compare.hover.value = $event"
        />
        <div class="board-controls">
          <label class="zoom-inline"
            >缩放
            <input
              type="range"
              min="0.6"
              max="3"
              step="0.1"
              v-model.number="compare.zoom.value"
              aria-label="对照画布缩放"
            />
          </label>
        </div>
        <p class="board-readout mono" v-if="selected">
          #{{ compare.hover.value }} · 本策略「{{ selected.glyph === " " ? "空" : selected.glyph }}」
          · 另一策略「{{ selected.other === " " ? "空" : selected.other }}」
          <span v-if="selected.differs" class="diff-flag">字符不同</span>
          <span v-if="selected.break" class="break-flag">断点</span>
          <span class="muted">亮度偏差 {{ (selected.toneError * 100).toFixed(1) }}%</span>
        </p>
        <p class="board-readout muted" v-else>
          移动指针可查看该单元在两套策略下的字符与亮度偏差；此画布仅绘制已导出的字符数组。
        </p>
      </div>
    </template>
  </section>
</template>
