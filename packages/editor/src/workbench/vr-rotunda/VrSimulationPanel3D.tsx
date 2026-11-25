// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ThreeEvent } from "@react-three/fiber";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { DiagramLanguageTheme } from "./diagram-language-theme.js";
import type { RotundaSimulationData } from "./types.js";
import {
  computeSeriesYBounds,
  extractVrSimulationDataset,
  formatEngineeringValue,
  getSimulationVariableColor,
  hitTestVrSimulationPanel,
  sampleSeriesAtTime,
  VR_SIM_CANVAS_H,
  VR_SIM_CANVAS_W,
  VR_SIM_PLOT_RECT,
  VR_SIM_RACK_RECT,
  VR_SIM_VAR_ROWS_PER_PAGE,
  type VrSimPlotLayout,
} from "./vr-simulation-logic.js";
import { pulseEventHaptic } from "./xr-handle.js";
import type { RotundaCueKind } from "./xr-session.js";

const UI_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace";

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function createCurvedSimGeometry(width: number, height: number, curveDepth: number): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(width, height, 24, 1);
  const pos = geom.attributes["position"];
  if (pos) {
    const halfW = width * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = x / halfW;
      pos.setZ(i, curveDepth * (t * t));
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
  }
  return geom;
}

export interface VrSimulationPanel3DProps {
  visible: boolean;
  fileName: string;
  theme: DiagramLanguageTheme;
  simulationData?: RotundaSimulationData | undefined;
  simulationTime: number;
  isPlaying: boolean;
  centered?: boolean | undefined;
  onTogglePlaying: () => void;
  onSeekSimulationTime: (t: number) => void;
  onClose: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

/**
 * Curved, stereo-safe 3D VR Simulation & Multi-Channel Oscilloscope Theater.
 * Lets engineers run Modelica / PSCAD / PSS/E / SPICE simulations directly in VR,
 * toggle plotted variables on/off, switch Overlay vs Stacked lanes, and scrub
 * simulation time in sync with 3D model animation.
 */
export function VrSimulationPanel3D({
  visible,
  fileName,
  theme,
  simulationData,
  simulationTime,
  isPlaying,
  centered = false,
  onTogglePlaying,
  onSeekSimulationTime,
  onClose,
  onCue,
}: VrSimulationPanel3DProps): React.ReactElement | null {
  const [plotLayout, setPlotLayout] = useState<VrSimPlotLayout>("overlay");
  const [pageOffset, setPageOffset] = useState(0);
  const [localSelectedVars, setLocalSelectedVars] = useState<string[] | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const lastPressRef = useRef<{ key: string; atMs: number }>({ key: "", atMs: 0 });

  // Reset local overrides when switching files or when host supplies a new variable list
  useEffect(() => {
    setPageOffset(0);
    setLocalSelectedVars(null);
  }, [fileName]);

  const effectiveSelectedVars = useMemo(() => {
    if (localSelectedVars !== null) return localSelectedVars;
    if (simulationData?.selectedVariables && simulationData.selectedVariables.length > 0) {
      return simulationData.selectedVariables;
    }
    return undefined;
  }, [localSelectedVars, simulationData?.selectedVariables]);

  const dataset = useMemo(
    () => extractVrSimulationDataset(simulationData?.rows, simulationData?.variables, effectiveSelectedVars),
    [simulationData?.rows, simulationData?.variables, effectiveSelectedVars],
  );

  const clampedTime = useMemo(() => {
    if (dataset.times.length === 0) return simulationTime;
    const span = dataset.tMax - dataset.tMin;
    if (span <= 0) return dataset.tMin;
    const wrapped = dataset.tMin + ((((simulationTime - dataset.tMin) % span) + span) % span);
    return simulationTime >= dataset.tMin && simulationTime <= dataset.tMax ? simulationTime : wrapped;
  }, [dataset.times.length, dataset.tMin, dataset.tMax, simulationTime]);

  const maxPageOffset = Math.max(0, dataset.allVariables.length - VR_SIM_VAR_ROWS_PER_PAGE);
  const clampedPageOffset = Math.min(pageOffset, maxPageOffset);

  const panelGeom = useMemo(
    () => createCurvedSimGeometry(centered ? 1.56 : 1.16, centered ? 0.91 : 0.68, centered ? 0.095 : 0.055),
    [centered],
  );

  useEffect(() => {
    return () => {
      panelGeom.dispose();
    };
  }, [panelGeom]);

  const canvasBundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = VR_SIM_CANVAS_W;
    canvas.height = VR_SIM_CANVAS_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);

