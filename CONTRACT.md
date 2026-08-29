# Evidence Swarm Shared Data Shapes

```typescript
type Chunk = { id: string; doc: string; text: string; score: Record<string, number>; against: number };
type Link = { from: string; to: string; strength: number };
type Agent = { id: string; angle: string; at: string; visited: string[] };
type Tick = { tick: number; links: Link[]; agents: Agent[] };
type RunResult = { angles: string[]; ticks: Tick[]; path: string[]; sources: string[]; contradictions: string[] };
```

## Definitions

- Chunks are pieces of documents.
- Links connect related chunks.
- Agents walk links and strengthen them.
- A run is 8 ticks.
