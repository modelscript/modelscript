// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import type { CanvasTile, TileAnchorSpec, TileLodTier } from "../schema/canvas-document.js";
import type { LanguageTileDescriptor } from "../tiles/registry.js";

export interface TileContentRenderProps {
  tile: CanvasTile;
  lod: TileLodTier;
  descriptor: LanguageTileDescriptor;
  isWebGlLive: boolean;
  onAnchorClick?: ((tileId: string, anchor: TileAnchorSpec) => void) | undefined;
  activeWiringSource?: { tileId: string; anchorPath: string } | null | undefined;
}

/** Deterministic PRNG for reproducible Monte Carlo preview scatter points. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function parseLeadingNumber(text: string | undefined, fallback: number): number {
  if (!text) return fallback;
  const m = /-?\d+(?:\.\d+)?/.exec(text);
  if (!m) return fallback;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : fallback;
}

function AnchorPillBar({
  tile,
  accent,
  onAnchorClick,
  activeWiringSource,
}: {
  tile: CanvasTile;
  accent: string;
  onAnchorClick?: ((tileId: string, anchor: TileAnchorSpec) => void) | undefined;
  activeWiringSource?: { tileId: string; anchorPath: string } | null | undefined;
}): React.ReactElement | null {
  const anchors = tile.pinnedAnchors ?? [];
  if (anchors.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {anchors.map((a) => {
        const isWireSrc = activeWiringSource?.tileId === tile.id && activeWiringSource?.anchorPath === a.path;
        return (
          <button
            key={a.path}
            type="button"
            title={`${a.kind}: ${a.path}${a.unit ? ` (${a.unit})` : ""}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAnchorClick?.(tile.id, a);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: 4,
              border: isWireSrc ? "1px solid #f59e0b" : `1px solid ${accent}55`,
              backgroundColor: isWireSrc ? "#f59e0b33" : "#0f172a",
              color: "#e2e8f0",
              fontSize: 10,
              cursor: "crosshair",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                backgroundColor:
                  a.kind === "fmi-output"
                    ? "#10b981"
                    : a.kind === "fmi-input"
                      ? "#38bdf8"
                      : a.kind === "requirement"
                        ? "#a855f7"
                        : accent,
              }}
            />
            <span>{a.label}</span>
            {a.currentValue && <span style={{ color: accent }}>{a.currentValue}</span>}
          </button>
        );
      })}
    </div>
  );
}

function renderSchematicPreview(tile: CanvasTile, accent: string): React.ReactElement {
  return (
    <svg viewBox="0 0 380 180" style={{ width: "100%", height: 165, background: "#090f1d", borderRadius: 6 }}>
      <defs>
        <pattern id={`grid-${tile.id}`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="380" height="180" fill={`url(#grid-${tile.id})`} />
      <rect x="26" y="54" width="84" height="58" rx="6" fill="#1e293b" stroke={accent} strokeWidth="1.8" />
      <text x="68" y="87" textAnchor="middle" fill="#e2e8f0" fontSize="11">
        {tile.languageId === "simulink" ? "PID Gain" : "DC Motor"}
      </text>
      <rect x="148" y="42" width="96" height="82" rx="6" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.8" />
      <text x="196" y="79" textAnchor="middle" fill="#e2e8f0" fontSize="11">
        {tile.languageId === "simulink" ? "Integrator" : "Gearbox"}
      </text>
      <text x="196" y="97" textAnchor="middle" fill="#94a3b8" fontSize="9">
        {tile.targetSymbol ?? tile.artifactUri.split("/").pop()}
      </text>
      <rect x="278" y="54" width="76" height="58" rx="6" fill="#1e293b" stroke="#10b981" strokeWidth="1.8" />
      <text x="316" y="87" textAnchor="middle" fill="#e2e8f0" fontSize="11">
        {tile.languageId === "simulink" ? "Clamp" : "Thermal"}
      </text>
      <path d="M 110 83 L 148 83 M 244 83 L 278 83" stroke={accent} strokeWidth="2" />
      <circle cx="110" cy="83" r="3.5" fill={accent} />
      <circle cx="148" cy="83" r="3.5" fill="#38bdf8" />
      <circle cx="244" cy="83" r="3.5" fill="#38bdf8" />
      <circle cx="278" cy="83" r="3.5" fill="#10b981" />
    </svg>
  );
}

function InteractiveEcadTile(): React.ReactElement {
  const [layers, setLayers] = useState({ fCu: true, bCu: true, silk: true });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {(
          [
            ["fCu", "F.Cu", "#ef4444"],
            ["bCu", "B.Cu", "#3b82f6"],
            ["silk", "F.SilkS", "#e2e8f0"],
          ] as const
        ).map(([key, label, color]) => (
          <button
            key={key}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
            }}
            style={{
              padding: "1px 6px",
              borderRadius: 4,
              border: `1px solid ${color}66`,
              backgroundColor: layers[key] ? `${color}33` : "#0f172a",
              color: layers[key] ? color : "#64748b",
              fontSize: 9,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <svg viewBox="0 0 380 165" style={{ width: "100%", height: 145, background: "#071a12", borderRadius: 6 }}>
        <rect x="18" y="10" width="344" height="145" rx="8" fill="#0d2e20" stroke="#f59e0b" strokeWidth="1.5" />
        {[
          [32, 24],
          [348, 24],
          [32, 141],
          [348, 141],
        ].map(([cx, cy], idx) => (
          <circle key={idx} cx={cx} cy={cy} r="6" fill="#0b1120" stroke="#fbbf24" strokeWidth="2" />
        ))}
        {layers.fCu && <path d="M 85 62 L 140 62 L 160 82 L 220 82" fill="none" stroke="#ef4444" strokeWidth="3" />}
        {layers.bCu && <path d="M 85 96 L 130 96 L 155 116 L 250 116" fill="none" stroke="#3b82f6" strokeWidth="2.5" />}
        <rect
          x="160"
          y="44"
          width="76"
          height="68"
          rx="4"
          fill="#1e293b"
          stroke={layers.silk ? "#e2e8f0" : "#334155"}
          strokeWidth="1.2"
        />
        {layers.silk && (
          <text x="198" y="82" textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="600">
            U1 DRV8353
          </text>
        )}
        <rect x="270" y="34" width="54" height="36" rx="3" fill="#1e293b" stroke="#fbbf24" strokeWidth="1.2" />
        {layers.silk && (
          <text x="297" y="56" textAnchor="middle" fill="#fbbf24" fontSize="9">
            Q1-Q6
          </text>
        )}
      </svg>
    </div>
  );
}

function renderCad3DPreview(tile: CanvasTile, isWebGlLive: boolean): React.ReactElement {
  const massLabel = tile.pinnedAnchors?.find((a) => a.path === "body.mass")?.currentValue ?? "2.14 kg";
  return (
    <svg viewBox="0 0 380 180" style={{ width: "100%", height: 165, background: "#111827", borderRadius: 6 }}>
      <defs>
        <linearGradient id={`step-metal-${tile.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="50%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <polygon
        points="190,22 295,62 295,134 190,164 85,134 85,62"
        fill={`url(#step-metal-${tile.id})`}
        stroke="#ec4899"
        strokeWidth="1.5"
      />
      <polygon points="190,22 295,62 190,96 85,62" fill="#cbd5e133" stroke="#e2e8f0" strokeWidth="1" />
      <line x1="190" y1="96" x2="190" y2="164" stroke="#e2e8f066" strokeWidth="1" />
      <ellipse cx="190" cy="60" rx="38" ry="18" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.5" />
      <circle cx="190" cy="60" r="4" fill="#38bdf8" />
      <text x="200" y="56" fill="#38bdf8" fontSize="9">
        Mass: {massLabel}
      </text>
      <text x="14" y="168" fill="#94a3b8" fontSize="9">
        {isWebGlLive ? "WebGL PBR Live (Pool Slot Active)" : "STEP Snapshot (Click to Orbit 3D)"}
      </text>
    </svg>
  );
}

function renderTablePreview(tile: CanvasTile): React.ReactElement {
  const rows = tile.pinnedAnchors ?? [];
  return (
    <div style={{ background: "#090f1d", borderRadius: 6, overflow: "hidden", border: "1px solid #1e293b" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "82px 1fr 112px",
          padding: "5px 8px",
          background: "#1e293b",
          fontSize: 10,
          fontWeight: 600,
          color: "#cbd5e1",
        }}
      >
        <span>ID</span>
        <span>Specification</span>
        <span>Verification</span>
      </div>
      {rows.map((r) => {
        const upper = (r.currentValue ?? "").toUpperCase();
        const isPass = upper.includes("PASS");
        const isFail = upper.includes("FAIL");
        return (
          <div
            key={r.path}
            style={{
              display: "grid",
              gridTemplateColumns: "82px 1fr 112px",
              padding: "6px 8px",
              borderTop: "1px solid #1e293b",
              fontSize: 11,
              alignItems: "center",
            }}
          >
            <span style={{ fontFamily: "monospace", color: "#c084fc" }}>{r.path}</span>
            <span style={{ color: "#e2e8f0" }}>{r.label}</span>
            <span
              style={{
                padding: "2px 6px",
                borderRadius: 999,
                textAlign: "center",
                fontSize: 10,
                fontWeight: 600,
                backgroundColor: isFail ? "#ef444433" : isPass ? "#05966933" : "#f59e0b33",
                color: isFail ? "#f87171" : isPass ? "#34d399" : "#fbbf24",
              }}
            >
              {r.currentValue ?? "PENDING"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function renderMonteCarloPreview(tile: CanvasTile): React.ReactElement {
  const meanMass = parseLeadingNumber(tile.pinnedAnchors?.find((a) => a.path === "input.mass")?.currentValue, 2.14);
  const rand = mulberry32(42);
  const points: { cx: number; cy: number; pass: boolean }[] = [];
  let passCount = 0;

  for (let i = 0; i < 140; i++) {
    const u1 = Math.max(1e-6, rand());
    const u2 = rand();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    const mass = meanMass + z0 * 0.14;
    const temp = 342 + (mass - 2.0) * 28 + z1 * 4.5;
    const pass = temp <= 360 && mass <= 2.5;
    if (pass) passCount += 1;

    const cx = 36 + ((mass - 1.6) / 1.4) * 320;
    const cy = 152 - ((temp - 325) / 52) * 130;
    if (cx >= 32 && cx <= 364 && cy >= 14 && cy <= 156) {
      points.push({ cx, cy, pass });
    }
  }

  const yieldPct = ((passCount / 140) * 100).toFixed(1);
  const massLimitX = 36 + ((2.5 - 1.6) / 1.4) * 320;

  return (
    <svg viewBox="0 0 380 185" style={{ width: "100%", height: 175, background: "#090f1d", borderRadius: 6 }}>
      <rect x="32" y="14" width="332" height="48" fill="#ef444418" />
      <line x1="32" y1="62" x2="364" y2="62" stroke="#ef4444" strokeWidth="1.2" strokeDasharray="4 3" />
      <line x1={massLimitX} y1="14" x2={massLimitX} y2="156" stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="4 3" />
      <text x="360" y="57" textAnchor="end" fill="#f87171" fontSize="9">
        REQ-042 Max Temp (360 K)
      </text>
      <line x1="32" y1="156" x2="364" y2="156" stroke="#475569" strokeWidth="1" />
      <line x1="32" y1="14" x2="32" y2="156" stroke="#475569" strokeWidth="1" />
      {points.map((p, idx) => (
        <circle key={idx} cx={p.cx} cy={p.cy} r="2.2" fill={p.pass ? "#14b8a6" : "#f43f5e"} opacity="0.85" />
      ))}
      <text x="198" y="175" textAnchor="middle" fill="#94a3b8" fontSize="9">
        mass={meanMass.toFixed(2)} kg vs. T_max (K) · {yieldPct}% Yield
      </text>
    </svg>
  );
}

/**
 * Default rich polyglot tile content renderer supporting all 7 archetypes
 * across 4 semantic LOD tiers.
 */