  useEffect(() => {
    return () => {
      canvasBundle?.texture.dispose();
    };
  }, [canvasBundle]);

  // Paint the high-DPI 3D Simulation Oscilloscope & Channel Rack texture
  useEffect(() => {
    if (!visible || !canvasBundle?.ctx) return;
    const ctx = canvasBundle.ctx;
    ctx.clearRect(0, 0, VR_SIM_CANVAS_W, VR_SIM_CANVAS_H);

    // Outer obsidian studio housing
    drawRoundedRect(ctx, 6, 6, VR_SIM_CANVAS_W - 12, VR_SIM_CANVAS_H - 12, 24);
    ctx.fillStyle = "rgba(8, 14, 28, 0.95)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.accentColor;
    ctx.stroke();

    // ── Header Bar ──────────────────────────────────────────────────────────
    drawRoundedRect(ctx, 18, 16, VR_SIM_CANVAS_W - 36, 72, 16);
    ctx.fillStyle = theme.headerBg;
    ctx.fill();

    // Language badge
    drawRoundedRect(ctx, 30, 30, 152, 44, 10);
    ctx.fillStyle = theme.accentColor;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 18px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(theme.badgeLabel, 106, 52);

    // Title + Solver status
    ctx.textAlign = "left";
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 22px ${UI_FONT}`;
    const shortFile = fileName.length > 26 ? `…${fileName.slice(-25)}` : fileName;
    ctx.fillText(`VR Simulation · ${shortFile}`, 200, 42);

    const status = simulationData?.status?.status ?? (dataset.times.length > 0 ? "completed" : "idle");
    const isRunning = status === "running" || status === "pending" || status === "processing";
    const isErr = status === "failed" || status === "error";
    const statusText = isRunning
      ? `◌ Solving ${theme.badgeLabel}…`
      : isErr
        ? `✕ ${simulationData?.status?.error?.slice(0, 42) || "Simulation error"}`
        : dataset.times.length > 0
          ? `● ${dataset.times.length} samples · ${dataset.activeVariables.length}/${dataset.allVariables.length} channels plotted`
          : "○ Ready — press Run Simulation";
    ctx.fillStyle = isErr ? "#f87171" : isRunning ? "#fbbf24" : dataset.times.length > 0 ? "#34d399" : "#94a3b8";
    ctx.font = `600 16px ${MONO_FONT}`;
    ctx.fillText(statusText, 200, 68);

    // ▶ Run Simulation Button
    drawRoundedRect(ctx, 756, 26, 264, 50, 12);
    ctx.fillStyle = isRunning ? "#d97706" : "#059669";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 20px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(isRunning ? "◌ Solving…" : "▶ Run Simulation", 888, 52);

    // Overlay / Stacked Layout Toggle Button
    drawRoundedRect(ctx, 1034, 26, 252, 50, 12);
    ctx.fillStyle = "rgba(30, 41, 59, 0.92)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#38bdf8";
    ctx.stroke();
    ctx.fillStyle = "#e0f2fe";
    ctx.font = `700 18px ${UI_FONT}`;
    ctx.fillText(plotLayout === "overlay" ? "◫ Mode: Overlay" : "☰ Mode: Stacked", 1160, 52);

    // Close Button
    drawRoundedRect(ctx, 1300, 26, 84, 50, 12);
    ctx.fillStyle = "rgba(185, 28, 28, 0.88)";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 22px ${UI_FONT}`;
    ctx.fillText("✕", 1342, 52);

    // ── Oscilloscope Plot Canvas ────────────────────────────────────────────
    const { x: px, y: py, w: pw, h: ph } = VR_SIM_PLOT_RECT;
    drawRoundedRect(ctx, px, py, pw, ph, 14);
    ctx.fillStyle = "#060c1a";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.stroke();

    if (dataset.times.length < 2 || dataset.series.length === 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#94a3b8";
      ctx.font = `700 24px ${UI_FONT}`;
      ctx.fillText(
        dataset.times.length < 2
          ? `Press "▶ Run Simulation" to solve this ${theme.badgeLabel} model`
          : "Select one or more variables from the channel rack →",
        px + pw * 0.5,
        py + ph * 0.46,
      );
      ctx.fillStyle = "#64748b";
      ctx.font = `500 18px ${UI_FONT}`;
      ctx.fillText(
        "Supports Modelica, PSCAD, PSS/E, SPICE & polyglot solvers · Click plot to scrub 3D animation",
        px + pw * 0.5,
        py + ph * 0.54,
      );
    } else {
      const tSpan = Math.max(1e-9, dataset.tMax - dataset.tMin);
      const mapX = (t: number) => px + ((t - dataset.tMin) / tSpan) * pw;
      const playheadX = mapX(clampedTime);

      // Vertical time grid lines
      ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
      ctx.lineWidth = 1;
      for (let g = 0; g <= 5; g++) {
        const gx = px + (g / 5) * pw;
        ctx.beginPath();
        ctx.moveTo(gx, py);
        ctx.lineTo(gx, py + ph);
        ctx.stroke();

        const tTick = dataset.tMin + (g / 5) * tSpan;
        ctx.fillStyle = "#94a3b8";
        ctx.font = `600 14px ${MONO_FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(`${formatEngineeringValue(tTick)}s`, gx, py + ph + 18);
      }

      if (plotLayout === "overlay") {
        const { yMin, yMax } = computeSeriesYBounds(dataset.series);
        const ySpan = Math.max(1e-9, yMax - yMin);
        const mapY = (v: number) => py + ph - ((v - yMin) / ySpan) * ph;

        // Horizontal Y grid + ticks
        for (let g = 0; g <= 4; g++) {
          const gy = py + (g / 4) * ph;
          ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
          ctx.beginPath();
          ctx.moveTo(px, gy);
          ctx.lineTo(px + pw, gy);
          ctx.stroke();

          const yTick = yMax - (g / 4) * ySpan;
          ctx.fillStyle = "#94a3b8";
          ctx.font = `600 14px ${MONO_FONT}`;
          ctx.textAlign = "right";
          ctx.fillText(formatEngineeringValue(yTick), px - 10, gy + 4);
        }

        // Traces
        for (const s of dataset.series) {
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let i = 0; i < dataset.times.length; i++) {
            const x = mapX(dataset.times[i]!);
            const y = mapY(s.values[i] ?? 0);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // Live dot at playhead
          const liveVal = sampleSeriesAtTime(dataset.times, s.values, clampedTime);
          if (Number.isFinite(liveVal)) {
            const dy = mapY(liveVal);
            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(playheadX, dy, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      } else {
        // Stacked multi-lane oscilloscope (independent Y-axis per toggled variable!)
        const laneCount = dataset.series.length;
        const laneGap = 10;
        const laneH = (ph - laneGap * (laneCount - 1)) / laneCount;

        dataset.series.forEach((s, laneIdx) => {
          const ly = py + laneIdx * (laneH + laneGap);
          const { yMin, yMax } = computeSeriesYBounds([s]);
          const ySpan = Math.max(1e-9, yMax - yMin);
          const mapY = (v: number) => ly + laneH - ((v - yMin) / ySpan) * laneH;

          // Subtle lane separator
          if (laneIdx > 0) {
            ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, ly - laneGap * 0.5);
            ctx.lineTo(px + pw, ly - laneGap * 0.5);
            ctx.stroke();
          }

          // Lane min/max Y ticks
          ctx.fillStyle = s.color;
          ctx.font = `700 13px ${MONO_FONT}`;
          ctx.textAlign = "right";
          ctx.fillText(formatEngineeringValue(yMax), px - 8, ly + 14);
          ctx.fillText(formatEngineeringValue(yMin), px - 8, ly + laneH - 4);

          // Lane label
          ctx.textAlign = "left";
          ctx.fillStyle = s.color;
          ctx.font = `700 15px ${MONO_FONT}`;
          ctx.fillText(s.name, px + 12, ly + 18);

          // Trace
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 2.8;
          ctx.beginPath();
          for (let i = 0; i < dataset.times.length; i++) {
            const x = mapX(dataset.times[i]!);
            const y = mapY(s.values[i] ?? 0);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // Live dot at playhead
          const liveVal = sampleSeriesAtTime(dataset.times, s.values, clampedTime);
          if (Number.isFinite(liveVal)) {
            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(playheadX, mapY(liveVal), 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        });
      }

      // Vertical cyan playhead scrubber line
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, py);
      ctx.lineTo(playheadX, py + ph);
      ctx.stroke();
    }

    // ── Right Variable Toggle Channel Rack ──────────────────────────────────
    const { x: rx, y: ry, w: rw, h: rh } = VR_SIM_RACK_RECT;
    drawRoundedRect(ctx, rx, ry, rw, rh, 14);
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
    ctx.stroke();

    // Quick action buttons at top of rack: [Top 4] [Clear] [▲] [▼]
    const drawRackBtn = (bx: number, bw: number, label: string, disabled = false) => {
      drawRoundedRect(ctx, bx, ry + 8, bw, 40, 9);
      ctx.fillStyle = disabled ? "rgba(30, 41, 59, 0.5)" : "rgba(51, 65, 85, 0.9)";
      ctx.fill();
      ctx.fillStyle = disabled ? "#64748b" : "#f8fafc";
      ctx.font = `700 15px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, bx + bw * 0.5, ry + 28);
    };
    drawRackBtn(rx + 12, 102, "Top 4", dataset.allVariables.length === 0);
    drawRackBtn(rx + 122, 94, "Clear", dataset.activeVariables.length === 0);
    drawRackBtn(rx + 236, 70, "▲", clampedPageOffset <= 0);
    drawRackBtn(rx + 314, 70, "▼", clampedPageOffset >= maxPageOffset);

    // Variable toggle chips
    const activeSet = new Set(dataset.activeVariables);
    const listTop = ry + 62;
    const rowH = 56;
    const seriesByName = new Map(dataset.series.map((s) => [s.name, s]));

    if (dataset.allVariables.length === 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#64748b";
      ctx.font = `600 17px ${UI_FONT}`;
      ctx.fillText("No signals yet", rx + rw * 0.5, ry + 140);
    } else {
      for (let i = 0; i < VR_SIM_VAR_ROWS_PER_PAGE; i++) {
        const varName = dataset.allVariables[clampedPageOffset + i];
        if (!varName) break;
        const cy = listTop + i * rowH;
        const isActive = activeSet.has(varName);
        const color = getSimulationVariableColor(varName, dataset.allVariables);

        drawRoundedRect(ctx, rx + 12, cy, rw - 24, 48, 10);
        ctx.fillStyle = isActive ? "rgba(30, 41, 59, 0.95)" : "rgba(15, 23, 42, 0.65)";
        ctx.fill();
        ctx.lineWidth = isActive ? 2.5 : 1.5;
        ctx.strokeStyle = isActive ? color : "rgba(71, 85, 105, 0.5)";
        ctx.stroke();

        // Color dot / checkbox
        ctx.fillStyle = isActive ? color : "#475569";
        ctx.beginPath();
        ctx.arc(rx + 32, cy + 24, 9, 0, Math.PI * 2);
        ctx.fill();
        if (isActive) {
          ctx.fillStyle = "#060c1a";
          ctx.font = `900 13px ${UI_FONT}`;
          ctx.textAlign = "center";
          ctx.fillText("✓", rx + 32, cy + 25);
        }

        // Variable name
        ctx.textAlign = "left";
        ctx.fillStyle = isActive ? "#f8fafc" : "#94a3b8";
        ctx.font = `700 16px ${MONO_FONT}`;
        const cleanName = varName.length > 18 ? `${varName.slice(0, 17)}…` : varName;
        ctx.fillText(cleanName, rx + 50, cy + 24);

        // Live digital value at current playhead t
        const s = seriesByName.get(varName);
        if (s && dataset.times.length > 0) {
          const val = sampleSeriesAtTime(dataset.times, s.values, clampedTime);
          ctx.textAlign = "right";
          ctx.fillStyle = color;
          ctx.font = `700 15px ${MONO_FONT}`;
          ctx.fillText(formatEngineeringValue(val), rx + rw - 22, cy + 24);
        }
      }
    }

    // ── Bottom Transport & Scrubber Bar ─────────────────────────────────────
    drawRoundedRect(ctx, 84, 740, 132, 52, 12);
    ctx.fillStyle = "rgba(30, 41, 59, 0.9)";
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `700 18px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("⏮ 0.0s", 150, 766);

    drawRoundedRect(ctx, 228, 740, 176, 52, 12);
    ctx.fillStyle = isPlaying ? "#0284c7" : "#334155";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 18px ${UI_FONT}`;
    ctx.fillText(isPlaying ? "⏸ Pause" : "▶ Play", 316, 766);

    // Timeline scrubber rail
    const barX = 428;
    const barW = 536;
    drawRoundedRect(ctx, barX, 760, barW, 12, 6);
    ctx.fillStyle = "#1e293b";
    ctx.fill();

    const normT =
      dataset.tMax > dataset.tMin
        ? Math.max(0, Math.min(1, (clampedTime - dataset.tMin) / (dataset.tMax - dataset.tMin)))
        : 0;
    drawRoundedRect(ctx, barX, 760, Math.max(12, barW * normT), 12, 6);
    ctx.fillStyle = "#22d3ee";
    ctx.fill();

    ctx.textAlign = "left";
    ctx.fillStyle = "#bae6fd";
    ctx.font = `700 18px ${MONO_FONT}`;
    ctx.fillText(`t = ${formatEngineeringValue(clampedTime)}s / ${formatEngineeringValue(dataset.tMax)}s`, 988, 766);

    canvasBundle.texture.needsUpdate = true;
  }, [
    visible,
    canvasBundle,
    theme,
    fileName,
    simulationData?.status,
    dataset,
    clampedTime,
    plotLayout,
    clampedPageOffset,
    maxPageOffset,
    isPlaying,
  ]);

