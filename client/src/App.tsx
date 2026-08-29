import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Sparkles, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EvidenceBoard, { type SideTab } from './components/EvidenceBoard.tsx';
import ResultPanel from './components/ResultPanel.tsx';
import ChatPanel from './components/ChatPanel.tsx';
import { fetchGraph, runSwarm, ask } from './api.ts';
import type { Chunk, Link, Agent, RunResult } from '@shared/types.ts';
import mockRun from './mock/run.json';
import './App.css';

const USE_API = import.meta.env.VITE_USE_API === 'true';
const AGAINST_THRESHOLD = 0.12;
const DEMO_ARGUMENT = 'The vendor knowingly shipped a defective product to meet its quarterly revenue target, while hiding internal quality-control waivers from the customer.';

interface Toast {
  id: number;
  message: string;
}

export default function App() {
  const [argument, setArgument] = useState(DEMO_ARGUMENT);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [angles, setAngles] = useState<string[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [contradictions, setContradictions] = useState<string[]>([]);
  const [tickIndex, setTickIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [focusedChunk, setFocusedChunk] = useState<string | null>(null);
  const [tab, setTab] = useState<SideTab>('for');
  const [activationKey, setActivationKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const runResultRef = useRef<RunResult | null>(null);

  const toast = (message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  };

  useEffect(() => {
    const data = mockRun as unknown as RunResult & { chunks: Chunk[]; links: Link[] };
    setChunks(data.chunks);
    setLinks(data.links);
    setAngles(data.angles);
    runResultRef.current = data;
  }, []);

  const { forData, againstData } = useMemo(() => {
    const forChunks = chunks.filter((c) => c.against < AGAINST_THRESHOLD);
    const againstChunks = chunks.filter((c) => c.against >= AGAINST_THRESHOLD);
    const forIds = new Set(forChunks.map((c) => c.id));
    const againstIds = new Set(againstChunks.map((c) => c.id));
    const forLinks = links.filter((l) => forIds.has(l.from) && forIds.has(l.to));
    const againstLinks = links.filter((l) => againstIds.has(l.from) && againstIds.has(l.to));
    return {
      forData: { chunks: forChunks, links: forLinks },
      againstData: { chunks: againstChunks, links: againstLinks },
    };
  }, [chunks, links]);

  const activeData = tab === 'for' ? forData : againstData;

  const totalTicks = runResultRef.current?.ticks.length ?? 0;

  const applyTick = (i: number) => {
    const r = runResultRef.current;
    if (!r) return;
    const tick = r.ticks[i];
    if (!tick) return;
    setTickIndex(i);
    setLinks(tick.links);
    setAgents(tick.agents);
  };

  useEffect(() => {
    if (!playing || !runResultRef.current) return;
    if (tickIndex >= runResultRef.current.ticks.length - 1) {
      setPlaying(false);
      setShowResult(true);
      setPath(runResultRef.current.path);
      return;
    }
    const timer = setTimeout(() => applyTick(tickIndex + 1), 800);
    return () => clearTimeout(timer);
  }, [playing, tickIndex]);

  const startRun = async () => {
    setPlaying(false);
    setShowResult(false);
    setTickIndex(-1);
    setPath([]);

    if (USE_API) {
      try {
        const graph = await fetchGraph();
        setChunks(graph.chunks);
        setLinks(graph.links);
        const result = await runSwarm(argument);
        runResultRef.current = result;
        setAngles(result.angles);
        setSources(result.sources);
        setContradictions(result.contradictions);
        setTickIndex(0);
        setLinks(result.ticks[0]?.links ?? graph.links);
        setAgents(result.ticks[0]?.agents ?? []);
        setPlaying(true);
        setActivationKey((k) => k + 1);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Run failed');
      }
    } else {
      const data = mockRun as unknown as RunResult & { chunks: Chunk[]; links: Link[] };
      setChunks(data.chunks);
      setAngles(data.angles);
      setSources(data.sources);
      setContradictions(data.contradictions);
      runResultRef.current = data;
      setTickIndex(0);
      setLinks(data.ticks[0]?.links ?? data.links);
      setAgents(data.ticks[0]?.agents ?? []);
      setPlaying(true);
      setActivationKey((k) => k + 1);
    }
  };

  const togglePlay = () => {
    if (!runResultRef.current) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (tickIndex >= runResultRef.current.ticks.length - 1) {
      applyTick(0);
      setShowResult(false);
      setPath([]);
    }
    setPlaying(true);
  };

  const stepForward = () => {
    if (!runResultRef.current) return;
    setPlaying(false);
    if (tickIndex < runResultRef.current.ticks.length - 1) {
      applyTick(tickIndex + 1);
    } else {
      setShowResult(true);
      setPath(runResultRef.current.path);
    }
  };

  const stepBack = () => {
    if (!runResultRef.current) return;
    setPlaying(false);
    setShowResult(false);
    setPath([]);
    if (tickIndex > 0) applyTick(tickIndex - 1);
  };

  const restart = () => {
    if (!runResultRef.current) return;
    setShowResult(false);
    setPath([]);
    applyTick(0);
    setPlaying(true);
    setActivationKey((k) => k + 1);
  };

  const recap = useMemo(() => {
    const r = runResultRef.current;
    if (!r || tickIndex < 0) return null;
    const upto = r.ticks.slice(0, tickIndex + 1);
    const visited = new Set<string>();
    upto.forEach((t) => t.agents.forEach((a) => a.visited.forEach((v) => visited.add(v))));
    const current = r.ticks[tickIndex];
    const strong = current ? current.links.filter((l) => l.strength > 0.3).length : 0;
    return { visited: visited.size, strong, round: tickIndex + 1, total: r.ticks.length };
  }, [tickIndex]);

  const handleAsk = async (question: string, currentPath: string[]) => {
    if (USE_API) return ask(question, currentPath);
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
        </div>
      </header>

      {tickIndex >= 0 && (
        <div className="playback-bar glass">
          <div className="playback-controls">
            <button className="pb-btn" onClick={restart} title="Restart" disabled={!runResultRef.current}>
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
            chunks={activeData.chunks}
            links={activeData.links}
            agents={agents}
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
                  sources={sources}
                  contradictions={contradictions}
                  angles={angles}
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
