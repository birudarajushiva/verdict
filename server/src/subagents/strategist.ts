import type { Chunk, SubAgentOutput, SubAgentTask } from '../../../src/shared/types';
import { COMMON_RULES, callSubAgentLLM, formatChunk, type SubAgentContext } from './common';

export async function run(
  task: SubAgentTask,
  chunks: Chunk[],
  argument: string,
  context: SubAgentContext,
): Promise<SubAgentOutput> {
  const system =
    `You are the strategist for the ${task.side} side of a legal evidence investigation, thinking like opposing counsel. ` +
    `(a) Identify the weakest link in THIS side's evidence chain and say what would fix it. ` +
    `(b) Identify the weakest link in the OTHER side's chain and say how to attack it. ` +
    `(c) Name up to 3 specific things to hunt for next — a person, a date, or a document type — that are NOT already on this side's path. ` +
    `Put each hunt target in "flags" as {"chunkId": "<exact name, date, or keyword to hunt>", "issue": "hunt target"}. ` +
    `Hunt targets must be short exact strings that could appear verbatim in a document. ` +
    COMMON_RULES +
    ` Shape: {"headline": "...", "details": ["weakest for: ...", "weakest against: ...", "hunt: ..."], "citations": ["doc names"], "confidence": 0.0, "needsHuman": false, "flags": [{"chunkId": "...", "issue": "hunt target"}]}.`;

  const ourPath = context.ourPath ?? [];
  const otherPath = context.otherPath ?? [];
  const pathChunks = context.pathChunks ?? [];
  const user =
    `Argument: ${argument}\n` +
    `Tick: ${task.tick}\n` +
    `This side's path so far: ${ourPath.length > 0 ? ourPath.join(' -> ') : '(empty)'}\n` +
    `Other side's path so far: ${otherPath.length > 0 ? otherPath.join(' -> ') : '(empty)'}\n` +
    `All chunks on both paths:\n` +
    (pathChunks.length > 0
      ? pathChunks.map(formatChunk).join('\n')
      : '(none)');

  return callSubAgentLLM(task, argument, system, user);
}
