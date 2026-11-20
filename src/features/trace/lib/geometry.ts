import type {
  Crop,
  TraceGuide,
  TracePoint,
} from "../../../shared/document";

/** Pixel-space rectangle of the active crop, in ORIGINAL image pixels. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/**
 * The region of the original image that the crop currently selects. Guides and
 * junctions are stored in ORIGINAL image coordinates, so cropping only changes
 * this rectangle and the guides stay anchored to the picture they were drawn on.
 */
export function cropRect(width: number, height: number, crop: Crop): PixelRect {
  return {
    x: crop.x * width,
    y: crop.y * height,
    width: Math.max(1, crop.width * width),
    height: Math.max(1, crop.height * height),
  };
}
export function distance(a: TracePoint, b: TracePoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
export function pointAtPolyline(points: TracePoint[], t: number): TracePoint {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = distance(points[i - 1]!, points[i]!);
    lengths.push(l);
    total += l;
  }
  if (total === 0) return points[0]!;
  let remaining = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]! || i === lengths.length - 1) {
      const f = lengths[i]! === 0 ? 0 : remaining / lengths[i]!;
      return {
        x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * f,
        y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * f,
      };
    }
    remaining -= lengths[i]!;
  }
  return points[points.length - 1]!;
}
/**
 * Sample a polyline at a fixed arc-length spacing, in normalized units. The
 * spacing is a fraction of a cell so a stroke cannot skip a cell between two
 * samples and invent a gap in the diagnostics.
 */
export function samplePolyline(points: TracePoint[], spacing: number): TracePoint[] {
  if (!points.length) return [];
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += distance(points[i - 1]!, points[i]!);
  const count = Math.max(1, Math.ceil(length / Math.max(spacing, 1e-6)));
  const out: TracePoint[] = [];
  for (let i = 0; i <= count; i++) out.push(pointAtPolyline(points, i / count));
  return out;
}
/** Nearest end point of any other guide, used for endpoint welding. */
export function nearestGuideEnd(
  p: TracePoint,
  guides: TraceGuide[],
  except: string | null,
  radius: number,
): TracePoint | null {
  let best: TracePoint | null = null;
  let bestD = radius;
  for (const g of guides) {
    if (g.id === except || !g.points.length) continue;
    for (const end of [g.points[0]!, g.points[g.points.length - 1]!]) {
      const d = distance(p, end);
      if (d <= bestD) {
        bestD = d;
        best = end;
      }
    }
  }
  return best;
}
