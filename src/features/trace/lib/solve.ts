import type {
  Asset,
  AutoSegment,
  Crop,
  IssueOption,
  PolicyArm,
  PolicyComparison,
  TraceIssue,
  TracePoint,
  TraceProvenance,
  TraceSettings,
  TraceState,
} from "../../../shared/document";
import { charsetFor, ramp, sideMask, textureFor, type GlyphSpec } from "./charset";
import { buildField, type Field } from "./field";
import { distance, samplePolyline } from "./geometry";

/**
 * Constraint solver.
 *
 * Deterministic: the same document, grid size and accepted relaxations always
 * yield the same characters. Every diagnostic is computed from the exact array
 * that is rendered and exported, so characters and diagnosed cells cannot
 * drift apart.
 */
export interface SolveInput {
  asset: Asset;
  crop: Crop;
  columns: number;
  rows: number;
  trace: TraceState;
  background: string;
  /** tone curve from the mapping panel (contrast / gamma / invert) */
  toned: (luma: number) => number;
  /** set when the grid had to be clamped; reported as a density constraint */
  clamp?: string | null;
}
export interface GuidePath {
  guideId: string;
  cells: number[];
  /** indices of steps between cells that only touch at a corner */
  cornerSteps: number[];
}
export interface SolveOutcome {
  chars: string[];
  specs: (GlyphSpec | null)[];
  densities: number[];
  provenance: TraceProvenance[];
  issues: TraceIssue[];
  autoSegments: AutoSegment[];
  guideCells: { guide: string; cells: number[] }[];
  junctionCells: { junction: string; cell: number }[];
  guidePaths: GuidePath[];
  diagnostics: {
    breaks: number;
    cornerBreaks: number;
    autoBreaks: number;
    brightnessError: number;
    connectivity: number;
    autoConnectivity: number;
    glyphCount: number;
    budget: number;
    overBudget: boolean;
    intentCount: number;
    junctionCount: number;
    solved: boolean;
  };
  /** |glyph density - target| per cell, for the deviation overlay */
  toneError: Float32Array;
}
const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const N = 1,
  E = 2,
  S = 4,
  W = 8;
const ORTHO = [
  { mask: E, dx: 1, dy: 0 },
  { mask: W, dx: -1, dy: 0 },
  { mask: S, dx: 0, dy: 1 },
  { mask: N, dx: 0, dy: -1 },
] as const;

export function cellCoord(index: number, columns: number) {
  return { x: index % columns, y: Math.floor(index / columns) };
}
export function cellOfPoint(
  p: TracePoint,
  columns: number,
  rows: number,
  crop: Crop,
): number {
  const fx = ((p.x - crop.x) / crop.width) * columns;
  const fy = ((p.y - crop.y) / crop.height) * rows;
  if (!Number.isFinite(fx) || fx < 0 || fy < 0 || fx >= columns || fy >= rows)
    return -1;
  return Math.floor(fy) * columns + Math.floor(fx);
}
export function cellCentre(
  x: number,
  y: number,
  columns: number,
  rows: number,
  crop: Crop,
): TracePoint {
  return {
    x: crop.x + ((x + 0.5) / columns) * crop.width,
    y: crop.y + ((y + 0.5) / rows) * crop.height,
  };
}
function isDiagonal(a: number, b: number, columns: number) {
  const pa = cellCoord(a, columns),
    pb = cellCoord(b, columns);
  return Math.abs(pa.x - pb.x) === 1 && Math.abs(pa.y - pb.y) === 1;
}
function diagOf(a: number, b: number, columns: number): "/" | "\\" | "" {
  const pa = cellCoord(a, columns),
    pb = cellCoord(b, columns);
  const dx = pb.x - pa.x,
    dy = pb.y - pa.y;
  if (dx === 0 || dy === 0) return "";
  return dx * dy > 0 ? "\\" : "/";
}
/** Border directions shared by two ORTHOGONALLY adjacent cells. */
function orthoStep(a: number, b: number, columns: number) {
  const pa = cellCoord(a, columns),
    pb = cellCoord(b, columns);
  const dx = pb.x - pa.x,
    dy = pb.y - pa.y;
  if (dx === 1 && dy === 0) return { aSide: E, bSide: W } as const;
  if (dx === -1 && dy === 0) return { aSide: W, bSide: E } as const;
  if (dx === 0 && dy === 1) return { aSide: S, bSide: N } as const;
  if (dx === 0 && dy === -1) return { aSide: N, bSide: S } as const;
  return null;
}
/**
 * Walk a guide across the grid. Intermediate cells are inserted for steep
 * strokes so a path never teleports. Each step is classified as orthogonal
 * (shares a border → can be joined) or diagonal (corner contact only).
 */
