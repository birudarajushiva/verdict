import { useState } from 'react';
import type { Chunk } from '../types.ts';
import { docColor, angleColor } from '../colors.ts';
import './ResultPanel.css';

interface ResultPanelProps {
  chunks: Chunk[];
  path: string[];
  sources: string[];
  contradictions: string[];
  angles: string[];
  onFocusChunk?: (id: string | null) => void;
}

export default function ResultPanel({ chunks, path, sources, contradictions, angles, onFocusChunk }: ResultPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const pathChunks = path.map((id) => chunks.find((c) => c.id === id)).filter(Boolean) as Chunk[];
  const contradictionChunks = contradictions.map((id) => chunks.find((c) => c.id === id)).filter(Boolean) as Chunk[];

  return (
    <div className="result-panel glass">
      <div className="result-header">
        <h3>Evidence chain</h3>
        <div className="angle-chips">
          {angles.map((a) => (
            <span key={a} className="angle-chip" style={{ color: angleColor(a), borderColor: angleColor(a) + '55' }}>
              {a}
            </span>
          ))}
        </div>
      </div>

      <div className="chain-list">
        {pathChunks.map((chunk, idx) => {
          const isExpanded = expanded[chunk.id];
          return (
            <button
              key={chunk.id}
              className="chain-item"
              onClick={() => setExpanded((prev) => ({ ...prev, [chunk.id]: !prev[chunk.id] }))}
              onMouseEnter={() => onFocusChunk?.(chunk.id)}
              onMouseLeave={() => onFocusChunk?.(null)}
            >
              <span className="chain-number" style={{ background: angleColor(angles[idx % angles.length]) + '22', color: angleColor(angles[idx % angles.length]) }}>
                {idx + 1}
              </span>
              <div className="chain-body">
                <div className="chain-doc" style={{ color: docColor(chunk.doc) }}>{chunk.doc}</div>
                <div className={`chain-text ${isExpanded ? 'expanded' : ''}`}>{chunk.text}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="sources-section">
        <h4>Sources</h4>
        <div className="source-tags">
          {sources.map((s) => (
            <span key={s} className="source-tag" style={{ color: docColor(s), borderColor: docColor(s) + '44' }}>
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="contradictions-section">
        <h4>Against your argument</h4>
        {contradictionChunks.length === 0 ? (
          <p className="empty-note">None found in this chain.</p>
        ) : (
          <div className="contradiction-list">
            {contradictionChunks.map((chunk) => (
              <button
                key={chunk.id}
                className="contradiction-item"
                onMouseEnter={() => onFocusChunk?.(chunk.id)}
                onMouseLeave={() => onFocusChunk?.(null)}
              >
                <span className="contra-doc" style={{ color: docColor(chunk.doc) }}>{chunk.doc}</span>
                <span className="contra-text">{chunk.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
