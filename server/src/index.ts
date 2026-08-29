import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Chunk } from '../../src/shared/types';
import { loadChunks } from './chunker';
import { buildLinks } from './linker';
import { chatJSON } from './llm';
import { recordChallenge, runVerdictLoop } from './orchestrator';
import { extractPath } from './result';

const PORT = Number(process.env.PORT || 3001);
const CASE_DIR = path.resolve(import.meta.dirname, '../../case');
const DEFAULT_ARGUMENT =
  'Kestrel knew the controller firmware was defective before signing on March 3';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function stringField(body: any, key: string): string {
  return typeof body?.[key] === 'string' ? body[key] : '';
}

function sanitizeName(raw: string): string {
  const base = path.basename(raw).replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (!base) return '';
  return base.toLowerCase().endsWith('.txt') ? base : `${base}.txt`;
}

function chunkText(chunk: Chunk): string {
  return chunk.sentences.join(' ');
}

function formatEvidence(ids: string[], byId: Map<string, Chunk>): string {
  return ids
    .map((id) => {
      const chunk = byId.get(id);
      return chunk ? `[${chunk.doc}] ${chunkText(chunk)}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

async function handleAsk(body: any): Promise<{ answer: string }> {
  const question = stringField(body, 'question');
  const supportPath = Array.isArray(body?.supportPath)
    ? body.supportPath.filter((x: any) => typeof x === 'string')
    : [];
  const refutePath = Array.isArray(body?.refutePath)
    ? body.refutePath.filter((x: any) => typeof x === 'string')
    : [];
  const argument = stringField(body, 'argument').trim() || DEFAULT_ARGUMENT;
  const seed = stringField(body, 'seed').trim() || 'demo';

  // Deterministic replay from cache: provides the brief, task outputs, and boost reasons.
  const run = await runVerdictLoop(argument, seed, { maxTasks: 8 });

  const chunks = loadChunks(CASE_DIR);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const forText = formatEvidence(supportPath, byId);
  const againstText = formatEvidence(refutePath, byId);

  const brief = run.brief;
  const taskNotes = run.tasks
    .filter((t) => t.status === 'done' && t.output)
    .map(
      (t) =>
        `${t.id} (${t.kind}, ${t.side}): ${t.output!.headline}` +
        (t.output!.flags.length > 0
          ? ` | flags: ${t.output!.flags.map((f) => `${f.chunkId}: ${f.issue}`).join('; ')}`
          : ''),
    )
    .join('\n');
  const boostNotes: string[] = [];
  for (const side of ['support', 'refute'] as const) {
    for (const tick of run[side].ticks) {
      for (const boost of tick.boostsApplied) {
        boostNotes.push(
          `${boost.from} (${side} tick ${tick.tick}): ${boost.chunkId} ${boost.amount >= 0 ? '+' : ''}${boost.amount} (${boost.reason})`,
        );
      }
    }
  }

  const system =
    `You are a case assistant. Answer ONLY from the evidence and investigation notes below. ` +
    `Cite document names in brackets. If the evidence does not answer the question, say so plainly. ` +
    `If asked why the swarm moved toward a chunk, answer from the boost reasons.\n\n` +
    `Brief: verdictScore ${brief.verdictScore}/100. Strongest for: ${brief.strongestFor.join('; ') || '(none)'}. ` +
    `Strongest against: ${brief.strongestAgainst.join('; ') || '(none)'}. ` +
    `Contested: ${brief.contested.join('; ') || '(none)'}. ` +
    `Weakest link for: ${brief.weakestLinkFor || '(none)'}. Weakest link against: ${brief.weakestLinkAgainst || '(none)'}.\n\n` +
    `Task findings:\n${taskNotes || '(none)'}\n\n` +
    `Boosts applied to the swarms:\n${boostNotes.join('\n') || '(none)'}\n\n` +
    `Evidence FOR the argument:\n${forText || '(none)'}\n\n` +
    `Evidence AGAINST the argument:\n${againstText || '(none)'}\n\n` +
    `Respond with JSON only: {"answer": "<your answer>"}.`;

  const cacheKey = 'ask|' + question + '|' + supportPath.join(',') + '|' + refutePath.join(',');
  const result = await chatJSON(system, question, cacheKey);
  const answer = typeof result?.answer === 'string' ? result.answer : String(result?.answer ?? '');
  return { answer };
}

async function handleHumanBoost(
  body: any,
  amount: number,
  defaultReason: string,
): Promise<unknown> {
  const argument = stringField(body, 'argument').trim();
  if (!argument) throw Object.assign(new Error('argument is required'), { status: 400 });
  const chunkId = stringField(body, 'chunkId').trim();
  if (!chunkId) throw Object.assign(new Error('chunkId is required'), { status: 400 });
  const seed = stringField(body, 'seed').trim() || 'demo';
  const reason = stringField(body, 'reason').trim() || defaultReason;
  recordChallenge(argument, seed, chunkId, amount, reason);
  return runVerdictLoop(argument, seed);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/graph') {
      const chunks = loadChunks(CASE_DIR); // chunker initializes score: {}
      const links = buildLinks(chunks);
      sendJson(res, 200, { chunks, links });
      return;
    }

    if (req.method === 'POST' && pathname === '/upload') {
      const body = await readBody(req);
      const docs = Array.isArray(body?.docs) ? body.docs : [];
      if (docs.length === 0) {
        sendJson(res, 400, { error: 'docs array is required' });
        return;
      }
      const written: string[] = [];
      for (const d of docs) {
        const name = sanitizeName(String(d?.name ?? ''));
        const text = String(d?.text ?? '');
        if (!name || !text.trim()) continue;
        fs.writeFileSync(path.join(CASE_DIR, name), text);
        written.push(name);
      }
      if (written.length === 0) {
        sendJson(res, 400, { error: 'no valid documents supplied' });
        return;
      }
      sendJson(res, 200, { ok: true, written });
      return;
    }

    if (req.method === 'POST' && pathname === '/run') {
      const body = await readBody(req);
      const argument = stringField(body, 'argument').trim();
      if (!argument) {
        sendJson(res, 400, { error: 'argument is required' });
        return;
      }
      const seed = stringField(body, 'seed').trim() || 'demo';
      const loopOpts: { maxTasks?: number; maxCost?: number } = {};
      if (typeof body.maxTasks === 'number' && Number.isFinite(body.maxTasks)) {
        loopOpts.maxTasks = body.maxTasks;
      }
      if (typeof body.maxCost === 'number' && Number.isFinite(body.maxCost)) {
        loopOpts.maxCost = body.maxCost;
      }
      const result = await runVerdictLoop(argument, seed, loopOpts);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/recap') {
      const body = await readBody(req);
      const argument = stringField(body, 'argument').trim();
      if (!argument) {
        sendJson(res, 400, { error: 'argument is required' });
        return;
      }
      const side = body.side;
      if (side !== 'support' && side !== 'refute') {
        sendJson(res, 400, { error: 'side must be "support" or "refute"' });
        return;
      }
      const tick = Number(body.tick);
      if (!Number.isInteger(tick) || tick < 1 || tick > 8) {
        sendJson(res, 400, { error: 'tick must be an integer in 1..8' });
        return;
      }
      const seed = stringField(body, 'seed').trim() || 'demo';
      const run = await runVerdictLoop(argument, seed);
      const sideRun = run[side];
      if (tick > sideRun.ticks.length) {
        sendJson(res, 400, { error: `tick ${tick} out of range (max ${sideRun.ticks.length})` });
        return;
      }
      const tickRecord = sideRun.ticks[tick - 1];
      const chunks = loadChunks(CASE_DIR);
      sendJson(res, 200, {
        tick,
        summary: tickRecord.summary,
        finds: tickRecord.finds,
        soFar: sideRun.recap.slice(0, tick),
        pathSoFar: extractPath(chunks, tickRecord.links),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/challenge') {
      const body = await readBody(req);
      const result = await handleHumanBoost(body, -0.5, 'challenged by reviewer');
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/approve') {
      const body = await readBody(req);
      const result = await handleHumanBoost(body, 0.5, 'approved by reviewer');
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/ask') {
      const body = await readBody(req);
      const result = await handleAsk(body);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof err?.status === 'number' ? err.status : 500;
    sendJson(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
