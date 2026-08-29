import type { Chunk, SubAgentOutput, SubAgentTask } from '../../../src/shared/types';
import { COMMON_RULES, callSubAgentLLM, formatChunk, type SubAgentContext } from './common';

export async function run(
  task: SubAgentTask,
  chunks: Chunk[],
  argument: string,
  context: SubAgentContext,
): Promise<SubAgentOutput> {
  const system =
    `You are the recap reporter for the ${task.side} side of a legal evidence investigation. ` +
    `Write ONE plain-English headline sentence a lawyer would say out loud about what this side's trail is showing so far ` +
    `(example style: "The support trail is converging on internal QA communications from late February"). ` +
    `Then give up to 3 detail bullets containing ONLY new information — never repeat or rephrase any previous headline. ` +
    COMMON_RULES +
    ` Shape: {"headline": "...", "details": ["..."], "citations": ["doc names"], "confidence": 0.0, "needsHuman": false, "flags": []}.`;

  const previousHeadlines = context.previousHeadlines ?? [];
  const finds = context.finds ?? [];
  const user =
    `Argument: ${argument}\n` +
    `Tick: ${task.tick}\n` +
    `Previous headlines so far:\n` +
    (previousHeadlines.length > 0
      ? previousHeadlines.map((h) => `- ${h}`).join('\n')
      : '(none yet)') +
    `\nNew finds this tick:\n` +
    (finds.length > 0 ? finds.map(formatChunk).join('\n') : '(none)');

  return callSubAgentLLM(task, argument, system, user);
}
