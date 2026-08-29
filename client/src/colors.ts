// Deterministic, futuristic document colors that work for ANY doc name
// (mock or live backend), so nodes/dots always have color.

const KNOWN: Record<string, string> = {
  'complaint.txt': '#00f0ff',
  'vendor_email.txt': '#a855f7',
  'inspection_report.txt': '#39ff14',
  'witness_stmt.txt': '#ff2a8c',
  'internal_memo.txt': '#ffd700',
};

const PALETTE = [
  '#00f0ff',
  '#a855f7',
  '#39ff14',
  '#ff2a8c',
  '#ffd700',
  '#4f8ff7',
  '#ff8c42',
  '#2dd4bf',
  '#e879f9',
  '#84cc16',
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function docColor(doc: string): string {
  return KNOWN[doc] ?? PALETTE[hash(doc) % PALETTE.length];
}

export function angleColor(angle: string): string {
  if (angle === 'timeline') return '#00f0ff';
  if (angle === 'knowledge') return '#a855f7';
  if (angle === 'incentives') return '#ff2a8c';
  return PALETTE[hash(angle) % PALETTE.length];
}
