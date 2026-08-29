import type {
  Chunk as RawChunk,
  Link as RawLink,
  RunResult as RawRunResult,
} from '@shared/types.ts';
import type { Chunk, Link } from './types.ts';
import { adaptChunks, adaptLinks } from './adapt.ts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function fetchGraph(): Promise<{ chunks: Chunk[]; links: Link[] }> {
  const res = await fetch(`${API_URL}/graph`);
  if (!res.ok) throw new Error(`graph failed: ${res.status}`);
  const data = (await res.json()) as { chunks: RawChunk[]; links: RawLink[] };
  return { chunks: adaptChunks(data.chunks), links: adaptLinks(data.links) };
}

export async function runSwarm(argument: string, seed = 'demo', timeoutMs = 20000): Promise<RawRunResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ argument, seed }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`run failed: ${res.status}`);
    return (await res.json()) as RawRunResult;
  } finally {
    clearTimeout(timer);
  }
}

export async function ask(
  question: string,
  supportPath: string[],
  refutePath: string[],
  argument: string,
): Promise<{ answer: string }> {
  const res = await fetch(`${API_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, supportPath, refutePath, argument }),
  });
  if (!res.ok) throw new Error(`ask failed: ${res.status}`);
  return (await res.json()) as { answer: string };
}
