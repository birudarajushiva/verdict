// Frontend view-model. Decoupled from the volatile shared contract so the UI
// compiles regardless of backend shape changes. Mirrors what the components consume.

export type Chunk = {
  id: string;
  doc: string;
  text: string;
  score: Record<string, number>;
  against: number;
};

export type Link = {
  from: string;
  to: string;
  strength: number;
};

export type Agent = {
  id: string;
  angle: string;
  at: string;
  visited: string[];
};

export type Tick = {
  tick: number;
  links: Link[];
  agents: Agent[];
  boostsApplied?: { chunkId: string; amount: number }[];
};

export type RunResult = {
  angles: string[];
  ticks: Tick[];
  path: string[];
  sources: string[];
  contradictions: string[];
};
