import type { Chunk } from '../../src/shared/types';
import { chatJSON } from './llm';

interface AngleInput {
  name: string;
  description: string;
}

const SYSTEM_PROMPT = `You are scoring evidence for a legal case. For each chunk return a 0–1 relevance score for EACH of the six search angles (three support, three refute), and an overall 'against' score 0–1 for how strongly the chunk contradicts the argument. Be strict: most chunks should score under 0.3 on most angles. Respond with JSON only, no prose, no fences: [{"id":"c1","score":{"angle_name":0.0,...},"against":0.0}].`;

function chunkText(chunk: Chunk): string {
  return chunk.sentences.join(' ');
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export async function scoreChunks(
  chunks: Chunk[],
  argument: string,
  angles: { support: AngleInput[]; refute: AngleInput[] },
): Promise<Chunk[]> {
  const cacheKey =
    'scores|' + argument + '|' + chunks.map((c) => c.id + chunkText(c).length).join(',');

  const angleLines = [...angles.support, ...angles.refute]
    .map((a) => `${a.name} — ${a.description}`)
    .join('\n');
  const chunkLines = chunks.map((c) => `[${c.id}] ${chunkText(c)}`).join('\n');
  const userPrompt = `Argument: ${argument}\n\nAngles:\n${angleLines}\n\nChunks:\n${chunkLines}`;

  const results = await chatJSON(SYSTEM_PROMPT, userPrompt, cacheKey);

  const byId = new Map<string, any>();
  if (Array.isArray(results)) {
    for (const item of results) {
      if (item && typeof item.id === 'string') byId.set(item.id, item);
    }
  }

  const angleNames = [
    ...angles.support.map((a) => a.name),
    ...angles.refute.map((a) => a.name),
  ];

  for (const chunk of chunks) {
    const entry = byId.get(chunk.id);
    const score: Record<string, number> = {};
    for (const name of angleNames) {
      const raw = entry?.score?.[name];
      score[name] = clamp01(isFiniteNumber(raw) ? raw : 0);
    }
    chunk.score = score;
    chunk.against = clamp01(isFiniteNumber(entry?.against) ? entry.against : 0);
  }

  return chunks;
}
