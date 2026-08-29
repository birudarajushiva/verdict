import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Eye, EyeOff } from 'lucide-react';
import ForceGraph3D, { type ForceGraphMethods, type NodeObject, type LinkObject } from 'react-force-graph-3d';
import type { Chunk, Link, Agent } from '../types.ts';
import { docColor as getDocColor, angleColor } from '../colors.ts';
import './EvidenceBoard.css';

export type SideTab = 'for' | 'against';

const glowTextureCache = new Map<string, THREE.CanvasTexture>();

function getGlowTexture(color: string) {
  const cached = glowTextureCache.get(color);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(0.3, color);
  gradient.addColorStop(1, color + '00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  glowTextureCache.set(color, texture);
  return texture;
}

interface EvidenceBoardProps {
  chunks: Chunk[];
  links: Link[];
  agents?: Agent[];
  highlightedPath?: string[];
  focusedChunk?: string | null;
  onFocusChunk?: (id: string | null) => void;
  tab?: SideTab;
  onTabChange?: (tab: SideTab) => void;
  activationKey?: number;
}

interface GraphNode extends Chunk {
  x?: number;
  y?: number;
  z?: number;
}

interface GraphLink extends Link {
  source?: string | GraphNode;
  target?: string | GraphNode;
}

interface OverlayItem {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  zoom: number;
  inFront: boolean;
}

function getLinkEndpoints(link: LinkObject<GraphNode, GraphLink>) {
  const from = typeof link.source === 'string' ? link.source : (link.source as NodeObject<GraphNode>)?.id ?? '';
  const to = typeof link.target === 'string' ? link.target : (link.target as NodeObject<GraphNode>)?.id ?? '';
  return { from: String(from), to: String(to) };
}

const tmpMid = new THREE.Vector3();

function smoothstep(x: number) {
  const c = Math.min(Math.max(x, 0), 1);
  return c * c * (3 - 2 * c);
}

const ACTIVATION_TOTAL = 2.8;

export default function EvidenceBoard({
  chunks,
  links,
  agents = [],
  highlightedPath = [],
  focusedChunk = null,
  onFocusChunk,
  tab = 'for',
  onTabChange,
  activationKey = 0,
}: EvidenceBoardProps) {
  const fgRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(undefined);
  const boardRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<THREE.Group | null>(null);
  const pathSet = useMemo(() => new Set(highlightedPath), [highlightedPath]);
  const agentsRef = useRef<Agent[]>(agents);
  agentsRef.current = agents;

  const [overlay, setOverlay] = useState<Map<string, OverlayItem>>(new Map());
  const agentGroupRef = useRef<THREE.Group | null>(null);
  const agentSpritesRef = useRef<Map<string, THREE.Sprite>>(new Map());
  const linkMaterialsRef = useRef<Map<string, THREE.MeshBasicMaterial>>(new Map());
  const pulseGroupRef = useRef<THREE.Group | null>(null);
  const pulsesRef = useRef<{ sprite: THREE.Sprite; start: number }[]>([]);
  const activationStartRef = useRef<number | null>(null);
  const nodeDelaysRef = useRef<Map<string, number>>(new Map());
  const visibleNodesRef = useRef<Set<string>>(new Set());
  const lastSigRef = useRef('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = chunks.map((c) => ({ ...c }));
    const gLinks: GraphLink[] = links.map((l) => ({ ...l })) as GraphLink[];
    return { nodes, links: gLinks };
  }, [chunks, links]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    fg.d3Force('charge')?.strength(-400);
    fg.d3Force('link')?.distance(110);
    const radial = fg.d3Force('radial');
    if (radial) {
      radial.strength(0.7);
      radial.radius(165);
    }
    fg.cameraPosition({ x: 130, y: 100, z: 320 }, { x: 0, y: 0, z: 0 });

    const scene = fg.scene();
    if (!scene.getObjectByName('bg-sphere')) {
      const hub = new THREE.Group();
      hub.name = 'bg-sphere';

      const lattice = new THREE.Mesh(
        new THREE.SphereGeometry(170, 14, 14),
        new THREE.MeshBasicMaterial({
          color: 0x3d7bfd,
          transparent: true,
          opacity: 0.18,
          wireframe: true,
          depthWrite: false,
        })
      );
      hub.add(lattice);

      const innerShell = new THREE.Mesh(
        new THREE.SphereGeometry(118, 9, 9),
        new THREE.MeshBasicMaterial({
          color: 0x1e40af,
          transparent: true,
          opacity: 0.09,
          wireframe: true,
          depthWrite: false,
        })
      );
      hub.add(innerShell);

      const rim = new THREE.Mesh(
        new THREE.SphereGeometry(176, 48, 48),
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(0x3d7bfd) } },
          vertexShader: `
            varying float vIntensity;
            void main() {
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              vec3 vNormal = normalize(normalMatrix * normal);
              vec3 vView = normalize(-mvPosition.xyz);
              vIntensity = pow(clamp(1.0 - dot(vNormal, vView), 0.0, 1.0), 2.5);
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            uniform vec3 uColor;
            varying float vIntensity;
            void main() {
              gl_FragColor = vec4(uColor, vIntensity * 0.45);
            }
          `,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      hub.add(rim);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(20, 24, 24),
        new THREE.MeshBasicMaterial({
          color: 0x2563eb,
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      hub.add(core);

      const coreHalo = new THREE.Mesh(
        new THREE.SphereGeometry(32, 24, 24),
        new THREE.MeshBasicMaterial({
          color: 0x1e40af,
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.BackSide,
        })
      );
      hub.add(coreHalo);

      hub.children.forEach((child) => {
        const m = (child as THREE.Mesh).material as THREE.Material;
        m.userData.baseOpacity = m.opacity;
      });
      hubRef.current = hub;
      scene.add(hub);
    }

    if (!scene.getObjectByName('agent-group')) {
      const agentGroup = new THREE.Group();
      agentGroup.name = 'agent-group';
      agentGroupRef.current = agentGroup;
      scene.add(agentGroup);
    }

    if (!scene.getObjectByName('pulse-group')) {
      const pulseGroup = new THREE.Group();
      pulseGroup.name = 'pulse-group';
      pulseGroupRef.current = pulseGroup;
      scene.add(pulseGroup);
    }

    return () => {};
  }, []);

  useEffect(() => {
    if (activationKey <= 0) return;
    activationStartRef.current = performance.now();
    visibleNodesRef.current = new Set();
    nodeDelaysRef.current = new Map(graphData.nodes.map((n, i) => [n.id, 0.25 + i * 0.05]));
    pulsesRef.current.forEach((p) => pulseGroupRef.current?.remove(p.sprite));
    pulsesRef.current = [];
    fgRef.current?.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationKey]);

  useEffect(() => {
    const group = agentGroupRef.current;
    if (!group) return;
    const seen = new Set<string>();
    agents.forEach((agent) => {
      seen.add(agent.id);
      const color = angleColor(agent.angle);
      let sprite = agentSpritesRef.current.get(agent.id);
      if (!sprite) {
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: getGlowTexture(color),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        );
        agentSpritesRef.current.set(agent.id, sprite);
        group.add(sprite);
      } else if ((sprite.material as THREE.SpriteMaterial).map !== getGlowTexture(color)) {
        (sprite.material as THREE.SpriteMaterial).map = getGlowTexture(color);
      }
    });
    agentSpritesRef.current.forEach((sprite, id) => {
      if (!seen.has(id)) {
        group.remove(sprite);
        agentSpritesRef.current.delete(id);
      }
    });
  }, [agents]);

  useEffect(() => {
    fgRef.current?.refresh();
  }, [agents]);

  useEffect(() => {
    if (!fgRef.current || highlightedPath.length === 0) return;
    const pathNodes = graphData.nodes.filter((n) => pathSet.has(n.id));
    if (pathNodes.length === 0) return;
    const cx = pathNodes.reduce((s, n) => s + (n.x ?? 0), 0) / pathNodes.length;
    const cy = pathNodes.reduce((s, n) => s + (n.y ?? 0), 0) / pathNodes.length;
    const cz = pathNodes.reduce((s, n) => s + (n.z ?? 0), 0) / pathNodes.length;
    fgRef.current.cameraPosition({ x: cx + 150, y: cy + 120, z: cz + 300 }, { x: cx, y: cy, z: cz }, 1400);
  }, [highlightedPath, graphData.nodes, pathSet]);

  useEffect(() => {
    let raf = 0;

    const update = () => {
      const fg = fgRef.current;
      const board = boardRef.current;
      if (!fg || !board) {
        raf = requestAnimationFrame(update);
        return;
      }

      if (hubRef.current) hubRef.current.rotation.y += 0.0004;

      const camera = fg.camera();
      const rect = board.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      const nowMs = performance.now();
      const act = activationStartRef.current;
      const t = act === null ? 0 : (nowMs - act) / 1000;

      const sphereEase = act === null ? 1 : 0.4 + 0.6 * smoothstep(t / 0.8);
      if (hubRef.current) {
        hubRef.current.children.forEach((child) => {
          const m = (child as THREE.Mesh).material as THREE.Material;
          if (m.userData.baseOpacity != null) m.opacity = m.userData.baseOpacity * sphereEase;
        });
      }

      if (act !== null) {
        let changed = false;
        graphData.nodes.forEach((node) => {
          if (visibleNodesRef.current.has(node.id)) return;
          let d = nodeDelaysRef.current.get(node.id);
          if (d === undefined) {
            d = 0.25 + nodeDelaysRef.current.size * 0.05;
            nodeDelaysRef.current.set(node.id, d);
          }
          if (t >= d) {
            visibleNodesRef.current.add(node.id);
            changed = true;
            if (pulseGroupRef.current) {
              const sprite = new THREE.Sprite(
                new THREE.SpriteMaterial({
                  map: getGlowTexture(getDocColor(node.doc)),
                  transparent: true,
                  depthWrite: false,
                  blending: THREE.AdditiveBlending,
                })
              );
              sprite.position.set(node.x ?? 0, node.y ?? 0, node.z ?? 0);
              pulseGroupRef.current.add(sprite);
              pulsesRef.current.push({ sprite, start: nowMs });
            }
          }
        });
        if (changed) fgRef.current?.refresh();

        if (t > ACTIVATION_TOTAL) {
          activationStartRef.current = null;
          fgRef.current?.refresh();
        }
      }

      for (let i = pulsesRef.current.length - 1; i >= 0; i--) {
        const pulse = pulsesRef.current[i];
        const p = (nowMs - pulse.start) / 800;
        if (p >= 1) {
          pulseGroupRef.current?.remove(pulse.sprite);
          pulsesRef.current.splice(i, 1);
        } else {
          const s = 8 + 26 * smoothstep(p);
          pulse.sprite.scale.set(s, s, 1);
          (pulse.sprite.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - p);
        }
      }

      const newOverlay = new Map<string, OverlayItem>();
      graphData.nodes.forEach((node) => {
        if (node.x == null || node.y == null || node.z == null) return;
        const vector = new THREE.Vector3(node.x, node.y, node.z);
        vector.project(camera);
        const x = (vector.x * 0.5 + 0.5) * width;
        const y = (-vector.y * 0.5 + 0.5) * height;
        const inFront = vector.z < 1;
        const isFocused = focusedChunk === node.id || hoveredId === node.id;
        const onPath = pathSet.has(node.id);
        const dimmed = highlightedPath.length > 0 && !onPath && !isFocused;
        const opacity = inFront ? (dimmed ? 0.4 : 1) : 0.08;
        const scale = isFocused ? 1.12 : onPath ? 1.06 : 1;
        const dist = camera.position.distanceTo(tmpMid.set(node.x, node.y, node.z));
        const zoom = Math.min(1.8, Math.max(0.35, 360 / dist));
        newOverlay.set(node.id, { x, y, opacity, scale, zoom, inFront });
      });

      let sig = '';
      newOverlay.forEach((o, id) => {
        sig += id + (o.x | 0) + ',' + (o.y | 0) + ',' + Math.round(o.zoom * 100) + ',' + (o.inFront ? 1 : 0) + ';';
      });
      if (sig !== lastSigRef.current) {
        lastSigRef.current = sig;
        setOverlay(newOverlay);
      }

      const time = performance.now() / 1000;
      agentsRef.current.forEach((agent, i) => {
        const sprite = agentSpritesRef.current.get(agent.id);
        if (!sprite) return;
        const node = graphData.nodes.find((n) => n.id === agent.at);
        if (!node || node.x == null || node.y == null || node.z == null) {
          sprite.visible = false;
          return;
        }
        sprite.visible = true;
        const v = new THREE.Vector3(node.x, node.y, node.z);
        v.x += Math.sin(time * 0.6 + i * 2.1) * 6;
        v.y += Math.sin(time * 0.5 + i * 1.7) * 6;
        v.z += Math.cos(time * 0.7 + i * 1.3) * 6;
        if (v.length() > 160) v.setLength(160);
        sprite.position.copy(v);

        const dist = camera.position.distanceTo(v);
        const depth = THREE.MathUtils.clamp(1 - (dist - 150) / 400, 0.45, 1);
        const agentGate = act === null ? 1 : smoothstep((t - (0.9 + i * 0.12)) / 0.5);
        const material = sprite.material as THREE.SpriteMaterial;
        material.opacity = depth * agentGate;
        const size = 13 * (0.8 + 0.35 * depth) * (0.5 + 0.5 * agentGate);
        sprite.scale.set(size, size, 1);
      });

      const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));
      linkMaterialsRef.current.forEach((material, key) => {
        const [from, to] = key.split('|');
        const a = nodeById.get(from);
        const b = nodeById.get(to);
        if (!a || a.x == null || a.y == null || a.z == null || !b || b.x == null || b.y == null || b.z == null) return;
        tmpMid.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        const dist = camera.position.distanceTo(tmpMid);
        const linkDepth = THREE.MathUtils.clamp(1 - (dist - 200) / 600, 0.35, 1);
        const base = material.userData.baseOpacity ?? 0.5;
        if (act === null) {
          material.opacity = base * linkDepth;
          return;
        }
        const linkStart = Math.max(nodeDelaysRef.current.get(from) ?? 0, nodeDelaysRef.current.get(to) ?? 0) + 0.25;
        const p = smoothstep((t - linkStart) / 0.6);
        const spark = p > 0 && p < 1 ? 0.25 * Math.sin(p * Math.PI) : 0;
        material.opacity = Math.min(1, base * linkDepth * p + spark);
      });

      raf = requestAnimationFrame(update);
    };

    raf = requestAnimationFrame(update);
    // Fallback for environments where requestAnimationFrame is throttled (e.g. hidden tab).
    const interval = window.setInterval(() => {
      if (document.hidden) update();
    }, 200);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  }, [graphData.nodes, focusedChunk, hoveredId, highlightedPath, pathSet]);

  const linkMaterial = (link: LinkObject<GraphNode, GraphLink>) => {
    const { from, to } = getLinkEndpoints(link);
    const key = `${from}|${to}`;
    let material = linkMaterialsRef.current.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      linkMaterialsRef.current.set(key, material);
    }
    const isPathLink = pathSet.has(from) && pathSet.has(to) &&
      Math.abs(highlightedPath.indexOf(from) - highlightedPath.indexOf(to)) === 1;
    if (isPathLink) {
      material.color.set('#ffd700');
      material.userData.baseOpacity = 0.85;
    } else if (highlightedPath.length > 0) {
      material.color.set('#3a4c66');
      material.userData.baseOpacity = 0.12;
    } else {
      material.color.set('#5fb6ff');
      material.userData.baseOpacity = 0.4 + link.strength * 0.55;
    }
    material.opacity = material.userData.baseOpacity;
    return material;
  };

  const linkWidth = (link: LinkObject<GraphNode, GraphLink>) => {
    const { from, to } = getLinkEndpoints(link);
    const isPathLink = pathSet.has(from) && pathSet.has(to) &&
      Math.abs(highlightedPath.indexOf(from) - highlightedPath.indexOf(to)) === 1;
    if (isPathLink) return 1.8;
    return 0.5 + link.strength * 1.8;
  };

  useEffect(() => {
    const keys = new Set(graphData.links.map((l) => `${l.from}|${l.to}`));
    linkMaterialsRef.current.forEach((material, key) => {
      if (!keys.has(key)) {
        material.dispose();
        linkMaterialsRef.current.delete(key);
      }
    });
  }, [graphData.links]);

  const linkDirectionalParticles = (link: LinkObject<GraphNode, GraphLink>) => {
    const { from, to } = getLinkEndpoints(link);
    const isPathLink = pathSet.has(from) && pathSet.has(to) &&
      Math.abs(highlightedPath.indexOf(from) - highlightedPath.indexOf(to)) === 1;
    return isPathLink ? 3 : 0;
  };

  const isCardVisible = (id: string) => showAll || hoveredId === id || focusedChunk === id;

  return (
    <div className="evidence-board" ref={boardRef}>
      <div className="board-header">
        <h2>Neural Evidence Mesh</h2>
        <span className="hint">Drag to rotate • Scroll to zoom • Right-drag to pan</span>
      </div>

      {onTabChange && (
        <div className="side-tabs" role="tablist" aria-label="Evidence side">
          <button
            role="tab"
            aria-selected={tab === 'for'}
            className={`side-tab ${tab === 'for' ? 'active' : ''}`}
            onClick={() => onTabChange('for')}
          >
            For
          </button>
          <button
            role="tab"
            aria-selected={tab === 'against'}
            className={`side-tab against ${tab === 'against' ? 'active' : ''}`}
            onClick={() => onTabChange('against')}
          >
            Against
          </button>
        </div>
      )}

      <button
        className={`show-all-btn ${showAll ? 'on' : ''}`}
        onClick={() => setShowAll((s) => !s)}
        aria-pressed={showAll}
      >
        {showAll ? <EyeOff size={14} /> : <Eye size={14} />}
        {showAll ? 'Hide All' : 'Show All'}
      </button>

      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        nodeId="id"
        nodeRelSize={6}
        nodeColor={(node: GraphNode) => getDocColor(node.doc)}
        nodeOpacity={0.85}
        nodeLabel={() => ''}
        nodeVisibility={(node) =>
          activationStartRef.current === null || visibleNodesRef.current.has((node as GraphNode).id)}
        linkSource="from"
        linkTarget="to"
        linkMaterial={linkMaterial}
        linkWidth={linkWidth}
        linkDirectionalParticles={linkDirectionalParticles}
        linkDirectionalParticleSpeed={0.008}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleColor={() => '#ffd700'}
        backgroundColor="rgba(0,0,0,0)"
        showNavInfo={false}
        warmupTicks={40}
        cooldownTicks={80}
        onNodeHover={(node) => {
          const id = node ? (node as GraphNode).id : null;
          setHoveredId(id);
          onFocusChunk?.(id);
        }}
        onNodeClick={(node) => onFocusChunk?.((node as GraphNode).id)}
      />

      <div className="node-overlay-layer">
        {graphData.nodes.map((node) => {
          const pos = overlay.get(node.id);
          if (!pos || !isCardVisible(node.id)) return null;
          const isFocused = focusedChunk === node.id || hoveredId === node.id;
          const onPath = pathSet.has(node.id);
          const dimmed = highlightedPath.length > 0 && !onPath && !isFocused;
          return (
            <div
              key={node.id}
              className={`node-card glass ${isFocused ? 'focused' : ''} ${onPath ? 'path' : ''} ${dimmed ? 'dimmed' : ''} ${!pos.inFront ? 'behind' : ''}`}
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px) translate(${12 * pos.zoom}px, 0) scale(${pos.zoom * pos.scale})`,
                opacity: pos.opacity,
                borderColor: getDocColor(node.doc),
              }}
            >
              <div className="node-card-doc" style={{ color: getDocColor(node.doc) }}>{node.doc}</div>
              <div className="node-card-text">{node.text}</div>
            </div>
          );
        })}
      </div>

      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="board-legend glass">
      <div className="legend-title">Legend</div>
      <div className="legend-row"><span className="chip" style={{ borderColor: '#00f0ff' }} /> Document color</div>
      <div className="legend-row"><span className="line" style={{ background: 'rgba(90,150,255,0.8)' }} /> Trail strength</div>
      <div className="legend-row"><span className="dot" style={{ background: '#a855f7' }} /> Search angle</div>
      <div className="legend-row"><span className="line gold" /> Evidence chain</div>
    </div>
  );
}
