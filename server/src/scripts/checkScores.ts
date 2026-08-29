import fs from 'node:fs';
import path from 'node:path';
import { loadChunks } from '../chunker';
import { makeAngles } from '../angles';
import { scoreChunks } from '../scorer';

const ARGUMENT =
  'Kestrel knew the controller firmware was defective before signing on March 3';

const caseDir = path.join(import.meta.dirname, '..', '..', '..', 'case');

if (!fs.existsSync(caseDir)) {
  throw new Error(`Case directory not found: ${caseDir}`);
}

const chunks = loadChunks(caseDir);
const angles = await makeAngles(ARGUMENT);
const scored = await scoreChunks(chunks, ARGUMENT, angles);

const docById = new Map(scored.map((chunk) => [chunk.id, chunk.doc]));
const numeric = (id: string) => parseInt(id.replace(/\D/g, ''), 10);

for (const angle of [...angles.support, ...angles.refute]) {
  const top = [...scored]
    .sort(
      (a, b) =>
        (b.score[angle.name] ?? 0) - (a.score[angle.name] ?? 0) ||
        numeric(a.id) - numeric(b.id),
    )
    .slice(0, 3);
  console.log(`${angle.name}:`);
  for (const chunk of top) {
    console.log(`  ${chunk.id} (${docById.get(chunk.id)}): ${(chunk.score[angle.name] ?? 0).toFixed(2)}`);
  }
}
