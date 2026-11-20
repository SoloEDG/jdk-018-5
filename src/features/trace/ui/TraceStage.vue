<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Grid, TracePoint } from "../../../shared/document";
import { useStudio } from "../../../shared/useStudio";
import { useTraceEditor } from "../model/useTraceEditor";
import { simplify } from "../lib/simplify";

/**
 * The tracing stage: the ORIGINAL image, dimmed outside the crop, with guides
 * stored in original-image coordinates. Because guides are not re-based on
 * crop, moving the crop slides the picture underneath them instead of moving
 * the lines – that is exactly the behaviour the crop panel exposes.
 */
const props = defineProps<{ grid: Grid | null }>();
const { doc, invalidate } = useStudio();
const t = useTraceEditor();
const host = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
const size = ref({ w: 900, h: 620 });
const drawing = ref<TracePoint[] | null>(null);
const hoverCell = ref<number | null>(null);
const zoom = ref(100);
let dragOrigin: { x: number; y: number } | null = null;
let moved = false;

const trace = computed(() => props.grid?.trace ?? null);
const asset = computed(() => doc.asset);
const crop = computed(() => doc.crop);
const columns = computed(() => props.grid?.columns ?? doc.settings.columns);
const rows = computed(() => props.grid?.rows ?? Math.round(doc.settings.columns * 0.5));

/**
 * Viewport of the stage. When "跟随裁剪" is on the stage zooms into the crop,
 * so fine detail is editable; guides remain stored in ORIGINAL image
 * coordinates and are simply projected through this viewport. Cropping
 * therefore never moves the lines: it only changes what is magnified.
 */
