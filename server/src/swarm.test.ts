import { runSwarm } from './swarm';
import type { Chunk, Link } from '../../src/shared/types';

function mkChunk(id: string): Chunk {
  return {
    id,
    doc: `${id}.txt`,
    sentences: [`Evidence sentence for ${id}.`],
    score: { kw: 0.6 },
    against: 0,
  };
}

const chunks: Chunk[] = ['c1', 'c2', 'c3', 'c4'].map(mkChunk);
const links: Link[] = [
  { from: 'c1', to: 'c2', strength: 0.05 },
  { from: 'c2', to: 'c3', strength: 0.05 },
  { from: 'c3', to: 'c4', strength: 0.05 },
  { from: 'c1', to: 'c4', strength: 0.05 },
  { from: 'c2', to: 'c4', strength: 0.05 },
];
const angles = ['kw'];

const linksBefore = JSON.stringify(links);

const runA = runSwarm(chunks, links, angles, 'seed-alpha');
const runB = runSwarm(chunks, links, angles, 'seed-alpha');
const runC = runSwarm(chunks, links, angles, 'seed-beta');

const serializedA = JSON.stringify(runA);
const serializedB = JSON.stringify(runB);
const serializedC = JSON.stringify(runC);

if (serializedA !== serializedB) {
  throw new Error('same seed produced different outputs');
}
if (serializedA === serializedC) {
  throw new Error('different seeds produced identical outputs');
}
if (JSON.stringify(links) !== linksBefore) {
  throw new Error("caller's links array was mutated");
}

console.log(`test:swarm passed (${runA.length} ticks; same seed identical, different seed diverged, input untouched)`);
