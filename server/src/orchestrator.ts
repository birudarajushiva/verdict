import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  Boost,
  Brief,
  Chunk,
  RunResult,
  Side,
  SubAgentOutput,
  SubAgentTask,
  Tick,
} from '../../src/shared/types';
import { loadChunks } from './chunker';
import { makeAngles } from './angles';
import { scoreChunks } from './scorer';
import { buildLinks } from './linker';
import { Swarm } from './swarm';
import { extractPath, findOverlap } from './result';
import { run as runRecap } from './subagents/recap';
import { run as runFactcheck } from './subagents/factcheck';
import { run as runStrategist } from './subagents/strategist';
import { run as runCounsel } from './subagents/counsel';
import { chunkText, estimateCost, type SubAgentContext } from './subagents/common';

const CASE_DIR = path.resolve(import.meta.dirname, '../../case');
const CACHE_DIR = path.resolve(import.meta.dirname, '../cache');
const TICKS = 8;
const STRATEGIST_TICKS = new Set([3, 5, 7]);
const FACTCHECK_MAX_CHUNKS = 8;
const DEFAULT_MAX_TASKS = 30;
const DEFAULT_MAX_COST = 0.1;

const SIDES: Side[] = ['support', 'refute'];

function challengesFile(argument: string, seed: string): string {
  const hash = createHash('sha256').update(argument + seed).digest('hex');
  return path.join(CACHE_DIR, `challenges-${hash}.json`);
}

