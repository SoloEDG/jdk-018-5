import type { TracePoint } from "../../../shared/document";

/**
 * Ramer–Douglas–Peucker with a tolerance expressed in normalized image units.
 * Freehand input arrives at pointer-event rate; this keeps the stored guides
 * small without flattening real corners.
 */
export function simplify(points: TracePoint[], tolerance: number): TracePoint[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = -1;
    let index = -1;
    const a = points[first]!,
      b = points[last]!;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicular(points[i]!, a, b);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
function perpendicular(p: TracePoint, a: TracePoint, b: TracePoint): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length;
}
