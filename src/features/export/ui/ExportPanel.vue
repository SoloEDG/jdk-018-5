<script setup lang="ts">
import { computed } from "vue";
import { Download, Copy, ArrowUpRight, FileJson, ShieldCheck, ShieldAlert } from "lucide-vue-next";
import { useExport } from "../model/useExport";
const e = useExport();
const s = computed(() => e.state());
const traced = computed(() => !!e.doc.grid?.trace);
</script>
<template>
  <section class="export-bar">
    <div>
      <span class="eyebrow">READY TO SHARE</span>
      <h3>带走你的字符作品</h3>
      <small v-if="!traced">文本保留完整字符布局，PNG 保留当前配色。</small>
      <small v-else class="export-guard" :class="{ bad: s.mismatch || !s.ready }">
        <ShieldCheck v-if="s.ready && !s.mismatch" :size="12" />
        <ShieldAlert v-else :size="12" />
        字符与诊断同源 · hash <b class="mono">{{ s.hash || "—" }}</b>
        <span v-if="s.mismatch">· 不一致，导出已锁定</span>
        <span v-else-if="!s.ready">· 等待重新求解</span>
      </small>
    </div>
    <div class="export-actions">
      <button
        class="secondary"
        :disabled="!s.ready || s.mismatch"
        @click="e.copy"
      >
        <Copy :size="15" /> 复制字符</button
      ><button
        v-if="traced"
        class="secondary"
        :disabled="!s.ready || s.mismatch"
        @click="e.saveDiagnostics"
      >
        <FileJson :size="15" /> 诊断 JSON</button
      ><button
        class="secondary"
        :disabled="!s.ready || s.mismatch"
        @click="e.png"
      >
        PNG <ArrowUpRight :size="15" /></button
      ><button
        class="primary"
        :disabled="!s.ready || s.mismatch"
        @click="e.saveText"
      >
        <Download :size="16" /> 导出 .TXT
      </button>
    </div>
  </section>
</template>
