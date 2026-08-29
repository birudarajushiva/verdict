import type { Chunk, Link, RunResult } from '@shared/types.ts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function fetchGraph(): Promise<{ chunks: Chunk[]; links: Link[] }> {
  const res = await fetch(`${API_URL}/graph`);
  if (!res.ok) throw new Error(`graph failed: ${res.status}`);
  return res.json();
}

export async function runSwarm(argument: string, seed = 'demo'): Promise<RunResult> {
  const res = await fetch(`${API_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ argument, seed }),
  });
  if (!res.ok) throw new Error(`run failed: ${res.status}`);
  return res.json();
}

export async function ask(question: string, path: string[]): Promise<{ answer: string }> {
  const res = await fetch(`${API_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, path }),
  });
  if (!res.ok) throw new Error(`ask failed: ${res.status}`);
  return res.json();
}
