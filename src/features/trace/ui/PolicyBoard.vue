<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { PolicyArm } from "../../../shared/document";
import { boardCellAt, drawArm } from "../lib/render";
const props = defineProps<{
  arm: PolicyArm;
  columns: number;
  rows: number;
  background: string;
  zoom: number;
}>();
const emit = defineEmits<{ hover: [cell: number | null] }>();
const canvas = ref<HTMLCanvasElement>();
function draw() {
  const c = canvas.value;
  if (!c) return;
  drawArm(c, {
    columns: props.columns,
    rows: props.rows,
    chars: props.arm.chars,
    background: props.background,
    differing: props.arm.differing,
    toneError: props.arm.toneError,
    breakCells: props.arm.breakCells,
    hover: hover.value,
    zoom: props.zoom,
  });
}
const hover = ref<number | null>(null);
function move(e: PointerEvent) {
  const cell = boardCellAt(canvas.value!, e, props.columns, props.rows);
  if (cell !== hover.value) {
    hover.value = cell;
    emit("hover", cell);
    draw();
  }
}
onMounted(draw);
watch(
  () => [props.arm, props.columns, props.rows, props.zoom, props.background],
  draw,
);
</script>
<template>
  <div class="arm-board">
    <canvas
      ref="canvas"
      :style="{
        width: '100%',
        imageRendering: props.zoom > 1 ? 'auto' : 'pixelated',
      }"
      @pointermove="move"
      @pointerleave="
        hover = null;
        emit('hover', null);
        draw();
      "
    />
    <div class="arm-legend mono">
      <span><i class="lg-diff" />两策略字符不同</span>
      <span><i class="lg-tone" />亮度偏差大</span>
      <span><i class="lg-break" />断点</span>
    </div>
  </div>
</template>
