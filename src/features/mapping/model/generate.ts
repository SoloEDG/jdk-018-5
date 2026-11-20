import type { StudioDocument, Grid, TraceResult } from "../../../shared/document";
import { glyphs } from "../lib/charsets";
import { gridSize } from "../lib/gridSize";
import { sample } from "../lib/sample";
import { tone, luminance } from "../lib/tone";
import { solve } from "../../trace/lib/solve";
import { hashChars } from "../../trace/lib/hash";

/**
 * Mood / tone mapping used by the tracing layer. It mirrors the tone panel
 * exactly, so both layers agree on what "the brightness of this cell" means.
 */
export function tonedLuma(doc: StudioDocument) {
  const s = doc.settings;
  return (luma: number) => tone(luma * 255, s.contrast, s.gamma, s.invert) / 1;
}
export function generate(doc: StudioDocument): Grid | null {
  if (!doc.asset) return null;
  const s = doc.settings;
  const size = gridSize(
    doc.asset.width * doc.crop.width,
    doc.asset.height * doc.crop.height,
    s.columns,
  );
  const pixels = sample(
    doc.asset,
    doc.crop,
    size.columns,
    size.rows,
    s.background,
  );
  const chars = glyphs(s.charset, s.custom);
  const cells = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!,
      g = pixels[i + 1]!,
      b = pixels[i + 2]!;
    const t = tone(luminance(r, g, b), s.contrast, s.gamma, s.invert);
    cells.push({
      glyph: chars[Math.round(t * (chars.length - 1))]!,
      color:
        "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
    });
  }
  let trace: TraceResult | null = null;
  if (doc.trace.settings.enabled) {
    const outcome = solve({
      asset: doc.asset,
      crop: doc.crop,
      columns: size.columns,
      rows: size.rows,
      trace: doc.trace,
      background: s.background,
      toned: (luma) => tone(luma * 255, s.contrast, s.gamma, s.invert),
      clamp: size.clamped ? size.detail : null,
    });
    // The traced characters replace the tone cells. Diagnostics, selection
    // and the exported text all read this single array.
    for (let i = 0; i < cells.length; i++) {
      cells[i]!.glyph = outcome.chars[i] ?? " ";
    }
    trace = {
      columns: size.columns,
      rows: size.rows,
      chars: outcome.chars,
      densities: outcome.densities,
      provenance: outcome.provenance,
      issues: outcome.issues,
      diagnostics: outcome.diagnostics,
      autoSegments: outcome.autoSegments,
      guideCells: outcome.guideCells,
      junctionCells: outcome.junctionCells,
      hash: hashChars(outcome.chars, size.columns, size.rows),
      revision: doc.revision,
    };
  }
  return { ...size, cells, revision: doc.revision, trace };
}
