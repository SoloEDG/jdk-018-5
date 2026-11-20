import type { Asset, Crop } from "../../../shared/document";
import { cropRect } from "./geometry";

/**
 * Image-space analysis shared by every consumer.
 *
 * Pipeline: image → luminance → Sobel magnitude + quantised edge direction →
 * per-cell evidence. The edge direction is quantised to 8 compass sectors
 * (0 = east, running counter-clockwise), exactly the vocabulary the
 * box-drawing characters speak.
 */
export interface Field {
  columns: number;
  rows: number;
  /** luminance 0..1 per cell */
  luma: Float32Array;
  /** Sobel magnitude 0..1 per cell */
  magnitude: Float32Array;
  /** dominant edge direction in eighths of a turn; -1 when unclear */
  direction: Int8Array;
}
const PI2 = Math.PI * 2;

/** Draw the cropped image at grid resolution and return the luminance plane. */
export function sampleLuma(
  asset: Asset,
  crop: Crop,
  columns: number,
  rows: number,
  background: string,
): Float32Array {
  const rect = cropRect(asset.width, asset.height, crop);
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = background;
  g.fillRect(0, 0, columns, rows);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(
    asset.image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    columns,
    rows,
  );
  const data = g.getImageData(0, 0, columns, rows).data;
  const luma = new Float32Array(columns * rows);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    luma[j] =
      (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
  }
  return luma;
}
function at(luma: Float32Array, w: number, h: number, x: number, y: number) {
  const cx = Math.min(w - 1, Math.max(0, x));
  const cy = Math.min(h - 1, Math.max(0, y));
  return luma[cy * w + cx]!;
}
/**
 * Isotropic Sobel. The gradient points across an edge; a stroke runs along the
 * edge, which is 90° from the gradient. The compass sector stored here is the
 * STROKE direction, so the solver can directly pick a glyph.
 */
export function sobel(luma: Float32Array, w: number, h: number) {
  const magnitude = new Float32Array(w * h);
  const direction = new Int8Array(w * h);
  const gv = new Float32Array(w * h);
  const gh = new Float32Array(w * h);
  let peak = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = at(luma, w, h, x - 1, y - 1);
      const b = at(luma, w, h, x, y - 1);
      const c = at(luma, w, h, x + 1, y - 1);
      const d = at(luma, w, h, x - 1, y);
      const f = at(luma, w, h, x + 1, y);
      const gg = at(luma, w, h, x - 1, y + 1);
      const hh = at(luma, w, h, x, y + 1);
      const ii = at(luma, w, h, x + 1, y + 1);
      const dx = c + 2 * f + ii - (a + 2 * d + gg);
      const dy = gg + 2 * hh + ii - (a + 2 * b + c);
      gv[y * w + x] = dx;
      gh[y * w + x] = dy;
      const m = Math.hypot(dx, dy) / 4;
      magnitude[y * w + x] = m;
      if (m > peak) peak = m;
    }
  }
  const scale = peak > 1e-6 ? 1 / peak : 0;
  for (let i = 0; i < magnitude.length; i++) {
    magnitude[i] = magnitude[i]! * scale;
    // gradient angle measured with y down; stroke = gradient + 90°
    const angle = Math.atan2(gh[i]!, gv[i]!);
    const stroke = angle + Math.PI / 2;
    const sector = ((Math.round(((-stroke / PI2) * 8) % 8) + 8) % 8) | 0;
    direction[i] = sector;
  }
  return { magnitude, direction };
}
export function buildField(
  asset: Asset,
  crop: Crop,
  columns: number,
  rows: number,
  background: string,
): Field {
  const luma = sampleLuma(asset, crop, columns, rows, background);
  const { magnitude, direction } = sobel(luma, columns, rows);
  return { columns, rows, luma, magnitude, direction };
}
