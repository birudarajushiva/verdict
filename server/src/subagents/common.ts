import type { Chunk, SubAgentOutput, SubAgentTask } from '../../../src/shared/types';
import { chatJSON } from '../llm';

export const COMMON_RULES =
  'Respond with JSON only, no prose, no fences. Cite document names in brackets. ' +
  'Never invent facts that are not in the provided chunks. ' +
  'If something is not established by the chunks, say "not in evidence".';

export interface SubAgentContext {
  finds?: Chunk[];
  previousHeadlines?: string[];
  linkedChunks?: Chunk[];
  ourPath?: string[];
  otherPath?: string[];
  pathChunks?: Chunk[];
  doneOutputs?: { taskId: string; kind: string; side: string; headline: string; flags: { chunkId: string; issue: string }[] }[];
  lastStrategistFor?: SubAgentOutput | null;
  lastStrategistAgainst?: SubAgentOutput | null;
}

export function chunkText(chunk: Chunk): string {
  return chunk.sentences.join(' ');
}

export function formatChunk(chunk: Chunk): string {
  return `[${chunk.id} | ${chunk.doc}] ${chunkText(chunk)}`;
}

export function buildCacheKey(
  kind: string,
  side: string,
  tick: number,
  argument: string,
  inputChunks: string[],
): string {
  return `${kind}|${side}|${tick}|${argument}|${inputChunks.join(',')}`;
}

export function estimateCost(inputChars: number): number {
  return (inputChars / 4000) * 0.001;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function normalizeOutput(raw: any): SubAgentOutput {
  return {
    headline: typeof raw?.headline === 'string' ? raw.headline : '',
    details: Array.isArray(raw?.details) ? raw.details.map((d: any) => String(d)) : [],
    citations: Array.isArray(raw?.citations) ? raw.citations.map((c: any) => String(c)) : [],
    confidence: clamp01(typeof raw?.confidence === 'number' ? raw.confidence : 0),
    needsHuman: Boolean(raw?.needsHuman),
    flags: Array.isArray(raw?.flags)
      ? raw.flags
          .filter((f: any) => f && typeof f.chunkId === 'string')
          .map((f: any) => ({
            chunkId: f.chunkId,
            issue: typeof f.issue === 'string' ? f.issue : '',
          }))
      : [],
  };
}

export async function callSubAgentLLM(
  task: SubAgentTask,
  argument: string,
  system: string,
  user: string,
): Promise<SubAgentOutput> {
  const cacheKey = buildCacheKey(task.kind, task.side, task.tick, argument, task.inputChunks);
  const raw = await chatJSON(system, user, cacheKey);
  return normalizeOutput(raw);
}