export function loadChallenges(argument: string, seed: string): Boost[] {
  const file = challengesFile(argument, seed);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordChallenge(
  argument: string,
  seed: string,
  chunkId: string,
  amount: number,
  reason: string,
): Boost[] {
  const entries = loadChallenges(argument, seed);
  entries.push({ chunkId, amount, reason, from: 'human' });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(challengesFile(argument, seed), JSON.stringify(entries, null, 2));
  return entries;
}

interface PlannedTask {
  task: SubAgentTask;
  context: SubAgentContext;
  execute: (
    task: SubAgentTask,
    chunks: Chunk[],
    argument: string,
    context: SubAgentContext,
  ) => Promise<SubAgentOutput | Brief>;
}

export async function runVerdictLoop(
  argument: string,
  seed: string,
  opts?: { maxTasks?: number; maxCost?: number },
): Promise<RunResult> {
  const maxTasks = opts?.maxTasks ?? DEFAULT_MAX_TASKS;
  const maxCost = opts?.maxCost ?? DEFAULT_MAX_COST;

  const chunks = loadChunks(CASE_DIR);
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const angles = await makeAngles(argument);
  const scored = await scoreChunks(chunks, argument, angles);
  const links = buildLinks(scored);

  const swarms: Record<Side, Swarm> = {
    support: new Swarm(scored, links, angles.support.map((a) => a.name), seed),
    refute: new Swarm(scored, links, angles.refute.map((a) => a.name), seed),
  };

  const humanBoosts = loadChallenges(argument, seed).map((b) => ({ ...b }));
  const pendingBoosts: Record<Side, Boost[]> = {
    support: [...humanBoosts],
    refute: [...humanBoosts],
  };

  const tasks: SubAgentTask[] = [];
  let taskSeq = 0;
  let executed = 0;
  let spentCost = 0;

  const ticks: Record<Side, Tick[]> = { support: [], refute: [] };
  const recapHeadlines: Record<Side, string[]> = { support: [], refute: [] };
  const findsHistory: Record<Side, string[][]> = { support: [], refute: [] };
  const prevPath: Record<Side, string[]> = { support: [], refute: [] };
  const lastStrategist: Record<Side, SubAgentOutput | null> = { support: null, refute: null };

  const inputCharsFor = (inputChunks: string[], extra = ''): number =>
    inputChunks.reduce((sum, id) => {
      const chunk = chunkById.get(id);
      return sum + (chunk ? chunkText(chunk).length + chunk.doc.length : 0);
    }, argument.length + extra.length + 500);

  const newTask = (
    kind: SubAgentTask['kind'],
    side: SubAgentTask['side'],
    tick: number,
    inputChunks: string[],
    extraChars = '',
  ): SubAgentTask => {
    const task: SubAgentTask = {
      id: `t${++taskSeq}`,
      kind,
      side,
      tick,
      inputChunks,
      status: 'queued',
      output: null,
      cost: estimateCost(inputCharsFor(inputChunks, extraChars)),
      boosts: [],
    };
    tasks.push(task);
    return task;
  };

  // Budget gate: recap and counsel are exempt; strategist is skipped before factcheck
  // because it is queued after factcheck within each tick. Skipped tasks do not
  // consume slots, so a lean budget still reaches every tick's recap and counsel.
  const canRun = (task: SubAgentTask): boolean => {
    if (executed >= maxTasks || spentCost + task.cost > maxCost) {
      task.status = 'skipped';
      console.log(`[tick ${task.tick}] ${task.side} ${task.kind} -> skipped (budget)`);
      return false;
    }
    executed++;
    spentCost += task.cost;
    return true;
  };

  const boostsFromFactcheck = (task: SubAgentTask, output: SubAgentOutput, finds: Chunk[]): Boost[] => {
    const boosts: Boost[] = [];
    const issueByChunk = new Map<string, string>();
    for (const flag of output.flags) {
      if (!issueByChunk.has(flag.chunkId)) issueByChunk.set(flag.chunkId, flag.issue);
    }
    const verified = new Set(output.citations);
    for (const find of finds) {
      const issue = issueByChunk.get(find.id);
      if (issue !== undefined) {
        boosts.push({ chunkId: find.id, amount: -0.1, reason: issue, from: task.id });
      } else if (verified.has(find.id)) {
        boosts.push({ chunkId: find.id, amount: 0.15, reason: 'verified', from: task.id });
      }
    }
    return boosts;
  };

  const boostsFromStrategist = (task: SubAgentTask, output: SubAgentOutput): Boost[] => {
    const boosts: Boost[] = [];
    for (const flag of output.flags.slice(0, 3)) {
      const target = flag.chunkId.trim();
      if (!target) continue;
      const needle = target.toLowerCase();
      for (const chunk of chunks) {
        if (chunkText(chunk).toLowerCase().includes(needle)) {
          boosts.push({
            chunkId: chunk.id,
            amount: 0.25,
            reason: `strategist: hunting ${target}`,
            from: task.id,
          });
        }
      }
    }
    return boosts;
  };

  for (let tick = 1; tick <= TICKS; tick++) {
    // a. Step both swarms with their pending boosts, then clear.
    for (const side of SIDES) {
      ticks[side].push(swarms[side].step(pendingBoosts[side]));
      pendingBoosts[side] = [];
    }

    // Finds: chunks on this tick's path that were not on the previous tick's path.
    const currentPaths: Record<Side, string[]> = { support: [], refute: [] };
    const finds: Record<Side, Chunk[]> = { support: [], refute: [] };
    for (const side of SIDES) {
      const { path } = extractPath(scored, swarms[side].links);
      currentPaths[side] = path;
      const prev = new Set(prevPath[side]);
      finds[side] = path
        .filter((id) => !prev.has(id))
        .map((id) => chunkById.get(id))
        .filter((c): c is Chunk => c !== undefined);
      findsHistory[side].push(finds[side].map((c) => c.id));
    }

    // b. Queue this tick's tasks: recap always, factcheck when there are finds,
    // strategist at ticks 3, 5, 7. Recap before factcheck before strategist per side.
    const planned: PlannedTask[] = [];
    for (const side of SIDES) {
      const other: Side = side === 'support' ? 'refute' : 'support';

      const recapTask = newTask('recap', side, tick, finds[side].map((c) => c.id), recapHeadlines[side].join('\n'));
      planned.push({
        task: recapTask,
        context: { finds: finds[side], previousHeadlines: recapHeadlines[side] } as SubAgentContext,
        execute: runRecap,
      });

      if (finds[side].length > 0) {
        const findIds = new Set(finds[side].map((c) => c.id));
        const linked: Chunk[] = [];
        for (const link of links) {
          for (const [a, b] of [
            [link.from, link.to],
            [link.to, link.from],
          ] as const) {
            if (findIds.has(a)) {
              const chunk = chunkById.get(b);
              if (chunk && !findIds.has(b) && !linked.some((c) => c.id === b)) linked.push(chunk);
            }
          }
        }
        const input = [...finds[side], ...linked].slice(0, FACTCHECK_MAX_CHUNKS);
        const factcheckTask = newTask('factcheck', side, tick, input.map((c) => c.id));
        planned.push({
          task: factcheckTask,
          context: { finds: finds[side], linkedChunks: input.filter((c) => !findIds.has(c.id)) } as SubAgentContext,
          execute: runFactcheck,
        });
      }

      if (STRATEGIST_TICKS.has(tick)) {
        const bothPathIds: string[] = [];
        for (const id of [...currentPaths[side], ...currentPaths[other]]) {
          if (!bothPathIds.includes(id)) bothPathIds.push(id);
        }
        const strategistTask = newTask('strategist', side, tick, bothPathIds);
        planned.push({
          task: strategistTask,
          context: {
            ourPath: currentPaths[side],
            otherPath: currentPaths[other],
            pathChunks: bothPathIds
              .map((id) => chunkById.get(id))
              .filter((c): c is Chunk => c !== undefined),
          } as SubAgentContext,
          execute: runStrategist,
        });
      }
    }

    // c. Run this tick's tasks. Serialized and rate-limited (the free-tier LLM
    // quota rejects bursts); results land in id order and boosts feed the NEXT tick.
    const runnable = planned.filter((p) => canRun(p.task));
    for (const { task, context, execute } of runnable) {
      task.status = 'running';
      try {
        const output = await execute(task, chunks, argument, context);
        task.status = 'done';
        if (task.kind === 'recap') {
          const out = output as SubAgentOutput;
          task.output = out;
          recapHeadlines[task.side as Side].push(out.headline);
        } else if (task.kind === 'factcheck') {
          const out = output as SubAgentOutput;
          task.output = out;
          task.boosts = boostsFromFactcheck(task, out, finds[task.side as Side]);
          pendingBoosts[task.side as Side].push(...task.boosts);
        } else if (task.kind === 'strategist') {
          const out = output as SubAgentOutput;
          task.output = out;
          lastStrategist[task.side as Side] = out;
          task.boosts = boostsFromStrategist(task, out);
          pendingBoosts[task.side as Side].push(...task.boosts);
        }
        console.log(`[tick ${task.tick}] ${task.side} ${task.kind} -> ${task.boosts.length} boosts`);
      } catch (err) {
        task.status = 'done';
        task.output = null;
        console.log(
          `[tick ${task.tick}] ${task.side} ${task.kind} -> error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    for (const side of SIDES) {
      prevPath[side] = currentPaths[side];
    }
  }

  // Counsel once at the end.
  const finalPaths = {
    support: extractPath(scored, swarms.support.links),
    refute: extractPath(scored, swarms.refute.links),
  };
  const bothFinalIds: string[] = [];
  for (const id of [...finalPaths.support.path, ...finalPaths.refute.path]) {
    if (!bothFinalIds.includes(id)) bothFinalIds.push(id);
  }
  const counselTask = newTask('counsel', 'both', TICKS, bothFinalIds);
  let brief: Brief = {
    verdictScore: 0,
    strongestFor: [],
    strongestAgainst: [],
    contested: [],
    weakestLinkFor: '',
    weakestLinkAgainst: '',
    timeline: [],
    nextSteps: [],
    humanReviewQueue: [],
  };
  if (canRun(counselTask)) {
    counselTask.status = 'running';
    try {
      brief = await runCounsel(
        counselTask,
        chunks,
        argument,
        {
          ourPath: finalPaths.support.path,
          otherPath: finalPaths.refute.path,
          pathChunks: bothFinalIds
            .map((id) => chunkById.get(id))
            .filter((c): c is Chunk => c !== undefined),
          doneOutputs: tasks
            .filter((t) => t.kind !== 'counsel' && t.status === 'done' && t.output)
            .map((t) => ({
              taskId: t.id,
              kind: t.kind,
              side: t.side,
              headline: t.output!.headline,
              flags: t.output!.flags,
            })),
          lastStrategistFor: lastStrategist.support,
          lastStrategistAgainst: lastStrategist.refute,
        } as SubAgentContext,
      );
      counselTask.status = 'done';
      console.log(`[final] both counsel -> brief (verdictScore ${brief.verdictScore})`);
    } catch (err) {
      counselTask.status = 'done';
      console.log(`[final] both counsel -> error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  brief = { ...brief, humanReviewQueue: tasks.filter((t) => t.output?.needsHuman).map((t) => t.id) };

  // Replay recap: one code-built summary line per tick; the final tick's summary
  // and the last recap line become the closing line for that side's trail.
  const buildRecap = (side: Side): string[] => {
    const lines = ticks[side].map((t) => t.summary);
    const closing = `Trail settled: ${finalPaths[side].sources.join(' → ')}.`;
    if (lines.length > 0) {
      lines[lines.length - 1] = closing;
      ticks[side][ticks[side].length - 1].summary = closing;
    }
    return lines;
  };
  const supportRecap = buildRecap('support');
  const refuteRecap = buildRecap('refute');

  return {
    argument,
    seed,
    support: {
      side: 'support',
      angles: angles.support,
      ticks: ticks.support,
      recap: supportRecap,
      finds: findsHistory.support,
      path: finalPaths.support.path,
      sources: finalPaths.support.sources,
    },
    refute: {
      side: 'refute',
      angles: angles.refute,
      ticks: ticks.refute,
      recap: refuteRecap,
      finds: findsHistory.refute,
      path: finalPaths.refute.path,
      sources: finalPaths.refute.sources,
    },
    overlap: findOverlap(finalPaths.support.path, finalPaths.refute.path),
    tasks,
    brief,
  };
}
