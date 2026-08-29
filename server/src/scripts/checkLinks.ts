import fs from 'node:fs';
import path from 'node:path';
import { loadChunks } from '../chunker';
import { buildLinks } from '../linker';

const caseDir = path.join(import.meta.dirname, '..', '..', '..', 'case');

if (!fs.existsSync(caseDir)) {
  throw new Error(`Case directory not found: ${caseDir}`);
}

const chunks = loadChunks(caseDir);
const links = buildLinks(chunks);

console.log(`total links: ${links.length}`);

const degree = new Map<string, number>();
for (const chunk of chunks) {
  degree.set(chunk.id, 0);
}
for (const link of links) {
  degree.set(link.from, (degree.get(link.from) ?? 0) + 1);
  degree.set(link.to, (degree.get(link.to) ?? 0) + 1);
}

const docById = new Map(chunks.map((chunk) => [chunk.id, chunk.doc]));
const numeric = (id: string) => parseInt(id.replace(/\D/g, ''), 10);
const top = [...degree.entries()]
  .sort((a, b) => b[1] - a[1] || numeric(a[0]) - numeric(b[0]))
  .slice(0, 5);

console.log('most connected:');
for (const [id, count] of top) {
  console.log(`  ${id} (${docById.get(id)}): ${count} links`);
}
