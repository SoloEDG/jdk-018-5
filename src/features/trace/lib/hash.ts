/**
 * Small, stable content hash (FNV-1a over UTF-16 code units). Used to prove
 * that what is exported is exactly what the diagnostics were computed from.
 */
export function hashChars(chars: string[], columns: number, rows: number): string {
  let h = 2166136261;
  const feed = (code: number) => {
    h ^= code & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (code >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
  };
  feed(columns);
  feed(rows);
  for (const ch of chars) {
    if (!ch) feed(0);
    else for (let i = 0; i < ch.length; i++) feed(ch.charCodeAt(i));
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