export function walkGuide(
  guideId: string,
  points: TracePoint[],
  columns: number,
  rows: number,
  crop: Crop,
): GuidePath {
  const spacing = Math.min(crop.width / columns, crop.height / rows) / 6;
  const samples = samplePolyline(points, spacing);
  /**
   * Step the walk one axis at a time, always along the axis with the larger
   * remaining distance. A shallow line therefore becomes ─ ─ ╮╰ rather than a
   * chain of 45° jumps: the staircase is the honest grid rendition of the
   * stroke, and only a genuinely 1:1 slope produces corner-only contact.
   */
  const cells: number[] = [];
  let prev: { x: number; y: number } | null = null;
  for (const p of samples) {
    const fx = ((p.x - crop.x) / crop.width) * columns;
    const fy = ((p.y - crop.y) / crop.height) * rows;
    if (fx < 0 || fy < 0 || fx >= columns || fy >= rows) continue;
    const x = Math.floor(fx),
      y = Math.floor(fy);
    if (!prev) {
      cells.push(y * columns + x);
      prev = { x, y };
      continue;
    }
    let cx: number = prev.x,
      cy: number = prev.y;
    let guard = columns + rows;
    while ((cx !== x || cy !== y) && guard-- > 0) {
      if (Math.abs(x - cx) >= Math.abs(y - cy)) cx += Math.sign(x - cx);
      else cy += Math.sign(y - cy);
      cells.push(cy * columns + cx);
    }
    prev = { x, y };
  }
  const path: number[] = [];
  for (const c of cells) if (path[path.length - 1] !== c) path.push(c);
  const cornerSteps: number[] = [];
  for (let i = 1; i < path.length; i++)
    if (isDiagonal(path[i - 1]!, path[i]!, columns)) cornerSteps.push(i);
  return { guideId, cells: path, cornerSteps };
}
interface Arm {
  owner: string;
  mask: number;
  diag: "/" | "\\" | "";
}
interface Intent {
  index: number;
  mask: number;
  /** "" | "/" | "\\" | "/\\" when both diagonals are demanded */
  diags: string;
  arms: Arm[];
  owners: string[];
}

