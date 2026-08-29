import fs from 'node:fs';
import path from 'node:path';
import type { Chunk } from '../../src/shared/types';

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

function groupSentences(sentences: string[]): string[][] {
  const groups: string[][] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    groups.push(sentences.slice(i, i + 3));
  }
  // a trailing lone sentence would make a 1-sentence chunk; fold it into the
  // previous chunk instead (allowed, since chunks may hold up to 4 sentences)
  if (groups.length >= 2 && groups[groups.length - 1].length === 1) {
    groups[groups.length - 2].push(...groups.pop()!);
  }
  return groups;
}

export function loadChunks(caseDir: string): Chunk[] {
  const files = fs
    .readdirSync(caseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
    .map((entry) => entry.name)
    .sort();

  const chunks: Chunk[] = [];
  let nextId = 1;
  for (const file of files) {
    const text = fs.readFileSync(path.join(caseDir, file), 'utf8');
    const sentences = text
      .split(SENTENCE_SPLIT)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const group of groupSentences(sentences)) {
      chunks.push({
        id: `c${nextId++}`,
        doc: file,
        sentences: group,
        score: {},
        against: 0,
      });
    }
  }
  return chunks;
}
