import { createHash } from 'node:crypto';
import type { AgentState, Boost, Chunk, Find, Link, Tick } from '../../src/shared/types';

const DEFAULT_AGENTS = 5;
const DEFAULT_TICKS = 8;
const SCORE_WEIGHT = 0.6;
const LINK_WEIGHT = 0.3;
const RAND_WEIGHT = 0.1;
const DEPOSIT_THRESHOLD = 0.5;
const DEPOSIT_FACTOR = 0.3;
const DECAY = 0.85;
const MIN_STRENGTH = 0.01;
const MAX_STRENGTH = 1;

function numericId(id: string): number {
  return parseInt(id.replace(/\D/g, ''), 10);
}

// Deterministic rand in [0, 1]: first 8 hex chars of sha256, divided by 0xffffffff.
function seededRand(seed: string, tick: number, agentId: string, candidateId: string): number {
  const digest = createHash('sha256')
    .update(`${seed}|${tick}|${agentId}|${candidateId}`)
    .digest('hex');
  return parseInt(digest.slice(0, 8), 16) / 0xffffffff;
}

function clampStrength(strength: number): number {
  return Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, strength));
}

interface AgentInternal {
  id: string;
  angle: string;
  chunkId: string;
  visited: Set<string>;
}

interface Decision {
  agent: AgentInternal;
  nextChunkId: string;
  link: Link | null;
}

export class Swarm {
  private readonly chunks: Chunk[];
  private readonly chunkById: Map<string, Chunk>;
  private readonly angles: string[];
  private readonly seed: string;
  private readonly simLinks: Link[];
  private readonly agentsInternal: AgentInternal[];
  private tick = 0;

  constructor(
    chunks: Chunk[],
    links: Link[],
    angles: string[],
    seed: string,
    opts?: { agents?: number },
  ) {
    const agentCount = opts?.agents ?? DEFAULT_AGENTS;
    this.chunks = chunks;
    this.angles = angles;
    this.seed = seed;
    // Work on a deep copy so the caller's links are never mutated.
    this.simLinks = links.map((link) => ({ ...link }));
    this.chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    // Neutral start: lowest total score across the given angles, tie-break lowest numeric id.
    let startChunkId = '';
    if (chunks.length > 0) {
      let bestId = chunks[0].id;
      let bestTotal = Infinity;
      for (const chunk of chunks) {
        const total = angles.reduce((sum, angle) => sum + (chunk.score[angle] ?? 0), 0);
        if (
          total < bestTotal ||
          (total === bestTotal && numericId(chunk.id) < numericId(bestId))
        ) {
          bestTotal = total;
          bestId = chunk.id;
        }
      }
      startChunkId = bestId;
    }

    this.agentsInternal = [];
    for (let i = 0; i < agentCount; i++) {
      const angle = angles.length > 0 ? angles[i % angles.length] : '';
      this.agentsInternal.push({
        id: `a${i + 1}`,
        angle,
        chunkId: startChunkId,
        visited: new Set(startChunkId ? [startChunkId] : []),
      });
    }
  }