export function solve(input: SolveInput): SolveOutcome {
  const { asset, crop, columns, rows, trace, background } = input;
  const settings = trace.settings;
  const count = columns * rows;
  const specSet = charsetFor(settings.glyphSet);
  const ladder = ramp(textureFor(settings.glyphSet));
  const field = buildField(asset, crop, columns, rows, background);
  /**
   * Ink target. In line-art mode a dark pixel becomes a dense glyph, which is
   * the inverse of the photo mapping; both modes still use the same tone curve
   * so contrast/gamma behave identically.
   */
  const wanted = (i: number) =>
    settings.ink ? 1 - input.toned(field.luma[i]!) : input.toned(field.luma[i]!);

  /* ── 1. guides → per-cell intent ─────────────────────────────────────── */
  const paths = trace.guides
    .filter((g) => g.points.length > 0)
    .map((g) => walkGuide(g.id, g.points, columns, rows, crop));
  const intent = new Map<number, Intent>();
  const touch = (index: number): Intent => {
    let rec = intent.get(index);
    if (!rec) {
      rec = { index, mask: 0, diags: "", arms: [], owners: [] };
      intent.set(index, rec);
    }
    return rec;
  };
  const guideCells: { guide: string; cells: number[] }[] = [];
  /** guides explicitly marked "required" – their breaks are hard failures */
  const requiredGuides = new Set(
    trace.guides.filter((g) => g.required).map((g) => g.id),
  );
  for (const path of paths) {
    guideCells.push({ guide: path.guideId, cells: path.cells.slice() });
    for (let i = 0; i < path.cells.length; i++) {
      const cell = path.cells[i]!;
      const rec = touch(cell);
      if (!rec.owners.includes(path.guideId)) rec.owners.push(path.guideId);
      let mask = 0;
      const diags = new Set<"/" | "\\">();
      for (const neighbour of [i > 0 ? path.cells[i - 1]! : -1, i < path.cells.length - 1 ? path.cells[i + 1]! : -1]) {
        if (neighbour < 0) continue;
        const step = orthoStep(cell, neighbour, columns);
        if (step) mask |= step.aSide;
        else {
          const d = diagOf(cell, neighbour, columns);
          if (d) diags.add(d);
        }
      }
      const diag = diags.size === 1 ? [...diags][0]! : "";
      rec.arms.push({ owner: path.guideId, mask, diag });
      rec.mask |= mask;
      if (diags.size === 1) rec.diags = rec.diags || diag;
      else if (diags.size > 1) rec.diags = "/\\";
    }
  }
  /* ── 2. junctions ────────────────────────────────────────────────────── */
  const junctionCells: { junction: string; cell: number }[] = [];
  const junctionAt = new Map<string, number>();
  for (const junction of trace.junctions) {
    const cell = cellOfPoint(junction.point, columns, rows, crop);
    if (cell < 0) continue;
    junctionCells.push({ junction: junction.id, cell });
    junctionAt.set(junction.id, cell);
    const rec = touch(cell);
    if (!rec.owners.includes(junction.id)) rec.owners.push(junction.id);
  }
  /**
   * A guide shorter than one cell has no direction to express. It is not a
   * joined line and must not be counted as one, so it is recorded here and
   * reported as a density constraint instead of silently contributing a glyph.
   */
  const collapsedGuides = new Map<string, number>();
  for (const guide of trace.guides) {
    if (!guide.points.length) continue;
    const path = paths.find((p) => p.guideId === guide.id);
    if (!path) continue;
    if (path.cells.length < 2) collapsedGuides.set(guide.id, path.cells[0] ?? 0);
  }
  /** guides passing through each junction cell, excluding the junction itself */
  const armsAt = (junctionId: string): string[] => {
    const cell = junctionAt.get(junctionId);
    if (cell === undefined) return [];
    return (intent.get(cell)?.owners ?? []).filter(
      (o) => o !== junctionId && !junctionAt.has(o),
    );
  };
  /* ── 3. automatic contour ────────────────────────────────────────────── */
  const auto = autoSegments(field, settings, trace.rejected, columns, rows, crop);
  const autoSegmentOf = new Map<number, AutoSegment>();
  const autoInterior = new Map<number, boolean>();
  for (const seg of auto)
    for (let k = 0; k < seg.cells.length; k++) {
      const c = seg.cells[k]!;
      autoSegmentOf.set(c, seg);
      if (seg.masks[k] === 15) autoInterior.set(c, true);
    }

  /* ── 4. choose glyphs ────────────────────────────────────────────────── */
  const chars: string[] = new Array(count).fill(" ");
  const chosen: (GlyphSpec | null)[] = new Array(count).fill(null);
  const provenance: TraceProvenance[] = new Array(count)
    .fill(null)
    .map(() => ({ source: "TONE", reason: "未分配" }));
  const issues: TraceIssue[] = [];
  const report = (
    code: TraceIssue["code"],
    id: string,
    kind: TraceIssue["kind"],
    label: string,
    detail: string,
    cell: number | null,
    options: IssueOption[] = [],
  ) => {
    issues.push({
      code,
      id,
      kind,
      label,
      detail,
      cell,
      options,
      key: `${code}:${id}:${cell ?? "-"}`,
    });
  };
  const budget = Math.max(1, Math.round((count * settings.budgetPercent) / 100));
  const structureFirst = settings.policy === "structure";
  const ownerName = (rec: Intent) =>
    rec.owners.filter((o) => !junctionAt.has(o)).join("+") ||
    rec.owners.join("+");

  // pass A – hard constraints
  for (const rec of [...intent.values()].sort((a, b) => a.index - b.index)) {
    const name = ownerName(rec);
    const p = cellCoord(rec.index, columns);
    const guideOwners = rec.owners.filter((o) => !junctionAt.has(o));
    /**
     * Two guides meeting in one cell. With the crossing relaxation off the
     * solver still draws BOTH arms, because refusing to draw one would invent a
     * gap that the user did not ask for; instead the shared cell is reported as
     * an explicit constraint so the user can accept or fix it.
     */
    const crosses = guideOwners.length > 1 && popcount(rec.mask) > 2;
    if (crosses && !settings.allowCross) {
      // Whether the shared cell is drawable decides what we can promise:
      // a ╬-style glyph really joins both lines, while an L-shaped one cannot.
      const drawable = chooseIntentGlyph(rec, specSet, settings);
      const covers =
        !!drawable && popcount(rec.mask & ~sideMask(drawable)) === 0;
      report(
        "crossing",
        guideOwners.join("+"),
        "guide",
        `单元 (${p.x},${p.y}) 被两段线交叉`,
        covers
          ? `“${guideOwners.join("” 与 “")}” 共用字符「${drawable!.glyph}」，两侧边臂都在，连通成立；但两段线自此不再能各自独立追踪。接受“允许单元内交叉”即视为已确认。`
          : `“${guideOwners.join("” 与 “")}” 在同一单元交汇，需要 ${maskName(rec.mask)}，而字符集最多只能表达一个交叉字符；未接受交叉放宽时该处会如实记为断点。`,
        rec.index,
        [
          { code: "crossing", label: "允许单元内交叉", effect: "用一个交叉字符同时表达两段线" },
          { code: "density", label: "提高字符密度", effect: "把两段线分到不同单元" },
        ],
      );
    }
    const glyph = chooseIntentGlyph(rec, specSet, settings);
    if (!glyph) {
      if (rec.mask === 0 && !rec.diags) {
        // junction with no arms – reported below, nothing to draw
        continue;
      }
      report(
        "charset",
        guideOwners.join("+") || "CHARSET",
        "guide",
        `单元 (${p.x},${p.y}) 的方向超出字符集`,
        `需要 ${maskName(rec.mask) || rec.diags || "斜向"}，但当前字符集没有可用字形。不会用空格冒充连通。`,
        rec.index,
        [
          { code: "diagonals", label: "允许对角线", effect: "以 ╱ ╲ 表达角接触" },
          { code: "crossing", label: "允许单元内交叉", effect: "以交叉字符表达多方向" },
        ],
      );
      continue;
    }
    chars[rec.index] = glyph.glyph;
    chosen[rec.index] = glyph;
    const missingMask = rec.mask & ~sideMask(glyph);
    const lostDiag = !settings.allowDiag && !!rec.diags && !glyph.diag;
    // A glyph that covers fewer arms is honest, but never silently: the
    // uncovered arms are reported and will show up as guide breaks below.
    if (missingMask || rec.diags === "/\\" || (lostDiag && rec.mask === 0)) {
      report(
        "corner",
        name,
        "guide",
        `${name} 在 (${p.x},${p.y}) 无法被单字符完整表达`,
        `${describeIntent(rec)}；字形「${glyph.glyph}」只覆盖 ${maskName(sideMask(glyph)) || glyph.diag || "无"}。该处按断点如实报告。`,
        rec.index,
        [
          { code: "crossing", label: "允许单元内交叉", effect: "换成十字类字符补足两段" },
          { code: "diagonals", label: "允许对角线", effect: "把角接触计为连通" },
        ],
      );
    }
    provenance[rec.index] = {
      source: rec.owners[0]!,
      reason: `约束方向 ${maskName(rec.mask)}${rec.diags ? ` ${rec.diags}` : ""}`,
    };
  }
  // junction verification – a junction must actually join ≥2 guide arms
  for (const [id, cell] of junctionAt) {
    const arms = armsAt(id);
    const p = cellCoord(cell, columns);
    if (arms.length === 0) {
      report(
        "orphan",
        id,
        "junction",
        `${id} 没有相连的引导线`,
        `交点位于 (${p.x},${p.y})，但没有任何引导线经过，连续性无法被证明。`,
        cell,
        [],
      );
    } else if (arms.length < 2) {
      report(
        "orphan",
        id,
        "junction",
        `${id} 只连接一条线`,
        `“必须连续的交点”在 (${p.x},${p.y}) 目前只被 ${arms[0]} 经过；请补画第二段线或移动交点。`,
        cell,
        [],
      );
    }
  }

  for (const [id, cell] of collapsedGuides) {
    const p = cellCoord(cell, columns);
    report(
      "density",
      id,
      "guide",
      `${id} 在 ${columns} 列下塌缩进单个单元`,
      `引导线在 (${p.x},${p.y}) 内不足一个单元，无法表达任何方向；这不是已连通。提高字符密度或缩短线段后再求解。`,
      cell,
      [
        { code: "density", label: "提高字符密度", effect: `把列数从 ${columns} 提高后重新划分网格` },
      ],
    );
  }
  // pass B – budgeted fill
  let glyphCount = 0;
  for (let i = 0; i < count; i++) if (chosen[i]) glyphCount++;
  const hardCells = new Set(intent.keys());
  const free: number[] = [];
  for (let i = 0; i < count; i++) if (!hardCells.has(i)) free.push(i);
  const autoFree = free.filter((c) => settings.showAuto && autoSegmentOf.has(c));
  const toneFree = free.filter((c) => !autoFree.includes(c));
  /**
   * Automatic contours are ordered so that interior cells are drawn before
   * cells on the outline: an inner cell cannot be joined to anything if its
   * neighbours were skipped, and reporting that as a break would be a lie.
   */
  const autoPriority = (a: number, b: number) => {
    const ia = autoInterior.get(a) ? 1 : 0;
    const ib = autoInterior.get(b) ? 1 : 0;
    return ib - ia || field.magnitude[b]! - field.magnitude[a]! || a - b;
  };
  if (structureFirst) {
    // Structural fill: contour first, then shading with whatever budget is
    // left. The contour therefore always wins the shared quota.
    autoFree.sort(autoPriority);
    for (const cell of autoFree) {
      if (glyphCount >= budget) break;
      const glyph = chooseAutoGlyph(autoSegmentOf.get(cell)!, cell, specSet);
      if (!glyph) continue;
      chars[cell] = glyph.glyph;
      chosen[cell] = glyph;
      glyphCount++;
      provenance[cell] = {
        source: autoSegmentOf.get(cell)!.id,
        reason: `自动轮廓 ${maskName(autoMaskOf(autoSegmentOf.get(cell)!, cell))}`,
      };
    }
    toneFree.sort((a, b) => wanted(b) - wanted(a) || a - b);
    for (const cell of toneFree) {
      if (glyphCount >= budget) break;
      const glyph = fitTone(wanted(cell), ladder);
      if (!glyph) continue;
      chars[cell] = glyph.glyph;
      chosen[cell] = glyph;
      glyphCount++;
      provenance[cell] = { source: "TONE", reason: "灰阶匹配" };
    }
  } else {
    // tonal fill: darkest first, then the contour gets whatever is left
    toneFree.sort((a, b) => wanted(b) - wanted(a) || a - b);
    for (const cell of toneFree) {
      if (glyphCount >= budget) break;
      let glyph = fitTone(wanted(cell), ladder);
      if (!glyph) continue;
      if (settings.showAuto && autoSegmentOf.has(cell)) {
        const edge = chooseAutoGlyph(autoSegmentOf.get(cell)!, cell, specSet);
        if (edge && Math.abs(edge.density - wanted(cell)) <= 0.1) glyph = edge;
      }
      chars[cell] = glyph.glyph;
      chosen[cell] = glyph;
      glyphCount++;
      provenance[cell] = {
        source:
          settings.showAuto && autoSegmentOf.has(cell)
            ? autoSegmentOf.get(cell)!.id
            : "TONE",
        reason: "灰阶匹配",
      };
    }
    autoFree.sort(autoPriority);
    for (const cell of autoFree) {
      if (glyphCount >= budget) break;
      const glyph = chooseAutoGlyph(autoSegmentOf.get(cell)!, cell, specSet);
      if (!glyph) continue;
      chars[cell] = glyph.glyph;
      chosen[cell] = glyph;
      glyphCount++;
      provenance[cell] = {
        source: autoSegmentOf.get(cell)!.id,
        reason: `轮廓补足 ${maskName(autoMaskOf(autoSegmentOf.get(cell)!, cell))}`,
      };
    }
  }

  /* ── 5. diagnostics from the final characters ────────────────────────── */
  const toneError = new Float32Array(count);
  for (let i = 0; i < count; i++)
    toneError[i] = Math.abs((chosen[i]?.density ?? 0) - wanted(i));
  let breakCount = 0,
    cornerBreaks = 0;
  const brokenSteps = new Map<string, { cell: number; count: number; corner: boolean }>();
  let steps = 0,
    joinedSteps = 0;
  for (const path of paths) {
    for (let i = 1; i < path.cells.length; i++) {
      const a = path.cells[i - 1]!,
        b = path.cells[i]!;
      if (a === b) continue;
      steps++;
      const diagonal = isDiagonal(a, b, columns);
      if (joinedGlyph(chosen[a] ?? null, chosen[b] ?? null, a, b, columns, settings)) {
        joinedSteps++;
        continue;
      }
      if (diagonal) cornerBreaks++;
      else breakCount++;
      const key = `${path.guideId}:${diagonal ? "corner" : "break"}`;
      const rec = brokenSteps.get(key);
      if (rec) rec.count++;
      else brokenSteps.set(key, { cell: b, count: 1, corner: diagonal });
    }
  }
  for (const [key, rec] of brokenSteps) {
    const guideId = key.split(":")[0]!;
    const p = cellCoord(rec.cell, columns);
    const essential = requiredGuides.has(guideId);
    report(
      rec.corner ? "corner" : "break",
      guideId,
      "guide",
      `${guideId} ${rec.corner ? "角接触未连通" : "断开"} ×${rec.count}${essential ? "（必须连续）" : ""}`,
      rec.corner
        ? `首处位于 (${p.x},${p.y})：相邻单元仅共享角，字符笔画没有共同边。接受“允许对角线”才会改变判定标准，且会改记在“对角线」下。`
        : `首处位于 (${p.x},${p.y})：相邻字符没有共同边，不能视为已连通。`,
      rec.cell,
      rec.corner
        ? [
            { code: "diagonals", label: "允许对角线", effect: "把角接触计为连通（判定标准改变）" },
            { code: "density", label: "提高字符密度", effect: "让阶梯路径落在相邻边上" },
          ]
        : [
            { code: "crossing", label: "允许单元内交叉", effect: "允许两段线共用单元" },
            { code: "density", label: "提高字符密度", effect: "重新划分网格以恢复连通" },
          ],
    );
  }
  /**
   * Automatic-contour connectivity is measured per REQUIRED ARM, not per
   * neighbour pair: every arm is a claim that the line continues in that
   * direction, and it only counts when both characters cover the shared
   * border. Corner-only contacts are counted separately and never as joined.
   */
  let autoBreaks = 0,
    autoPairs = 0,
    autoJoined = 0;
  const autoBreakSeen = new Map<number, { seg: string; corner: boolean }>();
  for (const seg of auto) {
    for (let k = 0; k < seg.cells.length; k++) {
      const cell = seg.cells[k]!;
      const glyph = chosen[cell];
      const mask = seg.masks[k]!;
      const { x, y } = cellCoord(cell, columns);
      if (!glyph) {
        // Not drawn at all (budget). Its arms are still part of the skeleton,
        // so they must be counted as unsatisfied instead of silently vanishing.
        let lost = false;
        for (const step of ORTHO) {
          if (!(mask & step.mask)) continue;
          const nx = x + step.dx,
            ny = y + step.dy;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
          autoPairs++;
          autoBreaks++;
          lost = true;
        }
        if (mask === 0 && seg.diagonals[k]) {
          autoPairs++;
          autoBreaks++;
          lost = true;
        }
        if (lost && !autoBreakSeen.has(cell))
          autoBreakSeen.set(cell, { seg: seg.id, corner: false });
        continue;
      }
      for (const step of ORTHO) {
        if (!(mask & step.mask)) continue;
        const nx = x + step.dx,
          ny = y + step.dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        autoPairs++;
        const other = ny * columns + nx;
        if (joinedGlyph(glyph, chosen[other] ?? null, cell, other, columns, settings))
          autoJoined++;
        else {
          autoBreaks++;
          if (!autoBreakSeen.has(cell))
            autoBreakSeen.set(cell, { seg: seg.id, corner: false });
        }
      }
      if (mask === 0 && seg.diagonals[k]) {
        // a lone diagonal is a corner contact by definition
        autoPairs++;
        autoBreaks++;
        if (!autoBreakSeen.has(cell))
          autoBreakSeen.set(cell, { seg: seg.id, corner: true });
      }
    }
  }
  for (const [cell, info] of [...autoBreakSeen.entries()].sort((a, b) => a[0] - b[0])) {
    const p = cellCoord(cell, columns);
    report(
      "auto",
      info.seg,
      "auto",
      `${info.seg} 在 (${p.x},${p.y}) ${info.corner ? "角接触" : "未连通"}`,
      info.corner
        ? "该单元只剩斜向笔画，只与邻格共角，默认不计为连通。"
        : "该单元的自动边缘字符与相邻骨架单元没有共享边；不会被计为连通。接受对角线或改用结构优先可改变结果。",
      cell,
      [
        { code: "diagonals", label: "允许对角线", effect: "把角接触计为连通" },
        { code: "density", label: "提高字符密度", effect: "重新划分网格" },
      ],
    );
  }
  // Rejecting an automatic edge must be explicit about what happened.
  if (trace.rejected.length) {
    report(
      "auto",
      "REJECTED",
      "auto",
      `已拒绝 ${trace.rejected.length} 处自动边缘`,
      "被拒绝的自动边缘不会绘制；重新求解已排除这些位置。若希望恢复，请在面板中清除拒绝。",
      null,
      [],
    );
  }
  if (input.clamp) {
    report(
      "density",
      "GRID",
      "policy",
      "网格已被钳制",
      `${input.clamp} 未满足的密度要求会在此如实列出，不会把压缩后的结果当作原始请求。`,
      null,
      [
        { code: "density", label: "提高字符密度", effect: "重新计算网格，可能再次触发钳制" },
      ],
    );
  }
  if (glyphCount > budget) {
    report(
      "budget",
      "POLICY",
      "policy",
      `硬约束超出预算 ${glyphCount}/${budget}`,
      "引导线与交点优先于预算，超出的单元已如实绘制，没有为了省格子而伪造断开。",
      null,
      [{ code: "budget", label: "提高预算", effect: "把预算提升到硬约束所需数量" }],
    );
  } else if (hardCells.size >= budget) {
    report(
      "budget",
      "POLICY",
      "policy",
      `预算 ${budget} 已被硬约束占满`,
      "没有剩余单元用于轮廓或灰阶，字符画只剩下引导线结构。",
      null,
      [{ code: "budget", label: "提高预算", effect: "为轮廓和灰阶留出空间" }],
    );
  }
  for (const seg of auto) {
    if (!seg.cells.some((c) => chosen[c])) continue;
    // segment only partially drawn because the budget ran out; cells with no
    // arms at all are background and are not "missing" anything
    const missing = seg.cells.filter(
      (c, k) => !chosen[c] && (seg.masks[k] !== 0 || seg.diagonals[k]),
    ).length;
    if (missing)
      report(
        "auto",
        seg.id,
        "auto",
        `${seg.id} 只绘制了 ${seg.cells.length - missing}/${seg.cells.length} 个单元`,
        "预算限制了该自动边缘的完整绘制；未绘制的部分不计为连通。",
        null,
        [{ code: "budget", label: "提高预算", effect: "完整绘制该轮廓" }],
      );
  }
  issues.sort(
    (a, b) =>
      issueWeight(a.code) - issueWeight(b.code) ||
      (a.cell ?? 0) - (b.cell ?? 0) ||
      a.id.localeCompare(b.id),
  );
  let brightnessError = 0;
  for (let i = 0; i < count; i++) brightnessError += toneError[i]!;
  brightnessError /= Math.max(1, count);
  return {
    chars,
    specs: chosen,
    densities: chosen.map((s) => s?.density ?? 0),
    provenance,
    issues,
    autoSegments: auto,
    guideCells,
    junctionCells,
    guidePaths: paths,
    diagnostics: {
      breaks: breakCount,
      cornerBreaks,
      autoBreaks,
      brightnessError,
      connectivity: steps ? (joinedSteps / steps) * 100 : 100,
      autoConnectivity: autoPairs ? (autoJoined / autoPairs) * 100 : 100,
      glyphCount,
      budget,
      overBudget: glyphCount > budget,
      intentCount: intent.size,
      junctionCount: junctionCells.length,
      solved: !issues.length,
    },
    toneError,
  };
}
/* ── glyph selection ───────────────────────────────────────────────────── */
function popcount(mask: number) {
  let n = 0;
  for (let i = 0; i < 4; i++) if (mask & (1 << i)) n++;
  return n;
}
export function maskName(mask: number): string {
  return (
    (["N", "E", "S", "W"] as const)
      .filter((_, i) => mask & (1 << i))
      .join("") || "—"
  );
}
function describeIntent(rec: Intent): string {
  const parts: string[] = [];
  if (rec.mask) parts.push(`需要 ${maskName(rec.mask)}`);
  if (rec.diags === "/\\") parts.push("同时需要 ╱ 与 ╲");
  else if (rec.diags) parts.push(`需要 ${rec.diags}`);
  return parts.join("，") || "该单元被多条约束占用";
}
/**
 * Choose the glyph for a constrained cell. Missing arms are heavily penalised
 * so an exact fit always wins; extra arms get a small penalty so a T-junction
 * does not silently become a cross.
 */
