import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Sparkles, Upload, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EvidenceBoard, { type SideTab } from './components/EvidenceBoard.tsx';
import ResultPanel from './components/ResultPanel.tsx';
import ChatPanel from './components/ChatPanel.tsx';
import DocUpload from './components/DocUpload.tsx';
import { fetchGraph, runSwarm, ask } from './api.ts';
import { adaptRunSide } from './adapt.ts';
import type { Chunk, Link, Agent, RunResult } from './types.ts';
import mockRun from './mock/run.json';
import './App.css';

const USE_API = import.meta.env.VITE_USE_API === 'true';
const DEMO_ARGUMENT = 'The vendor knowingly shipped a defective product to meet its quarterly revenue target, while hiding internal quality-control waivers from the customer.';

type MockRun = RunResult & { chunks: Chunk[]; links: Link[] };

interface Toast {
  id: number;
  message: string;
}

export default function App() {
  const [argument, setArgument] = useState(DEMO_ARGUMENT);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [tickIndex, setTickIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [focusedChunk, setFocusedChunk] = useState<string | null>(null);
  const [tab, setTab] = useState<SideTab>('for');
  const [activationKey, setActivationKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const forRunRef = useRef<RunResult | null>(null);
  const againstRunRef = useRef<RunResult | null>(null);

  const activeRun = tab === 'for' ? forRunRef.current : againstRunRef.current;
  const totalTicks = activeRun?.ticks.length ?? 0;

  // Each tab shows the nodes its side's swarm engaged (path + touched chunks), so the sphere fills.
  const engagedIds = (run: RunResult | null) => {
    const s = new Set<string>();
    if (!run) return s;
    run.path.forEach((id) => s.add(id));
    run.ticks.forEach((t) => {
      t.links.forEach((l) => { s.add(l.from); s.add(l.to); });
      t.boostsApplied?.forEach((b) => { if (b.amount > 0) s.add(b.chunkId); });
      t.agents.forEach((a) => { s.add(a.at); a.visited.forEach((v) => s.add(v)); });
    });
    return s;
  };
  const activeIds = engagedIds(activeRun);
  const visibleChunks = activeIds.size ? chunks.filter((c) => activeIds.has(c.id)) : chunks;
  const visibleLinks = activeIds.size ? links.filter((l) => activeIds.has(l.from) && activeIds.has(l.to)) : links;

  const toast = (message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  };

  useEffect(() => {
    const data = mockRun as unknown as MockRun;
    forRunRef.current = data;
    againstRunRef.current = data;
    if (USE_API) {
      fetchGraph()
        .then((g) => {
          setChunks(g.chunks);
          setLinks(g.links);
        })
        .catch(() => {
          setChunks(data.chunks);
          setLinks(data.links);
        });
    } else {
      setChunks(data.chunks);
      setLinks(data.links);
    }
  }, []);

  const applyTick = (i: number) => {
    const run = tab === 'for' ? forRunRef.current : againstRunRef.current;
    if (!run) return;
    const tick = run.ticks[i];
    if (!tick) return;
    setTickIndex(i);
    setLinks(tick.links);
    setAgents(tick.agents);
  };

  useEffect(() => {
    if (!playing) return;
    const run = tab === 'for' ? forRunRef.current : againstRunRef.current;
    if (!run) return;
    if (tickIndex >= run.ticks.length - 1) {
      setPlaying(false);
      setShowResult(true);
      setPath(run.path);
      return;
    }
    const timer = setTimeout(() => applyTick(tickIndex + 1), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, tickIndex, tab]);

  // Refresh the current tick's links/agents when switching sides.
  useEffect(() => {
    if (tickIndex >= 0) applyTick(tickIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const startRun = async () => {
    setPlaying(false);
    setShowResult(false);
    setTickIndex(-1);
    setPath([]);

    if (USE_API) {
      try {
        const graph = await fetchGraph();
        let useChunks = graph.chunks;
        let forRun: RunResult;
        let againstRun: RunResult;
        try {
          const raw = await runSwarm(argument);
          forRun = adaptRunSide(raw, 'support');
          againstRun = adaptRunSide(raw, 'refute');
        } catch {
          const m = mockRun as unknown as MockRun;
          useChunks = m.chunks;
          forRun = m;
          againstRun = m;
          toast('Live LLM unavailable — showing demo swarm');
        }
        if (forRun !== againstRun) {
          forRun.contradictions = againstRun.path;
          againstRun.contradictions = forRun.path;
        }
        forRunRef.current = forRun;
        againstRunRef.current = againstRun;
        setChunks(useChunks);
        const run = tab === 'for' ? forRun : againstRun;
        setTickIndex(0);
        setLinks(run?.ticks[0]?.links ?? []);
        setAgents(run?.ticks[0]?.agents ?? []);
        setPlaying(true);
        setActivationKey((k) => k + 1);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Run failed');
      }
    } else {
      const data = mockRun as unknown as MockRun;
      setChunks(data.chunks);
      forRunRef.current = data;
      againstRunRef.current = data;
      setTickIndex(0);
      setLinks(data.ticks[0]?.links ?? data.links);
      setAgents(data.ticks[0]?.agents ?? []);
      setPlaying(true);
      setActivationKey((k) => k + 1);
    }
  };

  const togglePlay = () => {
    const run = tab === 'for' ? forRunRef.current : againstRunRef.current;
    if (!run) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (tickIndex >= run.ticks.length - 1) {
      applyTick(0);
      setShowResult(false);
      setPath([]);
    }
    setPlaying(true);
  };

  const stepForward = () => {
    const run = tab === 'for' ? forRunRef.current : againstRunRef.current;
    if (!run) return;
    setPlaying(false);
    if (tickIndex < run.ticks.length - 1) {
      applyTick(tickIndex + 1);
    } else {
      setShowResult(true);
      setPath(run.path);
    }
  };

  const stepBack = () => {
    const run = tab === 'for' ? forRunRef.current : againstRunRef.current;
    if (!run) return;
    setPlaying(false);
    setShowResult(false);
    setPath([]);
    if (tickIndex > 0) applyTick(tickIndex - 1);
  };

  const restart = () => {
    const run = tab === 'for' ? forRunRef.current : againstRunRef.current;
    if (!run) return;
    setShowResult(false);
    setPath([]);
    applyTick(0);
    setPlaying(true);
    setActivationKey((k) => k + 1);
  };

  const recap = useMemo(() => {
    const run = tab === 'for' ? forRunRef.current : againstRunRef.current;
    if (!run || tickIndex < 0) return null;
    const upto = run.ticks.slice(0, tickIndex + 1);
    const visited = new Set<string>();
    upto.forEach((t) => t.agents.forEach((a) => a.visited.forEach((v) => visited.add(v))));
    const current = run.ticks[tickIndex];
    const strong = current ? current.links.filter((l) => l.strength > 0.3).length : 0;
    return { visited: visited.size, strong, round: tickIndex + 1, total: run.ticks.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickIndex, tab]);

  const handleAsk = async (question: string, currentPath: string[]) => {
    if (USE_API) {
      const supportPath = tab === 'for' ? currentPath : [];
      const refutePath = tab === 'against' ? currentPath : [];
      return ask(question, supportPath, refutePath, argument);
    }
    await new Promise((r) => setTimeout(r, 800));
    const lower = question.toLowerCase();
    if (lower.includes('vendor') && lower.includes('defect')) {
      return { answer: 'Based on the vendor_email.txt thread dated March 1, 2023, the factory manager flagged an intermittent fault and the sales director instructed them to ship anyway.' };
    }
    if (lower.includes('weakest')) {
      return { answer: 'The witness statement about an internal email mentioning "skip QC" is the weakest link because the engineer could not recall the sender.' };
    }
    return { answer: 'I do not have enough evidence in the selected path to answer that question.' };
  };

  return (
    <div className="app-shell">
      <header className="top-bar glass">
        <div className="brand">
          <Sparkles className="brand-icon" size={20} />
          <span className="brand-name">Verdict</span>
        </div>
        <div className="argument-area">
          <label htmlFor="argument">Your argument</label>
          <textarea
            id="argument"
            value={argument}
            onChange={(e) => setArgument(e.target.value)}
            rows={2}
            placeholder="State the argument you want the swarm to investigate..."
          />
        </div>
        <div className="run-controls">
          <button className="run-btn" onClick={startRun} disabled={playing}>
            {playing ? (
              <><span className="spinner" /> Running...</>
            ) : (
              <><Zap size={18} /> Run swarm</>
            )}
          </button>
          <button className="replay-btn" onClick={() => setUploadOpen(true)}>
            <Upload size={15} /> Upload docs
          </button>
        </div>
      </header>

      <DocUpload
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onAnalyze={startRun}
        notify={toast}
      />

      {tickIndex >= 0 && (
        <div className="playback-bar glass">
          <div className="playback-controls">
            <button className="pb-btn" onClick={restart} title="Restart" disabled={!activeRun}>
              <RotateCcw size={16} />
            </button>
            <button className="pb-btn" onClick={stepBack} title="Step back" disabled={tickIndex <= 0}>
              <SkipBack size={16} />
            </button>
            <button className="pb-btn primary" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="pb-btn" onClick={stepForward} title="Step forward" disabled={tickIndex >= totalTicks - 1 && showResult}>
              <SkipForward size={16} />
            </button>
          </div>
          <div className="pb-progress">
            <div className="pb-track">
              <div className="pb-fill" style={{ width: `${totalTicks ? ((tickIndex + 1) / totalTicks) * 100 : 0}%` }} />
            </div>
            <span className="pb-label">Round {tickIndex + 1} / {totalTicks}</span>
          </div>
          {recap && (
            <div className="pb-recap">
              Recap — round <strong>{recap.round}</strong> of <strong>{recap.total}</strong>: agents have touched{' '}
              <strong>{recap.visited}</strong> evidence chunks and reinforced <strong>{recap.strong}</strong> strong trail
              {recap.strong === 1 ? '' : 's'} so far.
            </div>
          )}
        </div>
      )}

      <main className="workspace">
        <section className="left-stage">
          <EvidenceBoard
            chunks={tickIndex >= 0 ? visibleChunks : []}
            links={tickIndex >= 0 ? visibleLinks : []}
            agents={tickIndex >= 0 ? agents : []}
            highlightedPath={path}
            focusedChunk={focusedChunk}
            onFocusChunk={setFocusedChunk}
            tab={tab}
            onTabChange={setTab}
            activationKey={activationKey}
          />
        </section>

        <aside className="right-rail">
          <AnimatePresence>
            {showResult && (
              <motion.div
                className="rail-section result-section"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <ResultPanel
                  chunks={chunks}
                  path={path}
                  sources={activeRun?.sources ?? []}
                  contradictions={activeRun?.contradictions ?? []}
                  angles={activeRun?.angles ?? []}
                  onFocusChunk={setFocusedChunk}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="rail-section chat-section">
            <ChatPanel path={path} onAsk={handleAsk} />
          </div>
        </aside>
      </main>

      <div className="toast-stack">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className="toast glass"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
