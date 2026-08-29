import type { Brief, Chunk, SubAgentTask } from '../../../src/shared/types';
import { chatJSON } from '../llm';
import { COMMON_RULES, buildCacheKey, formatChunk, type SubAgentContext } from './common';

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

export function normalizeBrief(raw: any): Brief {
  const score = Number(raw?.verdictScore);
  return {
    verdictScore: Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0,
    strongestFor: toStringArray(raw?.strongestFor),
    strongestAgainst: toStringArray(raw?.strongestAgainst),
    contested: toStringArray(raw?.contested),
    weakestLinkFor: typeof raw?.weakestLinkFor === 'string' ? raw.weakestLinkFor : '',
    weakestLinkAgainst: typeof raw?.weakestLinkAgainst === 'string' ? raw.weakestLinkAgainst : '',
    timeline: Array.isArray(raw?.timeline)
      ? raw.timeline
          .filter((t: any) => t && typeof t === 'object')
          .map((t: any) => ({
            date: String(t.date ?? ''),
            event: String(t.event ?? ''),
            doc: String(t.doc ?? ''),
          }))
      : [],
    nextSteps: toStringArray(raw?.nextSteps),
    humanReviewQueue: toStringArray(raw?.humanReviewQueue),
  };
}

export async function run(
  task: SubAgentTask,
  chunks: Chunk[],
  argument: string,
  context: SubAgentContext,
): Promise<Brief> {
  const system =
    `You are counsel writing the closing brief of a completed evidence investigation. ` +
    `Weigh the evidence actually found on both sides. "verdictScore" (0-100) measures the STRENGTH of the evidence found, not who wins. ` +
    `"nextSteps" must be 3-5 concrete lawyer actions (e.g. depose a named person, request a specific missing document, subpoena a file). ` +
    `"timeline" entries must be dated events with the document they come from. ` +
    COMMON_RULES +
    ` Shape: {"verdictScore": 0, "strongestFor": [], "strongestAgainst": [], "contested": [], "weakestLinkFor": "", "weakestLinkAgainst": "", "timeline": [{"date": "", "event": "", "doc": ""}], "nextSteps": [], "humanReviewQueue": []}.`;

  const ourPath = context.ourPath ?? [];
  const otherPath = context.otherPath ?? [];
  const pathChunks = context.pathChunks ?? [];
  const doneOutputs = context.doneOutputs ?? [];
  const taskNotes = doneOutputs
    .map(
      (t) =>
        `${t.taskId} (${t.kind}, ${t.side}): ${t.headline}` +
        (t.flags.length > 0 ? ` | flags: ${t.flags.map((f) => `${f.chunkId}: ${f.issue}`).join('; ')}` : ''),
    )
    .join('\n');

  const user =
    `Argument: ${argument}\n` +
    `Support final path: ${ourPath.join(' -> ') || '(empty)'}\n` +
    `Refute final path: ${otherPath.join(' -> ') || '(empty)'}\n` +
    `Path chunks:\n${pathChunks.map(formatChunk).join('\n') || '(none)'}\n` +
    `Investigation task outputs:\n${taskNotes || '(none)'}\n` +
    `Last strategist report (support): ${JSON.stringify(context.lastStrategistFor ?? null)}\n` +
    `Last strategist report (refute): ${JSON.stringify(context.lastStrategistAgainst ?? null)}`;

  const cacheKey = buildCacheKey(task.kind, task.side, task.tick, argument, task.inputChunks);
  const raw = await chatJSON(system, user, cacheKey);
  return normalizeBrief(raw);
}
