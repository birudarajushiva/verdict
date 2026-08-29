import fs from 'node:fs';
import path from 'node:path';
import { loadChunks } from '../chunker';

const caseDir = path.join(import.meta.dirname, '..', '..', '..', 'case');

if (!fs.existsSync(caseDir)) {
  throw new Error(`Case directory not found: ${caseDir}`);
}

const chunks = loadChunks(caseDir);

const counts = new Map<string, number>();
for (const chunk of chunks) {
  counts.set(chunk.doc, (counts.get(chunk.doc) ?? 0) + 1);
}

for (const [doc, n] of counts) {
  console.log(`${doc}: ${n} chunks`);
}
console.log(`total: ${chunks.length} chunks`);