function chooseIntentGlyph(
  rec: Intent,
  specs: GlyphSpec[],
  settings: TraceSettings,
): GlyphSpec | null {
  if (rec.mask === 0 && !rec.diags) return null; // junction-only, no line to draw
  const wantDiag = rec.mask === 0 && (rec.diags === "/" || rec.diags === "\\");
  let best: GlyphSpec | null = null;
  let bestScore = Infinity;
  for (const s of specs) {
    if (s.density <= 0) continue;
    let score = s.density * 0.05;
    if (wantDiag) {
      score += s.diag === rec.diags ? 0 : 100;
      if (settings.allowDiag && s.diag === rec.diags) score -= 1;
    } else {
      const missing = rec.mask & ~sideMask(s);
      score += popcount(missing) * 100;
      if (s.diag) score += rec.mask ? 100 : 0;
    }
    if (rec.diags === "/\\") score += s.diag ? 3 : 0; // prefer a plain cross
    else if (rec.diags && !wantDiag && !settings.allowDiag) score += 0;
    const extra = popcount(sideMask(s) & ~rec.mask);
    score += extra * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
/**
 * Tone-only glyph selection, closest density wins. Cells that no contour asked
 * for are shading, never line work: the texture ladder has no border arms, so
 * a filled background can never masquerade as a connected edge.
 */
function fitTone(target: number, ladder: GlyphSpec[]): GlyphSpec | null {
  if (target < 0.06) return null;
  let best: GlyphSpec | null = null;
  let bestDelta = Infinity;
  for (const s of ladder) {
    const delta = Math.abs(s.density - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  return best;
}
function issueWeight(code: string) {
  return (
    {
      density: 0,
      crossing: 1,
      corner: 2,
      charset: 3,
      break: 4,
      orphan: 5,
      budget: 6,
      auto: 7,
    }[code] ?? 9
  );
}
/**
 * Canonical join test. It reads only the characters that will be exported,
 * never the intent, so a break can never be hidden.
 */
export function joinedGlyph(
  a: GlyphSpec | null,
  b: GlyphSpec | null,
  ia: number,
  ib: number,
  columns: number,
  settings: TraceSettings,
): boolean {
  if (!a || !b || a.glyph === " " || b.glyph === " ") return false;
  const pa = cellCoord(ia, columns),
    pb = cellCoord(ib, columns);
  const dx = pb.x - pa.x,
    dy = pb.y - pa.y;
  if (dx === 0 && dy === 0) return true;
  if (dx !== 0 && dy !== 0) {
    if (!settings.allowDiag) return false;
    const want = dx * dy > 0 ? "\\" : "/";
    return a.diag === want && b.diag === want;
  }
  const aMask = sideMask(a),
    bMask = sideMask(b);
  if (dx > 0) return (aMask & E) !== 0 && (bMask & W) !== 0;
  if (dx < 0) return (aMask & W) !== 0 && (bMask & E) !== 0;
  if (dy > 0) return (aMask & S) !== 0 && (bMask & N) !== 0;
  return (aMask & N) !== 0 && (bMask & S) !== 0;
}
interface AutoGroup {
  cells: number[];
  masks: number[];
  diagonals: string[];
}
/**
 * Automatic contour extraction.
 *
 * The raw Sobel mask is thinned to a one-cell-wide skeleton, then converted to
 * a set of required arms per cell (the same vocabulary the guides use). This
 * is what makes contour connectivity measurable instead of decorative: a
 * follow-up glyph choice must actually join the skeleton, and any failure is
 * reported as a break on that cell.
 */
function autoSegments(
  field: Field,
  settings: TraceSettings,
  rejected: TracePoint[][],
  columns: number,
  rows: number,
  crop: Crop,
): AutoSegment[] {
  const tolerance = 0.6 * Math.min(crop.width / columns, crop.height / rows);
  const isRejected = (centre: TracePoint) =>
    rejected.some((seg) => seg.some((p) => distance(p, centre) <= tolerance));
  const candidates: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x;
      if (field.magnitude[i]! < settings.autoThreshold) continue;
      const centre = cellCentre(x, y, columns, rows, crop);
      if (isRejected(centre)) continue;
      candidates.push(i);
    }
  }
  /**
   * Cells that only reach the rest of the skeleton diagonally are bridged
   * through a neighbour cell, chosen from the candidates (not from the thin
   * skeleton) so the bridge has real image support. The bridge becomes a
   * normal contour cell with its own orthogonal arms: the drawn characters are
   * then 4-connected, and no corner contact is ever counted as a join.
   */
  const skeleton = thinSkeleton(
    new Set(candidates),
    field.magnitude,
    field.direction,
    columns,
    rows,
  );
  const candidateSet = new Set(candidates);
  bridgeThroughCandidates(skeleton, candidateSet, field.magnitude, columns, rows);
  const inSet = skeleton;
  const seen = new Set<number>();
  const groups: AutoGroup[] = [];
  for (const start of candidates) {
    if (!inSet.has(start) || seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    const cells: number[] = [];
    while (queue.length) {
      const cur = queue.pop()!;
      cells.push(cur);
      const { x, y } = cellCoord(cur, columns);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const n = ny * columns + nx;
        if (!seen.has(n) && inSet.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    cells.sort((a, b) => a - b);
    const set = new Set(cells);
    const masks: number[] = [];
    const diagonals: string[] = [];
    for (const cell of cells) {
      let mask = 0;
      let diag = "";
      const { x, y } = cellCoord(cell, columns);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        if (!set.has(ny * columns + nx)) continue;
        if (dx === 0) mask |= dy < 0 ? N : S;
        else if (dy === 0) mask |= dx > 0 ? E : W;
        else diag = dx * dy > 0 ? "\\" : "/";
      }
      // A one-pixel-thick skeleton often only exposes corner neighbours on a
      // diagonal. Keep the diagonal as the requested stroke; the strict join
      // test will still report it until diagonals are accepted.
      masks.push(mask);
      diagonals.push(diag);
    }
    groups.push({ cells, masks, diagonals });
  }
  // thicker, more prominent contours come first
  groups.sort((a, b) => b.cells.length - a.cells.length || a.cells[0]! - b.cells[0]!);
  return groups.map((group, i) => {
    let strength = 0;
    for (const c of group.cells) strength = Math.max(strength, field.magnitude[c]!);
    return {
      id: `A${i + 1}`,
      cells: group.cells,
      masks: group.masks,
      diagonals: group.diagonals,
      signatures: group.cells.map((c) => {
        const { x, y } = cellCoord(c, columns);
        return cellCentre(x, y, columns, rows, crop);
      }),
      strength,
    };
  });
}
/**
 * One-cell-wide contour: keep only the ridge maximum along the gradient
 * direction. Ties are broken by cell index so a plateau never produces two
 * parallel lines. This is a true non-maximum suppression, not a greedy
 * carve-away, so blobs become thin curves instead of spanning trees.
 */
function thinSkeleton(
  candidateSet: Set<number>,
  magnitude: Float32Array,
  direction: Int8Array,
  columns: number,
  rows: number,
): Set<number> {
  const keep = new Set<number>();
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= columns || y >= rows ? -1 : y * columns + x;
  for (const cell of candidateSet) {
    const x = cell % columns,
      y = Math.floor(cell / columns);
    // direction[] stores the stroke; the gradient is perpendicular to it
    const gradient = (((direction[cell]! + 2) % 8) + 8) % 8;
    const angle = (gradient / 8) * Math.PI * 2;
    const dx = Math.round(Math.cos(angle));
    const dy = -Math.round(Math.sin(angle));
    const forward = at(x + dx, y + dy);
    const backward = at(x - dx, y - dy);
    const m = magnitude[cell]!;
    const mf = forward >= 0 && candidateSet.has(forward) ? magnitude[forward]! : -1;
    const mb = backward >= 0 && candidateSet.has(backward) ? magnitude[backward]! : -1;
    if (m < mf || m < mb) continue;
    // equal ridge values: only the lower index survives, avoiding doubles
    if (m === mf && forward < cell) continue;
    if (m === mb && backward < cell) continue;
    keep.add(cell);
  }
  // A skeleton produced by NMS is 8-connected; bridging makes it 4-connected.
  bridgeDiagonals(keep, magnitude, columns, rows);
  return keep;
}
/**
 * Make the contour 4-connected by promoting a real neighbour cell whenever two
 * skeleton cells only touch at a corner. Promotion only uses cells that
 * actually carry edge energy, so the bridge is part of the picture rather than
 * an invented character.
 */
function bridgeThroughCandidates(
  skeleton: Set<number>,
  candidates: Set<number>,
  magnitude: Float32Array,
  columns: number,
  rows: number,
) {
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= columns || y >= rows ? -1 : y * columns + x;
  const added: number[] = [];
  for (const cell of skeleton) {
    const x = cell % columns,
      y = Math.floor(cell / columns);
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
    ] as const) {
      const nx = x + dx,
        ny = y + dy;
      const diagonal = at(nx, ny);
      if (diagonal < 0 || !skeleton.has(diagonal)) continue;
      const a = at(nx, y);
      const b = at(x, ny);
      if (skeleton.has(a) && skeleton.has(b)) continue;
      const options = [a, b].filter(
        (c) => c >= 0 && !skeleton.has(c) && candidates.has(c),
      );
      if (!options.length) continue;
      options.sort((u, v) => magnitude[v]! - magnitude[u]! || u - v);
      added.push(options[0]!);
    }
  }
  for (const cell of added) skeleton.add(cell);
}
function keepNeighbours(cell: number, keep: Set<number>, columns: number) {
  const x = cell % columns,
    y = Math.floor(cell / columns);
  let count = 0;
  for (const [dx, dy] of DIRS) {
    if (keep.has((y + dy) * columns + (x + dx))) count++;
  }
  return count;
}
/**
 * Replace every diagonal adjacency in the skeleton by a pair of orthogonal
 * steps through the stronger of the two possible bridge cells. The bridge is
 * added to the contour, so the drawn characters are 4-connected by
 * construction and the connectivity diagnostic has nothing to fake.
 */
function bridgeDiagonals(
  skeleton: Set<number>,
  magnitude: Float32Array,
  columns: number,
  rows: number,
) {
  const bridges: number[] = [];
  for (const cell of skeleton) {
    const x = cell % columns,
      y = Math.floor(cell / columns);
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
    ] as const) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      const diagonal = ny * columns + nx;
      if (!skeleton.has(diagonal)) continue;
      const a = y * columns + nx; // horizontal neighbour of the first cell
      const b = ny * columns + x; // vertical neighbour of the first cell
      if (skeleton.has(a) && skeleton.has(b)) continue;
      const pick = skeleton.has(a)
        ? a
        : skeleton.has(b)
          ? b
          : magnitude[a]! >= magnitude[b]!
            ? a
            : b;
      bridges.push(pick);
    }
  }
  for (const cell of bridges) skeleton.add(cell);
}
/** Required arms of an automatic contour cell. */
function autoMaskOf(seg: AutoSegment, cell: number) {
  const index = seg.cells.indexOf(cell);
  return index >= 0 ? seg.masks[index]! : 0;
}
/**
 * Automatic contour glyph choice. It follows the skeleton arms first and only
 * falls back to a tone glyph when the cell has no arms at all, so a drawn edge
 * is never replaced by a decorative character.
 */
