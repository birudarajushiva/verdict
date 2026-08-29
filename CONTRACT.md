# Verdict Pipeline — API & Module Contract

All types below are defined in `src/shared/types.ts`. The server is `server/src/index.ts`
(`node:http`, JSON everywhere, CORS `*`, port from `PORT` env, default 3000).

## Determinism & caching

Every LLM call goes through `chatJSON(system, user, cacheKey)` (server/src/llm.ts).
Responses are cached at `server/cache/<sha256(cacheKey)>.json`, so after one warm run
the whole pipeline replays byte-identically with no network.

| Call | cacheKey |
| --- | --- |
| makeAngles | `angles\|<argument>` |
| scoreChunks | `scores\|<argument>\|<chunk id+len pairs>` |
| subagents | `<kind>\|<side>\|<tick>\|<argument>\|<inputChunks joined ",">` |
| /ask | `ask\|<question>\|<supportPath joined>\|<refutePath joined>` |

Swarm randomness is seeded: `sha256(seed|tick|agentId|candidateId)` — never `Math.random`.

## Pipeline

`runVerdictLoop(argument, seed, opts?)` (server/src/orchestrator.ts):

1. loadChunks → makeAngles → scoreChunks → buildLinks (as before).
2. Two `Swarm` instances (support angles / refute angles) with independent link copies.
3. Ticks 1..8: apply pending boosts → agents move → deposits → decay ×0.85 clamp [0.01, 1].
   - **finds** for a side at tick N = chunk ids on this tick's `extractPath(links)` that were
     not on the previous tick's path.
   - Per side per tick: `recap` always; `factcheck` when finds exist; `strategist` at ticks 3, 5, 7.
   - Task boosts are collected and applied at the START of the next tick (never the same tick).
4. After tick 8: one `counsel` task (side `both`) writes the `Brief`.

### Subagent contracts

All prompts: JSON only; cite document names; never invent facts absent from the provided
chunks; say "not in evidence" when unsure.

- **recap** — headline = one plain-English sentence about what this side's trail shows so far;
  `details` = up to 3 bullets of NEW information (previous headlines passed in, no repeats).
  No boosts.
- **factcheck** — inputs: find chunks + every chunk linked to them (max 8 total).
  `citations` = ids of finds whose claims are actually stated and uncontradicted ("verified");
  `flags` = `[{chunkId, issue}]` for anything shaky; `needsHuman` when a find rests on a
  single uncorroborated source. Boosts (computed in code from the output): `+0.15` per verified
  find (reason `verified`), `-0.10` per flagged chunk (reason = the issue).
- **strategist** — inputs: this side's path, the other side's path, all chunks on both.
  `details` must cover: (a) weakest link in this side's chain + fix, (b) weakest link in the
  other side's chain + attack, (c) up to 3 hunt targets. `flags` carries the hunt targets as
  `{chunkId: "<target>", issue: "hunt target"}`. Boosts (in code): every chunk whose text
  matches a target (case-insensitive substring) gets `+0.25`, reason `strategist: hunting <target>`.
- **counsel** — inputs: both final paths, every done task's output, both last-strategist outputs.
  Produces the `Brief` (`verdictScore` 0–100 = strength of evidence found, not who wins).
  `humanReviewQueue` is filled in code with the ids of tasks whose output has `needsHuman`.

### Task ids, budget, skips

- Task ids `t1`, `t2`, … assigned in queue order across ticks. Boosts carry `from` = task id
  (human levers use `from: "human"`).
- Budget: `maxTasks` default 30, `maxCost` default `$0.10`; cost estimate per task =
  `inputChars / 4000 * 0.001`. Over budget → task kept in `tasks` with status `skipped`,
  output `null`, boosts not applied. Skip order: strategist first, then factcheck; recap and
  counsel are never skipped.
- Log line per executed task: `[tick N] <side> <kind> -> <n> boosts`.

### Human-in-the-loop

`server/cache/challenges-<sha256(argument+seed)>.json` stores
`[{chunkId, amount, reason, from: "human"}]`. `/challenge` appends `-0.5`, `/approve` appends
`+0.5`; the orchestrator applies all stored entries to BOTH swarms at tick 1 of every run.

## Replay data (finds, summaries, recap)

A **find** is any move where an agent lands on a chunk with `score[agent.angle] >= 0.5` —
the same condition that triggers a deposit. While applying deposits, `Swarm.step` records a
`Find { agentId, chunkId, doc, angle, score, linkFrom, linkTo, note }` for each qualifying
move; `note` is code-generated: `<agentId> (<angle>) found <doc>: "<first 80 chars of chunk
text>…"`. Every `Tick` carries `finds: Find[]` and a code-built `summary`:

- no finds → `Round N: agents exploring, no strong evidence yet.`
- otherwise → `Round N: <k> find(s) in <comma-separated unique docs>.`

After each swarm finishes, the orchestrator builds `SwarmRun.recap = ticks.map(t => t.summary)`
and replaces the final tick's summary and the last recap line with
`Trail settled: <path docs joined by ' → '>.` All of this is pure code — no LLM — so finds and
summaries are identical across runs with the same seed and replay offline from cache.
(The LLM recap *headlines* still exist as outputs of the recap-kind entries in `RunResult.tasks`.)

## HTTP API

Errors: `400`/`404`/`500` → `{ "error": string }`. Successful responses are `200` JSON.
`OPTIONS` → `204` with CORS headers.

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /health` | — | `{ ok: true }` |
| `GET /graph` | — | `{ chunks: Chunk[] (score = {}), links: Link[] }` |
| `POST /run` | `{ argument, seed?, maxTasks?, maxCost? }` | `RunResult` (seed default `"demo"`) |
| `POST /recap` | `{ argument, seed?, side, tick }` | `{ tick, summary, finds, soFar, pathSoFar }` — `summary`/`finds` from that tick, `soFar` = recap lines 1..tick, `pathSoFar` = `extractPath` over that tick's links; 400 if tick outside 1..8. Lets the frontend pause at any round and ask "what do we have so far?" |
| `POST /ask` | `{ question, supportPath, refutePath, argument?, seed? }` | `{ answer }` — answers only from evidence + Brief + task outputs + boost reasons; cites `[doc]` names; "why did the swarm go to X" is answered from boost reasons |
| `POST /challenge` | `{ argument, seed?, chunkId, reason? }` | records permanent `-0.5` boost, returns the updated `RunResult` |
| `POST /approve` | `{ argument, seed?, chunkId, reason? }` | records permanent `+0.5` boost, returns the updated `RunResult` |

`RunResult.support.recap` is the array of code-built per-tick summary lines (last line = the
"Trail settled" closing); `RunResult.support.finds[i]` is the list of new chunk ids found at
tick `i+1`; `RunResult.support.ticks[i].finds` holds the full `Find` records for replay.
