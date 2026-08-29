import type { Chunk, SubAgentOutput, SubAgentTask } from '../../../src/shared/types';
import { COMMON_RULES, callSubAgentLLM, formatChunk, type SubAgentContext } from './common';

export async function run(
  task: SubAgentTask,
  chunks: Chunk[],
  argument: string,
  context: SubAgentContext,
): Promise<SubAgentOutput> {
  const system =
    `You are a skeptical factchecker for the ${task.side} side of a legal evidence investigation. ` +
    `For each FIND chunk decide: is the claim actually stated in the document, or only inferred? ` +
    `Does any linked chunk contradict it? Do the dates line up — anything used as pre-signing evidence must predate the signing? ` +
    `Put every chunk id that checks out clean into "citations". Report anything shaky in "flags" as {"chunkId", "issue"} ` +
    `(issue styles: "date is after signing", "contradicted by qa_report.txt", "hearsay — second-hand", "inference, not stated"). ` +
    `Set "needsHuman" true if any find rests on a single uncorroborated source. ` +
    COMMON_RULES +
    ` Shape: {"headline": "...", "details": ["..."], "citations": ["chunk ids"], "confidence": 0.0, "needsHuman": false, "flags": [{"chunkId": "...", "issue": "..."}]}.`;

  const finds = context.finds ?? [];
  const linkedChunks = context.linkedChunks ?? [];
  const user =
    `Argument: ${argument}\n` +
    `Tick: ${task.tick}\n` +
    `FIND chunks to verify:\n` +
    finds.map(formatChunk).join('\n') +
    `\nLinked chunks (context only):\n` +
    (linkedChunks.length > 0
      ? linkedChunks.map(formatChunk).join('\n')
      : '(none)');

  return callSubAgentLLM(task, argument, system, user);
}