export function renderPolyglotTileContent(props: TileContentRenderProps): React.ReactNode {
  const { tile, lod, descriptor, isWebGlLive, onAnchorClick, activeWiringSource } = props;

  if (lod === "macro") {
    return (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#f8fafc" }}>{descriptor.label}</div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{tile.artifactUri}</div>
      </div>
    );
  }

  let visual: React.ReactElement;
  switch (tile.archetype) {
    case "schematic":
      visual = renderSchematicPreview(tile, descriptor.accentColor);
      break;
    case "ecad":
      visual = <InteractiveEcadTile />;
      break;
    case "cad3d":
      visual = renderCad3DPreview(tile, isWebGlLive);
      break;
    case "table":
      visual = renderTablePreview(tile);
      break;
    case "analytics":
      visual = renderMonteCarloPreview(tile);
      break;
    case "fmu":
      visual = renderSchematicPreview(tile, "#10b981");
      break;
    case "code":
    default:
      visual =
        lod === "focus" ? (
          <textarea
            onPointerDown={(e) => e.stopPropagation()}
            defaultValue={`// ${tile.artifactUri}\nmodel ${tile.targetSymbol ?? "Artifact"}\n  parameter Real k = 1.0;\nend;`}
            style={{
              width: "100%",
              height: 165,
              padding: 8,
              background: "#090f1d",
              color: "#e2e8f0",
              border: "1px solid #334155",
              borderRadius: 6,
              fontFamily: "monospace",
              fontSize: 11,
              resize: "none",
            }}
          />
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 8,
              background: "#090f1d",
              borderRadius: 6,
              fontSize: 10,
              color: "#cbd5e1",
              overflow: "hidden",
            }}
          >
            {`// ${tile.artifactUri}\nmodel ${tile.targetSymbol ?? "Artifact"}\n  parameter Real k = 1.0;\nend;`}
          </pre>
        );
      break;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {visual}
      {lod !== "thumbnail" && (
        <AnchorPillBar
          tile={tile}
          accent={descriptor.accentColor}
          onAnchorClick={onAnchorClick}
          activeWiringSource={activeWiringSource}
        />
      )}
    </div>
  );
}