const followCrop = ref(true);
function visibleCrop() {
  if (!asset.value) return { x: 0, y: 0, w: 1, h: 1 };
  if (!followCrop.value) return { x: 0, y: 0, w: 1, h: 1 };
  return {
    x: crop.value.x,
    y: crop.value.y,
    w: crop.value.width,
    h: crop.value.height,
  };
}
function fit() {
  const el = host.value;
  if (!el || !asset.value) return;
  const width = el.clientWidth || 900;
  const v = visibleCrop();
  // keep the crop's own aspect ratio, within a comfortable height band
  const ratio = (asset.value.height * v.h) / (asset.value.width * v.w);
  const height = Math.min(760, Math.max(260, width * ratio));
  size.value = { w: width, h: height };
}
function px(p: TracePoint) {
  const v = visibleCrop();
  return { x: ((p.x - v.x) / v.w) * size.value.w, y: ((p.y - v.y) / v.h) * size.value.h };
}
function draw() {
  const c = canvas.value;
  if (!c || !asset.value) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(size.value.w * dpr);
  c.height = Math.round(size.value.h * dpr);
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const v = visibleCrop();
  const sx = (v.x * asset.value.width) | 0;
  const sy = (v.y * asset.value.height) | 0;
  const sw = Math.max(1, (v.w * asset.value.width) | 0);
  const sh = Math.max(1, (v.h * asset.value.height) | 0);
  g.drawImage(asset.value.image, sx, sy, sw, sh, 0, 0, size.value.w, size.value.h);
  // dim everything outside the active crop, keeping the guides readable
  g.save();
  g.fillStyle = "rgba(12,14,17,0.62)";
  const cropPx = px({
    x: crop.value.x,
    y: crop.value.y,
  });
  const cropW = (crop.value.width / v.w) * size.value.w;
  const cropH = (crop.value.height / v.h) * size.value.h;
  g.beginPath();
  g.rect(0, 0, size.value.w, size.value.h);
  g.rect(cropPx.x, cropPx.y, cropW, cropH);
  g.fill("evenodd");
  g.restore();
  g.strokeStyle = "rgba(214,237,158,0.5)";
  g.lineWidth = 1;
  g.strokeRect(cropPx.x + 0.5, cropPx.y + 0.5, cropW - 1, cropH - 1);

  // automatic edge field, drawn as short direction ticks per cell
  const tr = trace.value;
  if (tr && doc.trace.settings.showAuto) {
    const cw = cropW / columns.value;
    const ch = cropH / rows.value;
    g.strokeStyle = "rgba(133,174,190,0.75)";
    g.lineWidth = 1.3;
    for (const seg of tr.autoSegments) {
      if (!seg.cells.length) continue;
      g.globalAlpha = 0.3 + Math.min(1, seg.strength) * 0.55;
      for (let k = 0; k < seg.cells.length; k++) {
        const cell = seg.cells[k]!;
        const x = cell % tr.columns;
        const y = Math.floor(cell / tr.columns);
        const cx = cropPx.x + (x + 0.5) * cw;
        const cy = cropPx.y + (y + 0.5) * ch;
        const len = Math.min(cw, ch) * 0.4;
        const mask = seg.masks[k] ?? 0;
        const diag = seg.diagonals[k] ?? "";
        if (mask === 0 && !diag) continue;
        g.beginPath();
        if (mask & 1) segLine(g, cx, cy, cx, cy - len);
        if (mask & 2) segLine(g, cx, cy, cx + len, cy);
        if (mask & 4) segLine(g, cx, cy, cx, cy + len);
        if (mask & 8) segLine(g, cx, cy, cx - len, cy);
        if (mask === 0 && diag === "/")
          segLine(g, cx - len, cy + len, cx + len, cy - len);
        if (mask === 0 && diag === "\\")
          segLine(g, cx - len, cy - len, cx + len, cy + len);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }
  // rejected auto areas
  if (doc.trace.rejected.length) {
    g.strokeStyle = "rgba(207,106,67,0.5)";
    g.lineWidth = 1;
    for (const segment of doc.trace.rejected) {
      g.beginPath();
      for (const p of segment) {
        const q = px(p);
        g.moveTo(q.x - 3, q.y - 3);
        g.lineTo(q.x + 3, q.y + 3);
        g.moveTo(q.x + 3, q.y - 3);
        g.lineTo(q.x - 3, q.y + 3);
      }
      g.stroke();
    }
  }
  // diagnostic cells (breaks) in crop space
  if (tr) {
    const cw = cropW / tr.columns;
    const ch = cropH / tr.rows;
    for (const issue of tr.issues) {
      if (issue.cell === null) continue;
      const broken = issue.code === "break" || issue.code === "corner";
      if (!broken) continue;
      const x = issue.cell % tr.columns;
      const y = Math.floor(issue.cell / tr.columns);
      g.strokeStyle = "rgba(226,120,80,0.95)";
      g.lineWidth = 1.5;
      g.strokeRect(cropPx.x + x * cw + 0.5, cropPx.y + y * ch + 0.5, cw, ch);
    }
  }
  // guides
  if (doc.trace.settings.showGuides) {
    for (const guide of doc.trace.guides) {
      const selected = doc.trace.selectedGuide === guide.id;
      const focused =
        doc.trace.focusConstraint &&
        !doc.trace.focusConstraint.includes(guide.id);
      g.strokeStyle = selected
        ? "#e8f7b6"
        : focused
          ? "rgba(190,199,170,0.35)"
          : "rgba(224,236,180,0.92)";
      g.lineWidth = selected ? 2.4 : 1.6;
      g.beginPath();
      guide.points.forEach((p, i) => {
        const q = px(p);
        if (i === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      });
      g.stroke();
      for (const p of [guide.points[0]!, guide.points[guide.points.length - 1]!]) {
        const q = px(p);
        g.fillStyle = "#dff1a6";
        g.beginPath();
        g.arc(q.x, q.y, 3, 0, Math.PI * 2);
        g.fill();
      }
      const mid = guide.points[Math.floor(guide.points.length / 2)]!;
      const m = px(mid);
      g.fillStyle = "rgba(16,18,22,0.82)";
      g.fillRect(m.x + 4, m.y - 12, 30, 14);
      g.fillStyle = "#dff1a6";
      g.font = "10px ui-monospace, monospace";
      g.fillText(guide.id, m.x + 8, m.y - 2);
    }
  }
  // live drawing
  if (drawing.value) {
    g.strokeStyle = "#f2ffca";
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.beginPath();
    drawing.value.forEach((p, i) => {
      const q = px(p);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    });
    g.stroke();
    g.setLineDash([]);
  }
  // junctions
  for (const junction of doc.trace.junctions) {
    const q = px(junction.point);
    g.strokeStyle = "#f6e18a";
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(q.x, q.y, 6, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(q.x - 9, q.y);
    g.lineTo(q.x + 9, q.y);
    g.moveTo(q.x, q.y - 9);
    g.lineTo(q.x, q.y + 9);
    g.stroke();
    g.fillStyle = "#f6e18a";
    g.font = "10px ui-monospace, monospace";
    g.fillText(junction.id, q.x + 9, q.y - 7);
  }
  // hover cell
  if (hoverCell.value !== null && tr) {
    const cw = cropW / tr.columns;
    const ch = cropH / tr.rows;
    const x = hoverCell.value % tr.columns;
    const y = Math.floor(hoverCell.value / tr.columns);
    g.strokeStyle = "rgba(223,241,166,0.7)";
    g.lineWidth = 1;
    g.strokeRect(cropPx.x + x * cw + 0.5, cropPx.y + y * ch + 0.5, cw, ch);
  }
}
/** Direction field is recomputed cheaply for the overlay ticks. */
function segLine(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
}
function refresh() {
  fit();
  draw();
}
function imagePoint(e: PointerEvent): TracePoint | null {
  const c = canvas.value;
  if (!c) return null;
  const rect = c.getBoundingClientRect();
  const fx = (e.clientX - rect.left) / rect.width;
  const fy = (e.clientY - rect.top) / rect.height;
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
  const v = visibleCrop();
  return { x: v.x + fx * v.w, y: v.y + fy * v.h };
}
/**
 * Whether a point is editable. When the stage follows the crop, the visible
 * viewport IS the crop, so anything on screen is inside it. When the user
 * zooms out to the whole image, only the crop remains editable.
 */
function inCrop(p: TracePoint) {
  if (followCrop.value) return true;
  return (
    p.x >= crop.value.x &&
    p.x <= crop.value.x + crop.value.width &&
    p.y >= crop.value.y &&
    p.y <= crop.value.y + crop.value.height
  );
}
function pointerDown(e: PointerEvent) {
  if (!asset.value || !doc.trace.settings.enabled) return;
  const p = imagePoint(e);
  if (!p) return;
  dragOrigin = { x: e.clientX, y: e.clientY };
  moved = false;
  const target = canvas.value!;
  target.setPointerCapture(e.pointerId);
  if (doc.trace.tool === "junction") {
    if (!inCrop(p)) return;
    const q = doc.trace.settings.snap ? snapPointInCrop(p) : p;
    t.begin(q, q);
    invalidate();
    return;
  }
  drawing.value = [doc.trace.settings.snap ? snapPointInCrop(p) : p];
}
function pointerMove(e: PointerEvent) {
  if (!asset.value) return;
  const p = imagePoint(e);
  if (!p) return;
  if (dragOrigin) {
    const dist = Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y);
    if (dist > 3) moved = true;
  }
  if (drawing.value) {
    const q = doc.trace.settings.snap ? snapPointInCrop(p) : p;
    const last = drawing.value[drawing.value.length - 1]!;
    if (last && Math.hypot(q.x - last.x, q.y - last.y) > 0.0015) {
      drawing.value.push(q);
      draw();
    }
    return;
  }
  const tr = trace.value;
  if (tr && inCrop(p)) {
    const view = visibleCrop();
    const local = {
      x: (p.x - view.x) / view.w,
      y: (p.y - view.y) / view.h,
    };
    const x = Math.min(tr.columns - 1, Math.max(0, Math.floor(local.x * tr.columns)));
    const y = Math.min(tr.rows - 1, Math.max(0, Math.floor(local.y * tr.rows)));
    const cell = y * tr.columns + x;
    if (cell !== hoverCell.value) {
      hoverCell.value = cell;
      draw();
    }
  } else if (hoverCell.value !== null) {
    hoverCell.value = null;
    draw();
  }
}
function snapPointInCrop(p: TracePoint): TracePoint {
  // Snap in the ACTIVE viewport (crop when following, image otherwise) and
  // return an original-image point, so stored guides keep image coordinates.
  const view = visibleCrop();
  const local = { x: (p.x - view.x) / view.w, y: (p.y - view.y) / view.h };
  const x = Math.min(columns.value - 1, Math.max(0, Math.floor(local.x * columns.value)));
  const y = Math.min(rows.value - 1, Math.max(0, Math.floor(local.y * rows.value)));
  return {
    x: view.x + ((x + 0.5) / columns.value) * view.w,
    y: view.y + ((y + 0.5) / rows.value) * view.h,
  };
}
function pointerUp(e: PointerEvent) {
  if (!dragOrigin) return;
  dragOrigin = null;
  if (drawing.value) {
    const points = simplify(drawing.value, 0.0015);
    drawing.value = null;
    if (points.length >= 2 || moved) {
      const guide: TracePoint[] = points;
      const first = guide[0]!;
      const last = guide[guide.length - 1]!;
      // reuse the editor's welding and id allocation path
      t.begin(first, first);
      for (const q of guide.slice(1)) t.extend(q, q);
      t.commit();
      invalidate();
    } else {
      // a click without a drag selects the cell under the pointer
      const tr = trace.value;
      const p = imagePoint(e);
      if (tr && p && inCrop(p)) {
        const view = visibleCrop();
        const x = Math.min(tr.columns - 1, Math.max(0, Math.floor(((p.x - view.x) / view.w) * tr.columns)));
        const y = Math.min(tr.rows - 1, Math.max(0, Math.floor(((p.y - view.y) / view.h) * tr.rows)));
        t.selectCell(y * tr.columns + x);
      }
    }
  }
  draw();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    drawing.value = null;
    t.cancel();
    draw();
  }
}
const cellInfo = computed(() => {
  const tr = trace.value;
  const cell = doc.trace.selectedCell;
  if (!tr || cell === null || cell < 0) return null;
  const x = cell % tr.columns;
  const y = Math.floor(cell / tr.columns);
  return {
    cell,
    x,
    y,
    glyph: tr.chars[cell] ?? " ",
    source: tr.provenance[cell]?.source ?? "—",
    reason: tr.provenance[cell]?.reason ?? "",
    density: tr.densities[cell] ?? 0,
  };
});
onMounted(() => {
  refresh();
  window.addEventListener("resize", refresh);
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", refresh);
  window.removeEventListener("keydown", onKey);
});
watch(
  () => [doc.crop, doc.trace.guides, doc.trace.junctions, doc.trace.settings, trace.value],
  refresh,
  { deep: true },
);
</script>
<template>
  <div class="trace-stage" ref="host">
    <canvas
      ref="canvas"
      class="trace-canvas"
      :style="{ width: size.w + 'px', height: size.h + 'px', cursor: doc.trace.tool === 'junction' ? 'crosshair' : 'crosshair' }"
      aria-label="原图描摹画布"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointerleave="hoverCell = null; draw()"
    />
    <div class="trace-legend">
      <span><i class="lg-guide" />引导线（原图坐标）</span>
      <span><i class="lg-junction" />交点</span>
      <span><i class="lg-auto" />自动轮廓方向</span>
      <span><i class="lg-break" />断点</span>
      <label class="legend-toggle"
        ><input
          type="checkbox"
          v-model="followCrop"
          @change="refresh"
        />跟随裁剪</label
      >
      <span class="mono">{{ doc.trace.guides.length }} 引导 · {{ doc.trace.junctions.length }} 交点</span>
    </div>
    <div v-if="cellInfo" class="cell-inspector">
      <div>
        <b>单元 ({{ cellInfo.x }}, {{ cellInfo.y }})</b>
        <span class="mono">「{{ cellInfo.glyph }}」</span>
      </div>
      <small>决定来源 <b>{{ cellInfo.source }}</b> · {{ cellInfo.reason }}</small>
      <small class="mono">编号 #{{ cellInfo.cell }} · 密度 {{ cellInfo.density.toFixed(2) }}</small>
    </div>
    <p v-else class="trace-stage-hint">
      {{ doc.trace.settings.enabled ? "拖动补画引导线，单击查看单元约束；Esc 取消。" : "在左侧开启结构描摹后即可补画引导线。" }}
    </p>
  </div>
</template>
