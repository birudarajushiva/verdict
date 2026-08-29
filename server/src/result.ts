import type { Chunk, Link } from '../../src/shared/types';

const MIN_STRENGTH = 0.2;
const MAX_PATH_CHUNKS = 8;

export function extractPath(
  chunks: Chunk[],
  finalLinks: Link[],
): { path: string[]; sources: string[] } {
  if (finalLinks.length === 0) {
    return { path: [], sources: [] };
  }

  // Seed with the strongest link; on ties the first one wins.
  let seedIndex = 0;
  for (let i = 1; i < finalLinks.length; i++) {
    if (finalLinks[i].strength > finalLinks[seedIndex].strength) seedIndex = i;
  }
  const seed = finalLinks[seedIndex];
  const path = [seed.from, seed.to];
  const onPath = new Set(path);
  const used = new Set<Link>([seed]);

  while (path.length < MAX_PATH_CHUNKS) {
    let best: { link: Link; next: string; side: 'left' | 'right' } | null = null;
    const ends: Array<[string, 'left' | 'right']> = [
      [path[0], 'left'],
      [path[path.length - 1], 'right'],
    ];
    for (const link of finalLinks) {
      if (used.has(link)) continue;
      for (const [end, side] of ends) {
        let next: string | null = null;
        if (link.from === end) next = link.to;
        else if (link.to === end) next = link.from;
        if (next === null || onPath.has(next)) continue;
        if (best === null || link.strength > best.link.strength) {
          best = { link, next, side };
        }
      }
    }
    if (best === null || best.link.strength < MIN_STRENGTH) break;
    used.add(best.link);
    onPath.add(best.next);
    if (best.side === 'left') path.unshift(best.next);
    else path.push(best.next);
  }

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const sources: string[] = [];
  for (const id of path) {
    const doc = chunkById.get(id)?.doc;
    if (doc !== undefined && !sources.includes(doc)) sources.push(doc);
  }

  return { path, sources };
}

export function findOverlap(supportPath: string[], refutePath: string[]): string[] {
  const refuteSet = new Set(refutePath);
  return supportPath.filter((id) => refuteSet.has(id));
}