  const handleToggleVar = useCallback(
    (variable: string) => {
      if (simulationData?.onToggleVariable) {
        setLocalSelectedVars(null);
        simulationData.onToggleVariable(variable);
      } else {
        setLocalSelectedVars((prev) => {
          const cur = prev ?? [...dataset.activeVariables];
          return cur.includes(variable) ? cur.filter((v) => v !== variable) : [...cur, variable];
        });
      }
    },
    [simulationData, dataset.activeVariables],
  );

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!visible || !e.uv) return;
      e.stopPropagation();
      const px = e.uv.x * VR_SIM_CANVAS_W;
      const py = (1 - e.uv.y) * VR_SIM_CANVAS_H;
      const hit = hitTestVrSimulationPanel(px, py, dataset.allVariables, clampedPageOffset);
      if (!hit) return;

      if (hit.kind === "scrub-plot") {
        setIsScrubbing(true);
        const nextT = dataset.tMin + hit.normT * (dataset.tMax - dataset.tMin);
        onSeekSimulationTime(nextT);
        pulseEventHaptic(e, 0.08, 6);
        return;
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const key = hit.kind === "toggle-var" ? `var:${hit.variable}` : hit.kind;
      if (lastPressRef.current.key === key && now - lastPressRef.current.atMs < 130) return;
      lastPressRef.current = { key, atMs: now };
      pulseEventHaptic(e, 0.14, 10);

      switch (hit.kind) {
        case "run":
          onCue?.("materialize");
          simulationData?.onRunSimulation?.();
          break;
        case "toggle-layout":
          onCue?.("click");
          setPlotLayout((prev) => (prev === "overlay" ? "stacked" : "overlay"));
          break;
        case "close":
          onCue?.("click");
          onClose();
          break;
        case "play-pause":
          onCue?.("click");
          onTogglePlaying();
          break;
        case "reset-time":
          onCue?.("snap");
          onSeekSimulationTime(dataset.tMin);
          break;
        case "vars-up":
          onCue?.("tick");
          setPageOffset((p) => Math.max(0, p - 4));
          break;
        case "vars-down":
          onCue?.("tick");
          setPageOffset((p) => Math.min(maxPageOffset, p + 4));
          break;
        case "vars-top4":
          onCue?.("click");
          setLocalSelectedVars(dataset.allVariables.slice(0, 4));
          break;
        case "vars-clear":
          onCue?.("click");
          setLocalSelectedVars([]);
          break;
        case "toggle-var":
          onCue?.("tick");
          handleToggleVar(hit.variable);
          break;
      }
    },
    [
      visible,
      dataset.allVariables,
      dataset.tMin,
      dataset.tMax,
      clampedPageOffset,
      maxPageOffset,
      simulationData,
      onSeekSimulationTime,
      onTogglePlaying,
      onClose,
      onCue,
      handleToggleVar,
    ],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isScrubbing || !visible || !e.uv) return;
      e.stopPropagation();
      const px = e.uv.x * VR_SIM_CANVAS_W;
      const py = (1 - e.uv.y) * VR_SIM_CANVAS_H;
      const hit = hitTestVrSimulationPanel(px, py, dataset.allVariables, clampedPageOffset);
      if (hit?.kind === "scrub-plot") {
        onSeekSimulationTime(dataset.tMin + hit.normT * (dataset.tMax - dataset.tMin));
      }
    },
    [isScrubbing, visible, dataset.allVariables, dataset.tMin, dataset.tMax, clampedPageOffset, onSeekSimulationTime],
  );

  if (!visible || !canvasBundle) return null;

  return (
    <group
      name="vr-simulation-oscilloscope-panel"
      position={centered ? [0, 1.44, -1.16] : [-0.94, 1.44, -0.78]}
      rotation={centered ? [0, 0, 0] : [0, 0.48, 0]}
    >
      <mesh
        geometry={panelGeom}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => setIsScrubbing(false)}
        onPointerOut={() => setIsScrubbing(false)}
      >
        <meshBasicMaterial map={canvasBundle.texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
