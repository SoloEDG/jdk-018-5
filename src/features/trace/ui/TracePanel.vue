<script setup lang="ts">
import { computed } from "vue";
import {
  AlertTriangle,
  Crosshair,
  Eraser,
  GitBranch,
  Pencil,
  RotateCcw,
  ScanLine,
  Trash2,
} from "lucide-vue-next";
import { useStudio } from "../../../shared/useStudio";
import { useTraceEditor } from "../model/useTraceEditor";
const { doc, invalidate } = useStudio();
const t = useTraceEditor();
const trace = doc.trace;
const settings = computed(() => trace.settings);
const result = computed(() => doc.grid?.trace ?? null);
const issueCount = computed(
  () => result.value?.issues.filter((i) => i.code !== "auto").length ?? 0,
);
const guideId = computed(() => trace.selectedGuide);
function toggleEnabled() {
  settings.value.enabled = !settings.value.enabled;
  if (settings.value.enabled && trace.tool === "guide") trace.tool = "guide";
  invalidate();
}
function setTool(tool: "guide" | "junction") {
  trace.tool = tool;
  settings.value.enabled = true;
  invalidate();
}
function toggleSetting(key: "showAuto" | "showGuides" | "snap" | "weld" | "ink") {
  settings.value[key] = !settings.value[key];
  invalidate();
}
function toggleRelax(key: "allowCross" | "allowDiag") {
  settings.value[key] = !settings.value[key];
  invalidate();
}
</script>
<template>
  <section class="panel trace-panel">
    <div class="section-title">
      <span>04 / TRACE</span><ScanLine :size="15" />
    </div>
    <label class="toggle-row trace-enable"
      ><span
        >结构描摹
        <small class="muted">轮廓方向 → 引导线 → 字符</small></span
      ><input
        aria-label="启用结构描摹"
        type="checkbox"
        :checked="settings.enabled"
        @change="toggleEnabled"
    /></label>
    <template v-if="settings.enabled">
      <div class="tool-row" role="group" aria-label="描摹工具">
        <button
          :class="['tool', { active: trace.tool === 'guide' }]"
          @click="setTool('guide')"
        >
          <Pencil :size="13" /> 引导线
        </button>
        <button
          :class="['tool', { active: trace.tool === 'junction' }]"
          @click="setTool('junction')"
        >
          <Crosshair :size="13" /> 交点
        </button>
      </div>
      <p class="trace-hint">
        提示：在左侧「描摹」视图中按住拖画折线；交点必须被两条以上的线经过。
      </p>
      <div class="toggle-strip">
        <label
          ><input
            type="checkbox"
            :checked="settings.snap"
            @change="toggleSetting('snap')"
          />吸附网格</label
        ><label
          ><input
            type="checkbox"
            :checked="settings.weld"
            @change="toggleSetting('weld')"
          />端点焊接</label
        >
      </div>
      <label class="field"
        >字形族<select
          v-model="settings.glyphSet"
          aria-label="字形族"
          @change="invalidate"
        >
          <option value="box">方块线（─ │ ╭ ╮ ╱）</option>
          <option value="ascii">ASCII 线（- | + / \）</option>
        </select></label
      >
      <div class="segmented" role="group" aria-label="求解策略">
        <button
          :class="{ active: settings.policy === 'structure' }"
          @click="
            settings.policy = 'structure';
            invalidate();
          "
        >
          结构优先
        </button>
        <button
          :class="{ active: settings.policy === 'tonal' }"
          @click="
            settings.policy = 'tonal';
            invalidate();
          "
        >
          灰阶优先
        </button>
      </div>
      <label class="field"
        >字符预算 <b>{{ result?.diagnostics.glyphCount ?? 0 }} / {{ result?.diagnostics.budget ?? 0 }}</b
        ><input
          aria-label="字符预算"
          type="range"
          min="5"
          max="90"
          step="1"
          v-model.number="settings.budgetPercent"
          @input="invalidate"
      /></label>
      <label class="field"
        >自动轮廓阈值 <b>{{ settings.autoThreshold.toFixed(2) }}</b
        ><input
          aria-label="自动轮廓阈值"
          type="range"
          min="0.08"
          max="0.9"
          step="0.01"
          v-model.number="settings.autoThreshold"
          @input="invalidate"
      /></label>
      <div class="toggle-strip">
        <label
          ><input
            type="checkbox"
            :checked="settings.ink"
            @change="toggleSetting('ink')"
          />线稿反转</label
        ><label
          ><input
            type="checkbox"
            :checked="settings.showAuto"
            @change="toggleSetting('showAuto')"
          />绘制自动轮廓</label
        ><label
          ><input
            type="checkbox"
            :checked="settings.showGuides"
            @change="toggleSetting('showGuides')"
          />显示引导线</label
        >
      </div>
      <div class="relax-block">
        <div class="relax-title">
          <AlertTriangle :size="12" /> 判定放宽（改变连通标准）
        </div>
        <label class="relax-row"
          ><input
            type="checkbox"
            :checked="settings.allowDiag"
            @change="toggleRelax('allowDiag')"
          /><span
            >允许对角线<small
              >╱ ╲ 只在单元角相接时，默认不算连通。</small
            ></span
          ></label
        >
        <label class="relax-row"
          ><input
            type="checkbox"
            :checked="settings.allowCross"
            @change="toggleRelax('allowCross')"
          /><span
            >允许单元内交叉<small
              >两段线共用一个单元时，用交叉字符表达。</small
            ></span
          ></label
        >
      </div>
      <div class="list-head">
        <span><GitBranch :size="12" /> 引导线 {{ trace.guides.length }}</span
        ><button class="icon-button" @click="t.clearGuides">
          <Eraser :size="12" />
        </button>
      </div>
      <ul class="trace-list" v-if="trace.guides.length">
        <li
          v-for="guide in trace.guides"
          :key="guide.id"
          :class="{ active: guideId === guide.id }"
        >
          <button class="list-main" @click="t.selectGuide(guide.id)">
            <b>{{ guide.id }}</b>
            <small>{{ guide.points.length }} 节点</small>
            <em v-if="guide.required">必须</em>
          </button>
          <button
            class="icon-button"
            :aria-label="`切换 ${guide.id} 是否必须`"
            @click="t.toggleRequired(guide.id)"
          >
            <RotateCcw :size="11" />
          </button>
          <button
            class="icon-button"
            :aria-label="`删除 ${guide.id}`"
            @click="t.removeGuide(guide.id)"
          >
            <Trash2 :size="11" />
          </button>
        </li>
      </ul>
      <p v-else class="trace-hint muted">尚未补画引导线。</p>
      <div class="list-head" v-if="trace.junctions.length">
        <span><Crosshair :size="12" /> 交点 {{ trace.junctions.length }}</span>
      </div>
      <ul class="trace-list" v-if="trace.junctions.length">
        <li v-for="junction in trace.junctions" :key="junction.id">
          <button class="list-main" @click="t.selectGuide(junction.id)">
            <b>{{ junction.id }}</b>
            <small>必须连续</small>
          </button>
          <button
            class="icon-button"
            :aria-label="`删除 ${junction.id}`"
            @click="t.removeJunction(junction.id)"
          >
            <Trash2 :size="11" />
          </button>
        </li>
      </ul>
      <div class="list-head">
        <span
          >自动边缘拒绝 {{ trace.rejected.length }}<small
            v-if="issueCount"
            class="issue-pill"
            >{{ issueCount }} 项未满足</small
          ></span
        >
        <button
          v-if="trace.rejected.length"
          class="text-button"
          @click="t.clearRejections"
        >
          恢复
        </button>
      </div>
    </template>
  </section>
</template>
