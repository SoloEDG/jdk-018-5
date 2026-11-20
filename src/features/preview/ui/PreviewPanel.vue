<script setup lang="ts">
import { computed } from "vue";
import { Code2, Scan, Minus, Plus, Pencil, Grid3x3 } from "lucide-vue-next";
import { usePreview } from "../model/usePreview";
import { gridRows } from "../lib/rows";
import ArtCanvas from "./ArtCanvas.vue";
import TraceStage from "../../trace/ui/TraceStage.vue";
import TraceTextPanel from "../../trace/ui/TraceTextPanel.vue";
const p = usePreview();
const text = computed(() =>
  p.doc.grid ? gridRows(p.doc.grid).join("\n") : "",
);
function tab(mode: "art" | "text" | "trace") {
  p.mode.value = mode;
}
</script>
<template>
  <main class="workspace">
    <div class="preview-toolbar">
      <div class="tabs">
        <button :class="{ active: p.mode.value === 'art' }" @click="tab('art')">
          <Scan :size="14" /> 字符预览</button
        ><button :class="{ active: p.mode.value === 'text' }" @click="tab('text')">
          <Grid3x3 :size="14" /> 约束文本</button
        ><button
          v-if="p.doc.trace.settings.enabled"
          :class="{ active: p.mode.value === 'trace' }"
          @click="tab('trace')"
        >
          <Pencil :size="14" /> 原图描摹
        </button>
      </div>
      <label class="color-toggle"
        ><span class="color-dot" /> 彩色<input
          aria-label="彩色预览"
          type="checkbox"
          v-model="p.doc.settings.color"
      /></label>
    </div>
    <div class="art-stage" :class="{ 'trace-stage-wrap': p.mode.value === 'trace' }">
      <div class="stage-label">
        {{
          p.mode.value === "trace"
            ? "TRACE / ORIGINAL COORDINATES"
            : "OUTPUT / LIVE RENDER"
        }}
        <span>●</span>
      </div>
      <div v-if="p.mode.value === 'trace'" class="trace-scroll">
        <TraceStage v-if="p.doc.asset" :grid="p.doc.grid" />
      </div>
      <div v-else-if="p.mode.value === 'text'" class="trace-scroll">
        <TraceTextPanel v-if="p.doc.grid?.trace" />
        <span v-else class="trace-empty">开启结构描摹后，这里会显示可定位约束的字符面板。</span>
      </div>
      <div v-else class="art-scroll">
        <ArtCanvas
          v-if="p.doc.grid && p.mode.value === 'art'"
          :grid="p.doc.grid"
          :color="p.doc.settings.color"
          :background="p.doc.settings.background"
          :zoom="p.zoom.value"
        />
        <span v-else>正在准备字符画…</span>
      </div>
      <div class="stage-corner">
        {{ p.doc.grid?.columns }} COL × {{ p.doc.grid?.rows }} ROW
      </div>
    </div>
    <div class="preview-bottom">
      <span class="mono"
        ><i class="status-dot" />{{
          p.busy.value
            ? "生成中"
            : p.doc.grid?.revision === p.doc.revision
              ? "已同步"
              : "待重新生成"
        }}
        <span class="muted">/ {{ p.count.value }} 个字符</span></span
      >
      <span v-if="p.doc.grid?.trace" class="mono trace-hash"
        >hash {{ p.doc.grid.trace.hash }}</span
      >
      <div class="zoom">
        <button
          aria-label="缩小"
          @click="p.zoom.value = Math.max(25, p.zoom.value - 25)"
        >
          <Minus :size="14" /></button
        ><span>{{ p.zoom.value }}%</span
        ><button
          aria-label="放大"
          @click="p.zoom.value = Math.min(200, p.zoom.value + 25)"
        >
          <Plus :size="14" />
        </button>
      </div>
    </div>
    <div class="workspace-note">
      <span>从像素，到字符。</span
      ><small>每一个符号，都是光影的另一种表达。</small
      ><span class="note-symbol">{ Aa }</span>
    </div>
  </main>
</template>