function chooseAutoGlyph(
  seg: AutoSegment,
  cell: number,
  specs: GlyphSpec[],
): GlyphSpec | null {
  const index = seg.cells.indexOf(cell);
  if (index < 0) return null;
  const mask = seg.masks[index]!;
  const diag = seg.diagonals[index] ?? "";
  if (mask === 0 && !diag) return null;
  if (mask === 0 && diag) {
    const glyph = diag === "/" ? "╱" : "╲";
    return (
      specs.find((g) => g.glyph === glyph) ??
      specs.find((g) => g.glyph === (diag === "/" ? "/" : "\\")) ??
      null
    );
  }
  let best: GlyphSpec | null = null;
  let bestScore = Infinity;
  for (const s of specs) {
    if (s.density <= 0) continue;
    let missing = mask & ~sideMask(s);
    // only a cell with no orthogonal arms may fall back to a diagonal stroke
    if (mask === 0 && s.diag && diag) missing = 0;
    if (mask === 0 && !s.diag) missing = 15;
    if (s.diag && mask !== 0) missing = mask;
    const extra = popcount(sideMask(s) & ~mask);
    const score = popcount(missing) * 100 + extra * 2 + s.density * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
/* ── policy comparison ────────────────────────────────────────────────── */
export function comparePolicies(input: SolveInput): PolicyComparison {
  const structure = solve({
    ...input,
    trace: {
      ...input.trace,
      settings: { ...input.trace.settings, policy: "structure" },
    },
  });
  const tonal = solve({
    ...input,
    trace: {
      ...input.trace,
      settings: { ...input.trace.settings, policy: "tonal" },
    },
  });
  const differing: number[] = [];
  for (let i = 0; i < structure.chars.length; i++)
    if (structure.chars[i] !== tonal.chars[i]) differing.push(i);
  const arm = (outcome: SolveOutcome, policy: "structure" | "tonal"): PolicyArm => ({
    policy,
    chars: outcome.chars,
    connectivity: outcome.diagnostics.connectivity,
    autoConnectivity: outcome.diagnostics.autoConnectivity,
    breaks: outcome.diagnostics.breaks,
    cornerBreaks: outcome.diagnostics.cornerBreaks,
    autoBreaks: outcome.diagnostics.autoBreaks,
    brightnessError: outcome.diagnostics.brightnessError,
    glyphCount: outcome.diagnostics.glyphCount,
    budget: outcome.diagnostics.budget,
    breakCells: outcome.issues
      .filter((i) => i.code === "break" || i.code === "corner" || i.code === "auto")
      .map((i) => i.cell)
      .filter((c): c is number => c !== null),
    toneError: outcome.toneError,
    differing,
  });
  return {
    columns: input.columns,
    rows: input.rows,
    budget: structure.diagnostics.budget,
    structure: arm(structure, "structure"),
    tonal: arm(tonal, "tonal"),
  };
}
