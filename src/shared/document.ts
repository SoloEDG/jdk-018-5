export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Asset {
  name: string;
  url: string;
  width: number;
  height: number;
  image: HTMLImageElement;
}
export interface Settings {
  columns: number;
  charset: string;
  custom: string;
  contrast: number;
  gamma: number;
  invert: boolean;
  color: boolean;
  background: string;
}
export interface Cell {
  glyph: string;
  color: string;
}
/** A point in normalized coordinates of the ORIGINAL image (0..1). */
export interface TracePoint {
  x: number;
  y: number;
}
export interface TraceGuide {
  id: string;
  label: string;
  points: TracePoint[];
  /** required guides are hard constraints; optional guides are soft hints */
  required: boolean;
}
export interface TraceJunction {
  id: string;
  label: string;
  point: TracePoint;
}
export type TracePolicy = "structure" | "tonal";
export type TraceGlyphSet = "box" | "ascii";
export interface TraceSettings {
  enabled: boolean;
  policy: TracePolicy;
  glyphSet: TraceGlyphSet;
  /** maximum number of non-space glyphs, as a percentage of all cells */
  budgetPercent: number;
  /** relative Sobel magnitude needed for an automatic contour cell */
  autoThreshold: number;
  /**
   * Line-art polarity. When true a dark pixel is inked and bright areas stay
   * empty, so a white page with black line work reads as a drawing instead of
   * a reversed halftone.
   */
  ink: boolean;
  showAuto: boolean;
  showGuides: boolean;
  snap: boolean;
  /** relaxation: treat a stroke that only touches a cell corner as joined */
  allowDiag: boolean;
  /** relaxation: let two lines share one cell (needs a cross glyph) */
  allowCross: boolean;
  /** weld new guide endpoints to nearby guide ends and junctions */
  weld: boolean;
}
export interface TraceState {
  guides: TraceGuide[];
  junctions: TraceJunction[];
  /** automatic edges the user rejected, each stored as normalized cell centres */
  rejected: TracePoint[][];
  settings: TraceSettings;
  selectedCell: number | null;
  selectedGuide: string | null;
  focusConstraint: string | null;
  nextId: number;
  tool: "guide" | "junction";
}
export type IssueCode =
  | "corner"
  | "crossing"
  | "density"
  | "charset"
  | "budget"
  | "break"
  | "orphan"
  | "auto";
export type ConstraintKind = "guide" | "junction" | "auto" | "policy";
/**
 * Machine readable relaxation handles. The UI shows them as buttons; applying
 * one changes the settings the solver reads, so an issue can only disappear
 * when the solver genuinely satisfies the constraint under the new rules.
 */
export type RelaxCode = "crossing" | "diagonals" | "budget" | "density";
export interface IssueOption {
  code: RelaxCode;
  label: string;
  /** what the solver will actually do when this is enabled */
  effect: string;
}
export interface TraceIssue {
  code: IssueCode;
  /** stable constraint id, e.g. G1 / J2 / A3 / POLICY */
  id: string;
  /** stable key: code + constraint id + cell */
  key: string;
  kind: ConstraintKind;
  /** grid clamp the diagnostic was produced under, if any */
  clamp?: string;
  label: string;
  /** human readable explanation of why the constraint fails */
  detail: string;
  cell: number | null;
  /** which relaxation options the solver exposes for this constraint */
  options: IssueOption[];
}
export interface TraceProvenance {
  /** guide id, junction id, "AUTO" or "TONE" */
  source: string;
  /** short human readable reason, shown in the character inspector */
  reason: string;
}
export interface AutoSegment {
  id: string;
  cells: number[];
  /** required orthogonal arms per cell, same order as `cells` */
  masks: number[];
  /** required diagonal stroke per cell ("/", "\\" or "") */
  diagonals: string[];
  /** normalized cell centres, used to seed the rejection tolerance */
  signatures: TracePoint[];
  strength: number;
}
export interface TraceDiagnostics {
  /** guide steps whose two glyphs do not share a border */
  breaks: number;
  /** of the above, steps that only meet at a cell corner */
  cornerBreaks: number;
  /** steps inside automatic contours that are not joined */
  autoBreaks: number;
  /** mean |glyph density - target luminance| over all cells */
  brightnessError: number;
  /** percentage of guide steps that are genuinely joined */
  connectivity: number;
  /** percentage of automatic contour steps that are genuinely joined */
  autoConnectivity: number;
  glyphCount: number;
  budget: number;
  overBudget: boolean;
  intentCount: number;
  junctionCount: number;
  solved: boolean;
}
export interface TraceResult {
  columns: number;
  rows: number;
  /** one character per cell, always columns * rows long */
  chars: string[];
  /** glyph density 0..1 per cell, used to compare glyphs at equal budget */
  densities: number[];
  /** why each cell received its glyph, for the constraint inspector */
  provenance: TraceProvenance[];
  issues: TraceIssue[];
  diagnostics: TraceDiagnostics;
  autoSegments: AutoSegment[];
  /** guide ids mapped onto the current grid, for the text panel */
  guideCells: { guide: string; cells: number[] }[];
  junctionCells: { junction: string; cell: number }[];
  /** stable content hash of `chars`; export refuses to run on a mismatch */
  hash: string;
  revision: number;
}
export interface PolicyArm {
  policy: TracePolicy;
  chars: string[];
  connectivity: number;
  autoConnectivity: number;
  breaks: number;
  cornerBreaks: number;
  autoBreaks: number;
  brightnessError: number;
  glyphCount: number;
  budget: number;
  /** cells participating in a guide / auto break */
  breakCells: number[];
  /** |glyph density - target luminance| per cell, for the deviation map */
  toneError: Float32Array;
  /** cells whose glyph differs from the other arm */
  differing: number[];
}
export interface PolicyComparison {
  columns: number;
  rows: number;
  budget: number;
  structure: PolicyArm;
  tonal: PolicyArm;
}
export interface Grid {
  columns: number;
  rows: number;
  cells: Cell[];
  revision: number;
  /** present whenever the tracing layer is enabled */
  trace: TraceResult | null;
}
export interface StudioDocument {
  asset: Asset | null;
  crop: Crop;
  settings: Settings;
  trace: TraceState;
  grid: Grid | null;
  revision: number;
}
