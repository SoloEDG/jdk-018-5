/**
 * Structural glyph tables.
 *
 * Every glyph carries:
 *  - density: approximate ink coverage of the cell (used for tone matching)
 *  - sides:   which cell borders the stroke reaches, encoded as N,E,S,W bits.
 *  - diag:    diagonal strokes, which only touch cell corners.
 *
 * Two cells count as "joined" only when the shared border is covered by both
 * glyphs (or the user explicitly accepts corner contact). This is what keeps
 * the connectivity diagnostic honest: a glyph pair that merely looks close in
 * a font is never reported as connected.
 */
export interface GlyphSpec {
  glyph: string;
  density: number;
  sides: string;
  diag: "/" | "\\" | "";
}
const N = 1,
  E = 2,
  S = 4,
  W = 8;
function spec(
  glyph: string,
  density: number,
  sides = "",
  diag: "/" | "\\" | "" = "",
): GlyphSpec {
  let mask = 0;
  if (sides.includes("N")) mask |= N;
  if (sides.includes("E")) mask |= E;
  if (sides.includes("S")) mask |= S;
  if (sides.includes("W")) mask |= W;
  return { glyph, density, sides: String.fromCharCode(64 + mask), diag };
}
/** mask helpers – the solver and the UI share one definition */
export function sideMask(spec: GlyphSpec): number {
  return spec.sides.charCodeAt(0) - 64;
}
export function sideName(mask: number): string {
  return (["N", "E", "S", "W"] as const)
    .filter((_, i) => mask & (1 << i))
    .join("");
}
/** Box drawing family – one column wide in monospace fonts. */
export const boxCharset: GlyphSpec[] = [
  spec(" ", 0),
  spec("╴", 0.1, "W"),
  spec("╶", 0.1, "E"),
  spec("╵", 0.1, "N"),
  spec("╷", 0.1, "S"),
  spec("─", 0.14, "EW"),
  spec("│", 0.14, "NS"),
  spec("╰", 0.22, "NE"),
  spec("╭", 0.22, "SE"),
  spec("╯", 0.22, "NW"),
  spec("╮", 0.22, "SW"),
  spec("├", 0.24, "NES"),
  spec("┤", 0.24, "NSW"),
  spec("┬", 0.24, "ESW"),
  spec("┴", 0.24, "NEW"),
  spec("┼", 0.26, "NESW"),
  spec("╱", 0.18, "", "/"),
  spec("╲", 0.18, "", "\\"),
];
/** ASCII family – the original studio look, used by the tone policy. */
export const asciiCharset: GlyphSpec[] = [
  spec(" ", 0),
  spec(".", 0.08),
  spec(":", 0.12),
  spec("-", 0.14, "EW"),
  spec("=", 0.18, "EW"),
  spec("+", 0.2, "NESW"),
  spec("*", 0.26),
  spec("|", 0.14, "NS"),
  spec("/", 0.16, "", "/"),
  spec("\\", 0.16, "", "\\"),
  spec("#", 0.42),
  spec("%", 0.46),
  spec("@", 0.56),
];
export function charsetFor(kind: "box" | "ascii"): GlyphSpec[] {
  return kind === "box" ? boxCharset : asciiCharset;
}
/** Glyph density ramp, ascending, background excluded. */
export function ramp(specs: GlyphSpec[]): GlyphSpec[] {
  return specs
    .filter((s) => s.density > 0)
    .sort((a, b) => a.density - b.density || a.glyph.localeCompare(b.glyph));
}
/**
 * Shading ramp. Texture glyphs carry no border arms, so they can never be
 * mistaken for a connected edge; they only express local grey level. Keeping
 * the two vocabularies apart is what lets the structure policy reserve line
 * glyphs for real contours instead of hatching the whole picture with them.
 */
export const textureCharset: GlyphSpec[] = [
  spec(" ", 0),
  spec(".", 0.06),
  spec(":", 0.1),
  spec("=", 0.16),
  spec("*", 0.24),
  spec("#", 0.36),
  spec("%", 0.46),
  spec("@", 0.58),
];
export function textureFor(kind: "box" | "ascii"): GlyphSpec[] {
  return kind === "ascii" ? asciiCharset : textureCharset;
}
