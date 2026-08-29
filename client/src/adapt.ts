// Adapters mapping the backend's two-sided contract onto the frontend view-model.
import type {
  Chunk as RawChunk,
  Link as RawLink,
  RunResult as RawRunResult,
  SwarmRun,
  AgentState,
  Side,
} from '@shared/types.ts';
import type { Chunk, Link, Agent, Tick, RunResult } from './types.ts';

export function adaptChunks(raw: RawChunk[]): Chunk[] {
  return raw.map((c) => ({
    id: c.id,
    doc: c.doc,
    text: (c.sentences ?? []).join(' '),
    score: c.score ?? {},
    against: c.against ?? 0,
  }));
}

export function adaptLinks(raw: RawLink[]): Link[] {
  return raw.map((l) => ({ from: l.from, to: l.to, strength: l.strength }));
}

export function adaptRunSide(raw: RawRunResult, side: Side): RunResult {
  const run: SwarmRun = raw[side];
  const visitedByAgent = new Map<string, string[]>();

  const ticks: Tick[] = run.ticks.map((t) => {
    const agents: Agent[] = t.agents.map((a: AgentState) => {
      const prev = visitedByAgent.get(a.id) ?? [];
      const visited = prev.includes(a.chunkId) ? prev : [...prev, a.chunkId];
      visitedByAgent.set(a.id, visited);
      return { id: a.id, angle: a.angle, at: a.chunkId, visited };
    });
    return { tick: t.tick, links: adaptLinks(t.links), agents };
  });

  return {
    angles: run.angles.map((a) => a.name),
    ticks,
    path: run.path,
    sources: run.sources,
    contradictions: [],
  };
}
