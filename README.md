# Verdict
### Explore evidence for and against an argument

Verdict is a TypeScript prototype for document-based argument investigation. It chunks a local case corpus, links evidence, and explores supporting and refuting paths with seeded swarm traversal and model-assisted specialist tasks. A React/Three.js interface visualizes the evidence graph and supports reviewer challenges.

**This is an exploratory demonstration. Scores are application heuristics, not calibrated probabilities, legal conclusions, or proof that an argument is true.**

## Engineering highlights

- Shared TypeScript contracts connect the API, evidence graph, and client.
- Separate chunking, linking, scoring, traversal, and orchestration modules expose the reasoning pipeline.
- Seeded traversal has an existing test for reproducibility, seed variation, and preservation of caller input.
- Support/refute paths, specialist findings, and reviewer boosts remain inspectable.
- Provider responses are cached on disk for replay; a cache miss requires a configured model.

## Run locally

Use a modern Node.js runtime compatible with the committed dependencies; Node.js 24 LTS is a starting point to validate. From the repository root:

```sh
npm --prefix server ci
npm --prefix client ci
```

For model-assisted operations, create `server/.env`:

```dotenv
LLM_API_KEY=your-provider-key
# Optional: use a model available to your account
# LLM_MODEL=your-model-id
# LLM_BASE_URL=https://your-provider.example/v1
```

The code defaults to Google's OpenAI-compatible endpoint and `gemini-2.5-flash`; verify availability for your account or set `LLM_MODEL`. Credentials remain server-side. Live requests can incur charges. Cached responses may contain case text and generated findings; keep them private.

Start the API and client in separate terminals:

```sh
npm run dev:server
```

```sh
npm run dev:client
```

The API defaults to http://localhost:3001. Open the local URL printed by Vite for the client. `VITE_API_URL` overrides the client's API address when needed.

## Architecture

```text
case/*.txt → chunks → evidence links → scoring + seeded traversal
                                           ↓
                         specialist tasks ↔ orchestration
                                           ↓
                             support/refute paths → React graph
```

- [server/src/](server/src/): HTTP routes, document processing, LLM adapter, traversal, and orchestration.
- [client/src/](client/src/): interactive evidence board, chat, uploads, and result panels.
- [src/shared/types.ts](src/shared/types.ts): shared data contracts.
- [case/](case/): bundled example corpus.
- [CONTRACT.md](CONTRACT.md): implementation contract and project terminology.

The backend exposes `GET /health`, `GET /graph`, and POST routes for `/run`, `/upload`, `/ask`, `/recap`, `/challenge`, and `/approve`.

## Verify

```sh
npm test
npm run check:chunks
npm run check:links
npm --prefix client run lint
npm --prefix client run build
```

`npm test` exercises deterministic swarm behavior. Scoring, demo, and full investigation paths can require provider calls; inspect their scripts before running them. No successful live-provider evaluation or current deployment verification is claimed by this README.

## Prototype boundaries

The HTTP server has no authentication, broad CORS, and no request-body size limit. `/upload` writes into the case directory and may overwrite a same-named document. Do not expose it publicly or load confidential material without first adding access controls, upload limits, isolated storage, and data-retention rules.

Cached LLM outputs depend on the adapter's cache keys; a changed prompt/model should not be assumed to invalidate an existing response. Review model output against original documents. No repository-wide license is currently included.