  // Runs one tick. Boosts are applied to the link graph BEFORE agents move;
  // the returned Tick records them in boostsApplied.
  step(boosts: Boost[] = []): Tick {
    this.tick++;
    const tick = this.tick;

    for (const boost of boosts) {
      for (const link of this.simLinks) {
        if (link.from === boost.chunkId || link.to === boost.chunkId) {
          link.strength = clampStrength(link.strength + boost.amount);
        }
      }
    }

    // Phase 1 — collect every agent's move from the tick-start state.
    const decisions: Decision[] = [];
    for (const agent of this.agentsInternal) {
      const current = agent.chunkId;

      const candidates: Array<{ candidateId: string; link: Link }> = [];
      const seen = new Set<string>();
      for (const link of this.simLinks) {
        let candidateId: string | null = null;
        if (link.from === current) candidateId = link.to;
        else if (link.to === current) candidateId = link.from;
        if (candidateId && !seen.has(candidateId)) {
          seen.add(candidateId);
          candidates.push({ candidateId, link });
        }
      }

      let nextChunkId = current;
      let usedLink: Link | null = null;

      if (candidates.length > 0) {
        // Deterministic order makes exact-choice ties reproducible.
        candidates.sort((a, b) => numericId(a.candidateId) - numericId(b.candidateId));
        let bestChoice = -Infinity;
        for (const { candidateId, link } of candidates) {
          const candidateChunk = this.chunkById.get(candidateId);
          const scoreTerm = candidateChunk?.score[agent.angle] ?? 0;
          const linkStrength = agent.visited.has(candidateId) ? 0 : link.strength;
          const choice =
            SCORE_WEIGHT * scoreTerm +
            LINK_WEIGHT * linkStrength +
            RAND_WEIGHT * seededRand(this.seed, tick, agent.id, candidateId);
          if (choice > bestChoice) {
            bestChoice = choice;
            nextChunkId = candidateId;
            usedLink = link;
          }
        }
      } else {
        // Isolated chunk: jump to the unvisited chunk with the highest seeded rand.
        let bestRand = -Infinity;
        const sortedChunks = [...this.chunks].sort((a, b) => numericId(a.id) - numericId(b.id));
        for (const chunk of sortedChunks) {
          if (agent.visited.has(chunk.id)) continue;
          const value = seededRand(this.seed, tick, agent.id, chunk.id);
          if (value > bestRand) {
            bestRand = value;
            nextChunkId = chunk.id;
          }
        }
      }

      decisions.push({ agent, nextChunkId, link: usedLink });
    }

    // Phase 2 — apply moves and deposits, in agentId order. Every deposit-worthy
    // landing is also recorded as a Find for frontend replay.
    decisions.sort((a, b) => numericId(a.agent.id) - numericId(b.agent.id));
    const finds: Find[] = [];
    for (const { agent, nextChunkId, link } of decisions) {
      agent.chunkId = nextChunkId;
      agent.visited.add(nextChunkId);
      if (link) {
        const destination = this.chunkById.get(nextChunkId);
        const score = destination?.score[agent.angle] ?? 0;
        if (score >= DEPOSIT_THRESHOLD) {
          link.strength += score * DEPOSIT_FACTOR;
          if (destination) {
            const text = destination.sentences.join(' ');
            const excerpt = text.slice(0, 80);
            finds.push({
              agentId: agent.id,
              chunkId: nextChunkId,
              doc: destination.doc,
              angle: agent.angle,
              score,
              linkFrom: link.from,
              linkTo: link.to,
              note: `${agent.id} (${agent.angle}) found ${destination.doc}: "${excerpt}${text.length > 80 ? '...' : ''}"`,
            });
          }
        }
      }
    }

    const findDocs: string[] = [];
    for (const find of finds) {
      if (!findDocs.includes(find.doc)) findDocs.push(find.doc);
    }
    const summary =
      finds.length === 0
        ? `Round ${tick}: agents exploring, no strong evidence yet.`
        : `Round ${tick}: ${finds.length} find(s) in ${findDocs.join(', ')}.`;

    // Phase 3 — decay every link and clamp.
    for (const link of this.simLinks) {
      link.strength = clampStrength(link.strength * DECAY);
    }

    return {
      tick,
      links: this.simLinks.map((link) => ({ ...link })),
      agents: this.agentsInternal.map((agent): AgentState => ({
        id: agent.id,
        chunkId: agent.chunkId,
        angle: agent.angle,
      })),
      boostsApplied: boosts.map((boost) => ({ ...boost })),
      finds,
      summary,
    };
  }

  get links(): Link[] {
    return this.simLinks.map((link) => ({ ...link }));
  }

  get agents(): AgentState[] {
    return this.agentsInternal.map((agent) => ({
      id: agent.id,
      chunkId: agent.chunkId,
      angle: agent.angle,
    }));
  }
}

// Thin wrapper preserving the old one-shot API: N steps with no boosts.
export function runSwarm(
  chunks: Chunk[],
  links: Link[],
  angles: string[],
  seed: string,
  opts?: { agents?: number; ticks?: number },
): Tick[] {
  const swarm = new Swarm(chunks, links, angles, seed, opts);
  const tickCount = opts?.ticks ?? DEFAULT_TICKS;
  const history: Tick[] = [];
  for (let i = 0; i < tickCount; i++) {
    history.push(swarm.step());
  }
  return history;
}
