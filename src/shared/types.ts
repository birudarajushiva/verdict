export interface Chunk {
  id: string;
  doc: string;
  sentences: string[];
  score: Record<string, number>;
  against: number;
}

export interface Link {
  from: string;
  to: string;
  strength: number;
}

export interface AgentState {
  id: string;
  chunkId: string;
  angle: string;
}

export type Side = 'support' | 'refute';

export type SubAgentKind = 'recap' | 'factcheck' | 'strategist' | 'counsel';

export type Boost = {
  chunkId: string;
  amount: number;
  reason: string;
  from: string;
};

export type SubAgentOutput = {
  headline: string;
  details: string[];
  citations: string[];
  confidence: number;
  needsHuman: boolean;
  flags: { chunkId: string; issue: string }[];
};

export type SubAgentTask = {
  id: string;
  kind: SubAgentKind;
  side: Side | 'both';
  tick: number;
  inputChunks: string[];
  status: 'queued' | 'running' | 'done' | 'skipped';
  output: SubAgentOutput | null;
  cost: number;
  boosts: Boost[];
};

export type Brief = {
  verdictScore: number;
  strongestFor: string[];
  strongestAgainst: string[];
  contested: string[];
  weakestLinkFor: string;
  weakestLinkAgainst: string;
  timeline: { date: string; event: string; doc: string }[];
  nextSteps: string[];
  humanReviewQueue: string[];
};

export type Find = {
  agentId: string;
  chunkId: string;
  doc: string;
  angle: string;
  score: number;
  linkFrom: string;
  linkTo: string;
  note: string;
};

export interface Tick {
  tick: number;
  links: Link[];
  agents: AgentState[];
  boostsApplied: Boost[];
  finds: Find[];
  summary: string;
}

export interface SwarmRun {
  side: Side;
  angles: { name: string; description: string }[];
  ticks: Tick[];
  recap: string[];
  finds: string[][];
  path: string[];
  sources: string[];
}

export interface RunResult {
  argument: string;
  seed: string;
  support: SwarmRun;
  refute: SwarmRun;
  overlap: string[];
  tasks: SubAgentTask[];
  brief: Brief;
}
