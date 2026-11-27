// SPDX-License-Identifier: AGPL-3.0-or-later

import { sampleTelemetryFrame, type SimulatorHudSpec, type TelemetryChannelProvider } from "@modelscript/cad";
import {
  paintTelemetryOverlayToCanvas,
  type CanvasHitRegion,
  type TelemetryCanvasSubsystemChip,
} from "@modelscript/cad-viewer/telemetry-canvas-painter.js";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  clampNumber,
  DEFAULT_DESK_SCALE,
  DEFAULT_PODIUM_TILT_DEG,
  PODIUM_WIDTH_METERS,
  resolveDeskLayout,
  rotundaScaleModeLabel,
  type RotundaAction,
  type RotundaCaeOverlay,
  type RotundaClipAxis,
  type RotundaEnvironmentId,
  type RotundaRenderStyle,
  type RotundaState,
} from "./types.js";
import {
  pulseEventHaptic,
  releaseEventForBinding,
  resolveXrPointerBinding,
  tryCapturePointer,
  type XrPointerBinding,
} from "./xr-handle.js";

export interface FloatingToolWingsProps {
  state: RotundaState;
  activeModelTitle: string;
  modelCount: number;
  visible: boolean;
  dispatch: React.Dispatch<RotundaAction>;
  onPlayCue?: ((kind: "tick" | "page" | "snap" | "click" | "env") => void) | undefined;
  activeScenarioLabel?: string | undefined;
  onCycleScenario?: (() => void) | undefined;
  /** Optional live simulation clock ref for throttled 15 Hz VR telemetry canvas updates. */
  simulationTimeRef?: React.RefObject<number> | undefined;
  /** Optional Field-Simulator Telemetry HUD spec painted onto a curved diegetic VR tablet. */
  telemetrySpec?: SimulatorHudSpec | null | undefined;
  telemetryProvider?: TelemetryChannelProvider | null | undefined;
  /** Optional assembly subsystems exposed as VR-native HERO / Solo isolation tap chips. */
  subsystems?: readonly TelemetryCanvasSubsystemChip[] | undefined;
  /** Callback when the user clicks a mission phase band on the VR diegetic scrubber. */
  onSeekSimulationTime?: ((time: number) => void) | undefined;
  /** True when an active WebXR VR or MR session is running (enables in-headset Exit VR control). */
  isInXr?: boolean | undefined;
  /** True when the active WebXR session is an `immersive-ar` passthrough session. */
  isArSession?: boolean | undefined;
  /** Ends the active WebXR session from inside the headset. */
  onExitVr?: (() => void) | undefined;
  /** Optional environment switcher override (e.g. to guard passthrough outside MR sessions). */
  onSelectEnvironment?: ((env: RotundaEnvironmentId) => void) | undefined;
  /** Live drafting desk uniform scale (`0.45`..`1.0`) so side wings stay bolted to the podium. */
  deskScale?: number | undefined;
  /** Optional XR-calibrated drafting desk height in meters. */
  deskHeightY?: number | null | undefined;
  /** Live podium tilt angle in degrees (0° upright .. 85° flat) so wings tilt in lockstep with the desk. */
  podiumTiltDeg?: number | undefined;
  /** Whether the central drafting podium is visible (controls CNC hinge knuckles). */
  podiumVisible?: boolean | undefined;
}

// Podium-docked CNC aluminum side-console wings in pre-scale desk-local coordinates.
// Matches DraftingPodium's side bezel (`0.048`), top bezel (`0.044`), and lower bezel (`0.114`)
// so both wings bolt directly onto the left & right flanks of the blueprint console and angle
// inward like an ergonomic cockpit drafting deck (~2× larger angular legibility on Quest 2).
const PODIUM_TOP_BEZEL = 0.044;
const PODIUM_SIDE_BEZEL = 0.048;
const PODIUM_BEZEL_RIM_HEIGHT = 0.114;
const WING_WIDTH = 0.88;
const WING_HEIGHT = 0.74;
const WING_HINGE_GAP = 0.014;
const WING_HINGE_X = PODIUM_WIDTH_METERS * 0.5 + PODIUM_SIDE_BEZEL + WING_HINGE_GAP;
const WING_CENTER_Y = (PODIUM_TOP_BEZEL - PODIUM_BEZEL_RIM_HEIGHT) * 0.5;
const WING_HINGE_YAW_RAD = (22 * Math.PI) / 180;
const TELEMETRY_WIDTH = 0.44;
const TELEMETRY_HEIGHT = 0.368;
const TELEMETRY_CURVE_DEPTH = 0.016;
const NOOP_RAYCAST: THREE.Object3D["raycast"] = () => {};

const CANVAS_W = 1024;
const CANVAS_H = 856;

const TABLET_FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

interface TabletEnvPillSpec {
  id: RotundaEnvironmentId;
  label: string;
  dotColor: string;
  activeBg: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LEFT_ENV_PILLS: readonly TabletEnvPillSpec[] = [
  { id: "atrium", label: "Atrium", dotColor: "#38bdf8", activeBg: "#0284c7", x: 52, y: 164, w: 296, h: 70 },
  { id: "outdoors", label: "Grass", dotColor: "#16a34a", activeBg: "#16a34a", x: 364, y: 164, w: 296, h: 70 },
  { id: "warehouse", label: "Factory", dotColor: "#f59e0b", activeBg: "#f59e0b", x: 676, y: 164, w: 296, h: 70 },
  { id: "office", label: "Studio", dotColor: "#0284c7", activeBg: "#0284c7", x: 52, y: 246, w: 296, h: 70 },
  { id: "dark-lab", label: "Dark Lab", dotColor: "#0891b2", activeBg: "#0f172a", x: 364, y: 246, w: 296, h: 70 },
  { id: "passthrough", label: "Passthrough", dotColor: "#8b5cf6", activeBg: "#7c3aed", x: 676, y: 246, w: 296, h: 70 },
] as const;

interface TabletCaePillSpec {
  id: RotundaCaeOverlay;
  label: string;
  activeBg: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LEFT_CAE_PILLS: readonly TabletCaePillSpec[] = [
  { id: "none", label: "CAD", activeBg: "#0284c7", x: 52, y: 364, w: 452, h: 64 },
  { id: "fea-stress", label: "FEA Stress", activeBg: "#f59e0b", x: 520, y: 364, w: 452, h: 64 },
  { id: "cfd-flow", label: "CFD Flow", activeBg: "#0284c7", x: 52, y: 440, w: 452, h: 64 },
  { id: "thermal", label: "Thermal", activeBg: "#ef4444", x: 520, y: 440, w: 452, h: 64 },
] as const;

interface TabletStylePillSpec {
  id: RotundaRenderStyle;
  label: string;
  activeBg: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LEFT_STYLE_PILLS: readonly TabletStylePillSpec[] = [
  { id: "shaded", label: "Shaded", activeBg: "#0284c7", x: 52, y: 552, w: 296, h: 62 },
  { id: "wireframe", label: "Wireframe", activeBg: "#0284c7", x: 364, y: 552, w: 296, h: 62 },
  { id: "xray", label: "X-Ray", activeBg: "#0284c7", x: 676, y: 552, w: 296, h: 62 },
] as const;

export type TabletViewToggleId = "ghost" | "labels" | "turntable" | "telemetry";

export interface TabletViewPillSpec {
  readonly id: TabletViewToggleId;
  readonly zoneId: `view:${TabletViewToggleId}`;
  readonly label: string;
  readonly activeBg: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const LEFT_VIEW_PILLS: readonly TabletViewPillSpec[] = [
  { id: "ghost", zoneId: "view:ghost", label: "Ghost Shell", activeBg: "#0891b2", x: 52, y: 662, w: 221, h: 64 },
  { id: "labels", zoneId: "view:labels", label: "Labels", activeBg: "#ea580c", x: 285, y: 662, w: 221, h: 64 },
  { id: "turntable", zoneId: "view:turntable", label: "Turntable", activeBg: "#16a34a", x: 518, y: 662, w: 221, h: 64 },
  { id: "telemetry", zoneId: "view:telemetry", label: "Field HUD", activeBg: "#f97316", x: 751, y: 662, w: 221, h: 64 },
] as const;

const SCENARIO_PILL_RECT = { x: 52, y: 746, w: 920, h: 70 } as const;

export interface RightSubsystemChipLayout {
  readonly zoneId: string;
  readonly subsystemId: string | null;
  readonly label: string;
  readonly accentBg: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function buildRightSubsystemChipLayouts(
  subsystems?: readonly TelemetryCanvasSubsystemChip[] | undefined,
): readonly RightSubsystemChipLayout[] {
  if (!subsystems || subsystems.length === 0) return [];
  const items: Array<{ id: string | null; label: string; accent: string }> = [
    { id: null, label: "HERO", accent: "#0284c7" },
    ...subsystems.slice(0, 6).map((s) => ({
      id: s.id,
      label: s.code ? `${s.code} ${s.label.split(" ")[0] ?? s.label}` : s.label,
      accent: s.accentColor ?? "#ea580c",
    })),
  ];
  const rowX = 52;
  const rowW = 920;
  const gap = 8;
  const w = (rowW - gap * (items.length - 1)) / items.length;
  return items.map((item, i) => ({
    zoneId: item.id === null ? "isolate:hero" : `isolate:${item.id}`,
    subsystemId: item.id,
    label: item.label,
    accentBg: item.accent,
    x: rowX + i * (w + gap),
    y: 544,
    w,
    h: 58,
  }));
}

const RIGHT_LAYOUT = {
  prevBtn: { id: "model:prev", x: 52, y: 140, w: 206, h: 82 },
  modelPlate: { x: 274, y: 140, w: 476, h: 82 },
  nextBtn: { id: "model:next", x: 766, y: 140, w: 206, h: 82 },
  explodeSlider: {
    id: "slider:explode",
    x: 52,
    y: 260,
    w: 920,
    h: 56,
    trackLeft: 78,
    trackRight: 946,
    trackCenterY: 288,
    min: 0,
    max: 1,
  },
  cutToggle: { id: "cut:toggle", x: 52, y: 354, w: 364, h: 60 },
  cutAxes: [
    { id: "cut:x", axis: "x" as RotundaClipAxis, label: "X", x: 432, y: 354, w: 169, h: 60 },
    { id: "cut:y", axis: "y" as RotundaClipAxis, label: "Y", x: 617, y: 354, w: 169, h: 60 },
    { id: "cut:z", axis: "z" as RotundaClipAxis, label: "Z", x: 802, y: 354, w: 170, h: 60 },
  ] as const,
  cutSlider: {
    id: "slider:cut-offset",
    x: 52,
    y: 450,
    w: 920,
    h: 54,
    trackLeft: 78,
    trackRight: 946,
    trackCenterY: 477,
    min: -1,
    max: 1,
  },
  scaleBtn: { id: "stage:scale", x: 52, y: 650, w: 452, h: 64 },
  playBtn: { id: "stage:play", x: 520, y: 650, w: 452, h: 64 },
  rotLeftBtn: { id: "stage:rot-left", x: 52, y: 732, w: 296, h: 66 },
  rotRightBtn: { id: "stage:rot-right", x: 364, y: 732, w: 296, h: 66 },
  resetBtn: { id: "stage:reset", x: 676, y: 732, w: 296, h: 66 },
} as const;

interface TabletHitZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "button" | "slider";
  trackLeft?: number | undefined;
  trackRight?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

interface PointerCaptureLike {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

function setDocumentCursor(cursor: string): void {
  if (typeof document !== "undefined" && document.body) {
    document.body.style.cursor = cursor;
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function createCurvedTabletGeometry(width: number, height: number, curveDepth: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 16, 1);
  const pos = geo.attributes["position"];
  if (pos) {
    const halfW = width / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const nx = halfW > 0 ? x / halfW : 0;
      pos.setZ(i, curveDepth * nx * nx);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

function paintGlassCardBase(
  ctx: CanvasRenderingContext2D,
  title: string,
  badgeText: string,
  accentColor: string,
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Quest 3 Horizon OS Frosted Glass Window Card (weightless translucent obsidian-slate + specular glass rim)
  const bedGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  bedGrad.addColorStop(0, "rgba(18, 26, 42, 0.92)");
  bedGrad.addColorStop(1, "rgba(11, 17, 30, 0.95)");

  drawRoundedRectPath(ctx, 14, 14, CANVAS_W - 28, CANVAS_H - 28, 38);
  ctx.fillStyle = bedGrad;
  ctx.fill();

  // Crisp 1-stroke frosted-glass inner highlight rim
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(226, 232, 240, 0.28)";
  ctx.stroke();

  // Header accent LED dot
  ctx.beginPath();
  ctx.arc(64, 72, 11, 0, Math.PI * 2);
  ctx.fillStyle = accentColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.stroke();

  // Header title (crisp high-contrast instrument label)
  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 32px ${TABLET_FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 90, 73);

  // Header right status pill badge
  if (badgeText.length > 0) {
    ctx.font = `800 22px ${TABLET_FONT_FAMILY}`;
    const textW = ctx.measureText(badgeText).width;
    const pillW = Math.min(340, Math.max(120, textW + 44));
    const pillH = 44;
    const pillX = CANVAS_W - 50 - pillW;
    const pillY = 72 - pillH / 2;

    drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 16);
    ctx.fillStyle = "#0f172a";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
    ctx.stroke();

    ctx.fillStyle = "#e0f2fe";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(truncateText(badgeText, 22), pillX + pillW / 2, 73);
  }

  // Machined hairline divider below header
  ctx.beginPath();
  ctx.moveTo(46, 120);
  ctx.lineTo(CANVAS_W - 46, 120);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.24)";
  ctx.stroke();
}

function paintSectionEyebrow(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `800 22px ${TABLET_FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 54, y);
}

/**
 * Paints a tactile raised keycap matching `DraftingPodium`'s lower-bezel `BezelKeycapButton`:
 * bright frosted white-to-light-slate face, top specular highlight strip, crisp rim border,
 * vivid active fill + bottom-center glowing LED bar, and bold high-contrast typography.
 */
function paintPill(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    active: boolean;
    hovered: boolean;
    activeBg: string;
    dotColor?: string | undefined;
    fontSize?: number | undefined;
    radius?: number | undefined;
  },
): void {
  const { x, y, w, h, label, active, hovered, activeBg, dotColor, fontSize = 29, radius = 18 } = opts;
  const r = Math.min(radius, 18);

  // Subtle recessed keycap drop shadow into the dark anodized keybed
  drawRoundedRectPath(ctx, x, y + 3, w, h, r);
  ctx.fillStyle = "rgba(2, 6, 23, 0.52)";
  ctx.fill();

  // Keycap face gradient (mirrors DraftingPodium BezelKeycapButton)
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  if (active) {
    grad.addColorStop(0, activeBg);
    grad.addColorStop(1, activeBg === "#0284c7" ? "#0369a1" : activeBg);
  } else if (hovered) {
    grad.addColorStop(0, "#e0f2fe");
    grad.addColorStop(1, "#bae6fd");
  } else {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#f1f5f9");
  }

  drawRoundedRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // Subtle darkening shade on bottom half of active colored keycaps for physical depth
  if (active && activeBg !== "#0284c7") {
    const shade = ctx.createLinearGradient(x, y, x, y + h);
    shade.addColorStop(0, "rgba(255, 255, 255, 0.12)");
    shade.addColorStop(1, "rgba(2, 6, 23, 0.24)");
    drawRoundedRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = shade;
    ctx.fill();
  }

  // Top specular highlight strip (signature tactile BezelKeycapButton detail)
  const specH = Math.max(8, Math.min(12, Math.round(h * 0.17)));
  drawRoundedRectPath(ctx, x + 8, y + 5, Math.max(12, w - 16), specH, 6);
  ctx.fillStyle = active ? "rgba(255, 255, 255, 0.24)" : "rgba(255, 255, 255, 0.78)";
  ctx.fill();

  // Crisp keycap rim border (bold sky glow on hover for unmistakable Quest 2 ray/pinch lock)
  drawRoundedRectPath(ctx, x, y, w, h, r);
  ctx.lineWidth = hovered ? 4.5 : active ? 3.2 : 2.2;
  ctx.strokeStyle = hovered ? "#38bdf8" : active ? "rgba(224, 242, 254, 0.72)" : "#cbd5e1";
  ctx.stroke();

  // Active bottom-center glowing LED indicator bar (mirrors BezelKeycapButton)
  if (active) {
    const ledW = Math.min(64, Math.max(28, Math.round(w * 0.32)));
    ctx.fillStyle = "#e0f2fe";
    drawRoundedRectPath(ctx, x + w * 0.5 - ledW * 0.5, y + h - 10, ledW, 4, 2);
    ctx.fill();
  }

  const cy = y + h / 2 + (active ? -1 : 1);
  ctx.font = `800 ${fontSize}px ${TABLET_FONT_FAMILY}`;
  ctx.textBaseline = "middle";

  if (dotColor) {
    const textW = ctx.measureText(label).width;
    const dotRadius = 11;
    const gap = 14;
    const totalW = dotRadius * 2 + gap + textW;
    const startX = x + (w - totalW) / 2;

    ctx.beginPath();
    ctx.arc(startX + dotRadius, cy - 1, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#ffffff" : dotColor;
    ctx.fill();

    if (active) {
      ctx.beginPath();
      ctx.arc(startX + dotRadius, cy - 1, dotRadius - 3, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }

    ctx.fillStyle = active ? "#ffffff" : "#0f172a";
    ctx.textAlign = "left";
    ctx.fillText(label, startX + dotRadius * 2 + gap, cy);
  } else {
    ctx.fillStyle = active ? "#ffffff" : "#0f172a";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w / 2, cy);
  }
}

function paintSliderTrack(
  ctx: CanvasRenderingContext2D,
  opts: {
    label: string;
    readout: string;
    labelY: number;
    trackLeft: number;
    trackRight: number;
    trackCenterY: number;
    trackHeight: number;
    value: number;
    min: number;
    max: number;
    activeColor: string;
    hovered: boolean;
    dragging: boolean;
    bipolar?: boolean | undefined;
    dimmed?: boolean | undefined;
  },
): void {
  const {
    label,
    readout,
    labelY,
    trackLeft,
    trackRight,
    trackCenterY,
    trackHeight,
    value,
    min,
    max,
    activeColor,
    hovered,
    dragging,
    bipolar = false,
    dimmed = false,
  } = opts;

  const span = Math.max(0.0001, max - min);
  const norm = clampNumber((value - min) / span, 0, 1);
  const trackW = trackRight - trackLeft;
  const thumbX = trackLeft + norm * trackW;

  // High-contrast label + live instrument readout on dark anodized keybed
  ctx.fillStyle = dimmed ? "#64748b" : "#cbd5e1";
  ctx.font = `800 22px ${TABLET_FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 54, labelY);

  ctx.fillStyle = dimmed ? "#64748b" : activeColor === "#0284c7" ? "#38bdf8" : "#fbbf24";
  ctx.font = `800 28px ${TABLET_FONT_FAMILY}`;
  ctx.textAlign = "right";
  ctx.fillText(readout, CANVAS_W - 54, labelY);

  // Recessed machined groove track
  const trackY = trackCenterY - trackHeight / 2;
  drawRoundedRectPath(ctx, trackLeft, trackY, trackW, trackHeight, trackHeight / 2);
  ctx.fillStyle = hovered || dragging ? "#0f172a" : "#090f1d";
  ctx.fill();

  ctx.lineWidth = hovered || dragging ? 3.5 : 2;
  ctx.strokeStyle = hovered || dragging ? (dimmed ? "#94a3b8" : "#38bdf8") : "#334155";
  ctx.stroke();

  // Optional center tick for bipolar cut-offset slider
  if (bipolar) {
    const zeroNorm = clampNumber((0 - min) / span, 0, 1);
    const zeroX = trackLeft + zeroNorm * trackW;
    ctx.beginPath();
    ctx.moveTo(zeroX, trackY - 8);
    ctx.lineTo(zeroX, trackY + trackHeight + 8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#64748b";
    ctx.stroke();

    const fillStart = Math.min(zeroX, thumbX);
    const fillW = Math.abs(thumbX - zeroX);
    if (fillW > 2) {
      drawRoundedRectPath(ctx, fillStart, trackY, fillW, trackHeight, trackHeight / 2);
      ctx.fillStyle = dimmed ? "#475569" : activeColor;
      ctx.fill();
    }
  } else {
    const fillW = Math.max(trackHeight, thumbX - trackLeft);
    drawRoundedRectPath(ctx, trackLeft, trackY, Math.min(trackW, fillW), trackHeight, trackHeight / 2);
    ctx.fillStyle = dimmed ? "#475569" : activeColor;
    ctx.fill();
  }

  // Tactile frosted-white keycap-style thumb knob
  const thumbRadius = dragging ? 27 : hovered ? 25 : 23;
  ctx.beginPath();
  ctx.arc(thumbX, trackCenterY + 3, thumbRadius + 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(2, 6, 23, 0.52)";
  ctx.fill();

  const thumbGrad = ctx.createLinearGradient(thumbX, trackCenterY - thumbRadius, thumbX, trackCenterY + thumbRadius);
  thumbGrad.addColorStop(0, "#ffffff");
  thumbGrad.addColorStop(1, "#e2e8f0");
  ctx.beginPath();
  ctx.arc(thumbX, trackCenterY, thumbRadius, 0, Math.PI * 2);
  ctx.fillStyle = thumbGrad;
  ctx.fill();
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = dimmed ? "#64748b" : hovered || dragging ? "#38bdf8" : activeColor;
  ctx.stroke();
}

function findHitZone(zones: readonly TabletHitZone[], x: number, y: number): TabletHitZone | null {
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (!zone) continue;
    if (x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h) {
      return zone;
    }
  }
  return null;
}

function mapSliderZoneValue(zone: TabletHitZone, canvasX: number): number {
  const left = zone.trackLeft ?? zone.x;
  const right = zone.trackRight ?? zone.x + zone.w;
  const min = zone.min ?? 0;
  const max = zone.max ?? 1;
  const norm = clampNumber((canvasX - left) / Math.max(1, right - left), 0, 1);
  return min + norm * (max - min);
}

interface CurvedGlassTabletProps {
  name: string;
  side: "left" | "right";
  position: [number, number, number];
  yawRad: number;
  tiltRad?: number | undefined;
  showHinges?: boolean | undefined;
  isInXr?: boolean | undefined;
  geometry: THREE.PlaneGeometry;
  hitZones: readonly TabletHitZone[];
  paint: (ctx: CanvasRenderingContext2D, hoveredId: string | null, draggingId: string | null) => void;
  onPressZone: (zoneId: string) => void;
  onSliderChange?: ((zoneId: string, value: number) => void) | undefined;
  onSliderDetent?: (() => void) | undefined;
}

function matchesBindingPointer(binding: XrPointerBinding | null, e: ThreeEvent<PointerEvent>): boolean {
  if (!binding) return true;
  if (binding.pointerId >= 0 && typeof e.pointerId === "number") {
    return e.pointerId === binding.pointerId;
  }
  return true;
}

/**
 * Podium-docked CNC aluminum side-console wing backed by ONE high-DPI
 * `CanvasTexture` (1024×856) + ONE transparent ray/pinch hit plane.
 * Repaints ONLY on semantic state or hover changes — ZERO per-frame repaints.
 */
function CurvedGlassTablet({
  name,
  side,
  position,
  yawRad,
  tiltRad = 0,
  showHinges = true,
  isInXr = false,
  geometry,
  hitZones,
  paint,
  onPressZone,
  onSliderChange,
  onSliderDetent,
}: CurvedGlassTabletProps): React.ReactElement {
  const gl = useThree((s) => s.gl);
  const xrSession = useXR((s) => s.session);
  const hitMeshRef = useRef<THREE.Mesh | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const activeSliderRef = useRef<TabletHitZone | null>(null);
  const activeDragBindingRef = useRef<XrPointerBinding | null>(null);
  const lastPressRef = useRef<{ zoneId: string; atMs: number }>({ zoneId: "", atMs: 0 });
  const lastDetentRef = useRef<number>(-1);
  const captureRef = useRef<{ target: PointerCaptureLike | null; pointerId: number | null }>({
    target: null,
    pointerId: null,
  });
  const tmpLocalPtRef = useRef(new THREE.Vector3());

  // Allocate ONE high-DPI CanvasTexture per wing with mipmaps & Quest-2-safe anisotropy
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = isInXr ? 4 : Math.min(8, gl.capabilities.getMaxAnisotropy());

    canvasRef.current = canvas;
    textureRef.current = tex;
    setTexture(tex);

    return () => {
      canvasRef.current = null;
      textureRef.current = null;
      setTexture(null);
      tex.dispose();
    };
  }, [gl, isInXr]);

  // Repaint tablet ONLY when `paint` inputs, hover, or drag state change
  useEffect(() => {
    const canvas = canvasRef.current;
    const tex = textureRef.current;
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paint(ctx, hoveredId, draggingId);
    tex.needsUpdate = true;
  }, [paint, hoveredId, draggingId, texture]);

  const releaseDrag = useCallback(() => {
    const { target, pointerId } = captureRef.current;
    if (target && pointerId !== null && typeof target.releasePointerCapture === "function") {
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already have been released
      }
    }
    captureRef.current = { target: null, pointerId: null };
    activeDragBindingRef.current = null;
    if (activeSliderRef.current) {
      activeSliderRef.current = null;
      lastDetentRef.current = -1;
      setDraggingId(null);
    }
  }, []);

  // Desktop release safety net (window pointerup never fires in immersive WebXR)
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleWindowUp = () => {
      const dragBinding = activeDragBindingRef.current;
      if (!dragBinding || dragBinding.kind === "desktop") {
        releaseDrag();
      }
    };
    window.addEventListener("pointerup", handleWindowUp);
    window.addEventListener("pointercancel", handleWindowUp);
    return () => {
      window.removeEventListener("pointerup", handleWindowUp);
      window.removeEventListener("pointercancel", handleWindowUp);
      releaseDrag();
      setDocumentCursor("auto");
    };
  }, [releaseDrag]);

  // Immersive WebXR release safety net: end slider drags on selectend / squeezeend
  // (or controller disconnect) for the exact owning input source.
  useEffect(() => {
    if (!xrSession) return undefined;
    const onInputEnd = (type: "selectend" | "squeezeend") => (ev: XRInputSourceEvent) => {
      const dragBinding = activeDragBindingRef.current;
      if (dragBinding && dragBinding.inputSource === ev.inputSource) {
        const expected = releaseEventForBinding(dragBinding);
        if (expected === null || expected === type) {
          releaseDrag();
        }
      }
    };
    const onSelectEnd = onInputEnd("selectend");
    const onSqueezeEnd = onInputEnd("squeezeend");
    const onInputSourcesChange = (ev: XRInputSourcesChangeEvent) => {
      const dragSrc = activeDragBindingRef.current?.inputSource;
      if (dragSrc && ev.removed.includes(dragSrc)) {
        releaseDrag();
      }
    };
    xrSession.addEventListener("selectend", onSelectEnd);
    xrSession.addEventListener("squeezeend", onSqueezeEnd);
    xrSession.addEventListener("inputsourceschange", onInputSourcesChange);
    return () => {
      xrSession.removeEventListener("selectend", onSelectEnd);
      xrSession.removeEventListener("squeezeend", onSqueezeEnd);
      xrSession.removeEventListener("inputsourceschange", onInputSourcesChange);
    };
  }, [xrSession, releaseDrag]);

  const resolveCanvasPoint = useCallback((e: ThreeEvent<PointerEvent>): { x: number; y: number } | null => {
    if (e.uv) {
      const u = clampNumber(e.uv.x, 0, 1);
      const v = clampNumber(e.uv.y, 0, 1);
      return { x: u * CANVAS_W, y: (1 - v) * CANVAS_H };
    }
    const mesh = hitMeshRef.current;
    if (!mesh) return null;
    const local = tmpLocalPtRef.current.copy(e.point);
    mesh.worldToLocal(local);
    const u = clampNumber(local.x / WING_WIDTH + 0.5, 0, 1);
    const v = clampNumber(local.y / WING_HEIGHT + 0.5, 0, 1);
    return { x: u * CANVAS_W, y: (1 - v) * CANVAS_H };
  }, []);

  const applySliderPoint = useCallback(
    (zone: TabletHitZone, canvasX: number, e?: ThreeEvent<PointerEvent>) => {
      const value = mapSliderZoneValue(zone, canvasX);
      const min = zone.min ?? 0;
      const max = zone.max ?? 1;
      const norm = clampNumber((value - min) / Math.max(0.0001, max - min), 0, 1);
      const detent = Math.round(norm * 10);
      if (detent !== lastDetentRef.current) {
        lastDetentRef.current = detent;
        if (e) pulseEventHaptic(e, 0.04, 4);
        onSliderDetent?.();
      }
      onSliderChange?.(zone.id, value);
    },
    [onSliderChange, onSliderDetent],
  );

  const updateHover = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const pt = resolveCanvasPoint(e);
      if (!pt) return;
      const zone = findHitZone(hitZones, pt.x, pt.y);
      const nextId = zone ? zone.id : null;
      if (nextId !== hoveredIdRef.current) {
        hoveredIdRef.current = nextId;
        setHoveredId(nextId);
        if (nextId !== null) pulseEventHaptic(e, 0.04, 4);
        setDocumentCursor(zone ? (zone.kind === "slider" ? "ew-resize" : "pointer") : "auto");
      }
    },
    [hitZones, resolveCanvasPoint],
  );

  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      updateHover(e);
    },
    [updateHover],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const activeSlider = activeSliderRef.current;
      if (activeSlider) {
        if (!matchesBindingPointer(activeDragBindingRef.current, e)) return;
        const pt = resolveCanvasPoint(e);
        if (pt) {
          applySliderPoint(activeSlider, pt.x, e);
        }
        return;
      }
      updateHover(e);
    },
    [applySliderPoint, resolveCanvasPoint, updateHover],
  );

  const handlePointerOut = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (hoveredIdRef.current !== null) {
      hoveredIdRef.current = null;
      setHoveredId(null);
    }
    if (!activeSliderRef.current) {
      setDocumentCursor("auto");
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const pt = resolveCanvasPoint(e);
      if (!pt) return;
      const zone = findHitZone(hitZones, pt.x, pt.y);
      if (!zone) return;

      const binding = resolveXrPointerBinding(e);

      if (zone.kind === "slider") {
        activeSliderRef.current = zone;
        activeDragBindingRef.current = binding;
        lastDetentRef.current = -1;
        setDraggingId(zone.id);

        tryCapturePointer(e);
        const target = e.target as unknown as PointerCaptureLike | null;
        if (target && typeof e.pointerId === "number" && typeof target.releasePointerCapture === "function") {
          captureRef.current = { target, pointerId: e.pointerId };
        } else {
          captureRef.current = { target: null, pointerId: null };
        }
        pulseEventHaptic(e, 0.08, 8);
        applySliderPoint(zone, pt.x, e);
        return;
      }

      // Fire button presses immediately on trigger/pointer down so XR selectend timing
      // and trigger-release laser jitter can never swallow clicks.
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (lastPressRef.current.zoneId === zone.id && nowMs - lastPressRef.current.atMs < 120) {
        return;
      }
      lastPressRef.current = { zoneId: zone.id, atMs: nowMs };
      pulseEventHaptic(e, 0.1, 8);
      onPressZone(zone.id);
    },
    [applySliderPoint, hitZones, onPressZone, resolveCanvasPoint],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (activeSliderRef.current) {
        if (!matchesBindingPointer(activeDragBindingRef.current, e)) return;
        e.stopPropagation();
        releaseDrag();
      }
    },
    [releaseDrag],
  );

  const handlePointerCancel = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (activeSliderRef.current && matchesBindingPointer(activeDragBindingRef.current, e)) {
        e.stopPropagation();
        releaseDrag();
      }
    },
    [releaseDrag],
  );

  const sideSign = side === "left" ? -1 : 1;
  // Clean 3.5 cm floating air gap from the central glass slate (zero mechanical metal hinges)
  const panelOffsetX = sideSign * (WING_WIDTH * 0.5 + 0.035);
  void showHinges;

  return (
    <group name={name} position={position} rotation={[0, yawRad, 0]}>
      <group position={[panelOffsetX, 0, 0]} rotation={[-tiltRad, 0, 0]}>
        {/* Ultra-thin floating frosted-glass backing card */}
        <mesh position={[0, 0, -0.004]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[WING_WIDTH - 0.01, WING_HEIGHT - 0.01]} />
          <meshStandardMaterial color="#0f172a" metalness={0.2} roughness={0.35} transparent opacity={0.86} />
        </mesh>

        {/* High-contrast Horizon OS glass console face (1 draw call) */}
        <mesh position={[0, 0, 0.001]} geometry={geometry}>
          {texture ? (
            <meshBasicMaterial
              key="tablet-tex"
              color="#ffffff"
              map={texture}
              transparent={true}
              toneMapped={false}
              side={THREE.FrontSide}
            />
          ) : (
            <meshBasicMaterial
              key="tablet-fallback"
              color="#1e293b"
              transparent={true}
              opacity={0.96}
              toneMapped={false}
            />
          )}
        </mesh>

        {/* Transparent interactive ray/pinch hit plane (1 mesh) */}
        <mesh
          ref={hitMeshRef}
          position={[0, 0, 0.004]}
          geometry={geometry}
          onPointerOver={handlePointerOver}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
        >
          <meshBasicMaterial transparent={true} opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Left & Right Podium-Docked CNC Side-Console Wings.
 * Bolted onto the flanks of the Drafting Podium with matching brushed-aluminum frames
 * and raised frosted-white BezelKeycapButton styling for razor-sharp Quest 2 legibility.
 */
export function FloatingToolWings({
  state,
  activeModelTitle,
  modelCount,
  visible,
  dispatch,
  onPlayCue,
  activeScenarioLabel,
  onCycleScenario,
  simulationTimeRef,
  telemetrySpec,
  telemetryProvider,
  subsystems,
  onSeekSimulationTime,
  isInXr = false,
  isArSession = false,
  onExitVr,
  onSelectEnvironment,
  deskScale = DEFAULT_DESK_SCALE,
  deskHeightY = null,
  podiumTiltDeg = DEFAULT_PODIUM_TILT_DEG,
  podiumVisible = true,
}: FloatingToolWingsProps): React.ReactElement | null {
  const wingsDeskGroupRef = useRef<THREE.Group | null>(null);
  const deskLayout = useMemo(() => resolveDeskLayout(deskScale, deskHeightY), [deskScale, deskHeightY]);
  const targetTiltRad = -(clampNumber(podiumTiltDeg, 0, 85) * Math.PI) / 180;

  // Flat 2-triangle console face sits flush inside the CNC aluminum bezel frame
  const wingFaceGeometry = useMemo(() => new THREE.PlaneGeometry(WING_WIDTH, WING_HEIGHT, 1, 1), []);
  // Overhead telemetry HUD keeps its gentle curved geometry
  const telemetryGeometry = useMemo(
    () => createCurvedTabletGeometry(TELEMETRY_WIDTH, TELEMETRY_HEIGHT, TELEMETRY_CURVE_DEPTH),
    [],
  );

  useEffect(() => {
    return () => {
      wingFaceGeometry.dispose();
      telemetryGeometry.dispose();
    };
  }, [wingFaceGeometry, telemetryGeometry]);

  // Smoothly synchronize wing tilt with DraftingPodium's articulated tilt yoke
  useFrame((_state, delta) => {
    const group = wingsDeskGroupRef.current;
    if (!group) return;
    const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 10);
    group.rotation.x += (targetTiltRad - group.rotation.x) * alpha;
  });

  const hasScenarioCycle = Boolean(onCycleScenario);
  const showExitVrButton = Boolean(isInXr && onExitVr);
  const rightSubsystemChips = useMemo(() => buildRightSubsystemChipLayouts(subsystems), [subsystems]);

  const leftHitZones = useMemo<readonly TabletHitZone[]>(() => {
    const zones: TabletHitZone[] = [];
    for (const pill of LEFT_ENV_PILLS) {
      zones.push({ id: `env:${pill.id}`, x: pill.x, y: pill.y, w: pill.w, h: pill.h, kind: "button" });
    }
    for (const pill of LEFT_CAE_PILLS) {
      zones.push({ id: `cae:${pill.id}`, x: pill.x, y: pill.y, w: pill.w, h: pill.h, kind: "button" });
    }
    for (const pill of LEFT_STYLE_PILLS) {
      zones.push({ id: `style:${pill.id}`, x: pill.x, y: pill.y, w: pill.w, h: pill.h, kind: "button" });
    }
    for (const pill of LEFT_VIEW_PILLS) {
      zones.push({ id: pill.zoneId, x: pill.x, y: pill.y, w: pill.w, h: pill.h, kind: "button" });
    }
    zones.push({ id: "studio:diagram3d", x: 472, y: 38, w: 286, h: 62, kind: "button" });
    if (hasScenarioCycle && showExitVrButton) {
      zones.push({
        id: "scenario:cycle",
        x: SCENARIO_PILL_RECT.x,
        y: SCENARIO_PILL_RECT.y,
        w: 636,
        h: SCENARIO_PILL_RECT.h,
        kind: "button",
      });
      zones.push({
        id: "xr:exit",
        x: SCENARIO_PILL_RECT.x + 652,
        y: SCENARIO_PILL_RECT.y,
        w: 268,
        h: SCENARIO_PILL_RECT.h,
        kind: "button",
      });
    } else if (hasScenarioCycle) {
      zones.push({
        id: "scenario:cycle",
        x: SCENARIO_PILL_RECT.x,
        y: SCENARIO_PILL_RECT.y,
        w: SCENARIO_PILL_RECT.w,
        h: SCENARIO_PILL_RECT.h,
        kind: "button",
      });
    } else if (showExitVrButton) {
      zones.push({
        id: "xr:exit",
        x: SCENARIO_PILL_RECT.x,
        y: SCENARIO_PILL_RECT.y,
        w: SCENARIO_PILL_RECT.w,
        h: SCENARIO_PILL_RECT.h,
        kind: "button",
      });
    }
    return zones;
  }, [hasScenarioCycle, showExitVrButton]);

  const rightHitZones = useMemo<readonly TabletHitZone[]>(
    () => [
      { id: "studio:stockroom", x: 472, y: 38, w: 286, h: 62, kind: "button" },
      { ...RIGHT_LAYOUT.prevBtn, kind: "button" },
      { ...RIGHT_LAYOUT.nextBtn, kind: "button" },
      {
        id: RIGHT_LAYOUT.explodeSlider.id,
        x: RIGHT_LAYOUT.explodeSlider.x,
        y: RIGHT_LAYOUT.explodeSlider.y,
        w: RIGHT_LAYOUT.explodeSlider.w,
        h: RIGHT_LAYOUT.explodeSlider.h,
        kind: "slider",
        trackLeft: RIGHT_LAYOUT.explodeSlider.trackLeft,
        trackRight: RIGHT_LAYOUT.explodeSlider.trackRight,
        min: RIGHT_LAYOUT.explodeSlider.min,
        max: RIGHT_LAYOUT.explodeSlider.max,
      },
      { ...RIGHT_LAYOUT.cutToggle, kind: "button" },
      ...RIGHT_LAYOUT.cutAxes.map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h, kind: "button" as const })),
      {
        id: RIGHT_LAYOUT.cutSlider.id,
        x: RIGHT_LAYOUT.cutSlider.x,
        y: RIGHT_LAYOUT.cutSlider.y,
        w: RIGHT_LAYOUT.cutSlider.w,
        h: RIGHT_LAYOUT.cutSlider.h,
        kind: "slider",
        trackLeft: RIGHT_LAYOUT.cutSlider.trackLeft,
        trackRight: RIGHT_LAYOUT.cutSlider.trackRight,
        min: RIGHT_LAYOUT.cutSlider.min,
        max: RIGHT_LAYOUT.cutSlider.max,
      },
      ...rightSubsystemChips.map((chip) => ({
        id: chip.zoneId,
        x: chip.x,
        y: chip.y,
        w: chip.w,
        h: chip.h,
        kind: "button" as const,
      })),
      { ...RIGHT_LAYOUT.scaleBtn, kind: "button" },
      { ...RIGHT_LAYOUT.playBtn, kind: "button" },
      { ...RIGHT_LAYOUT.rotLeftBtn, kind: "button" },
      { ...RIGHT_LAYOUT.rotRightBtn, kind: "button" },
      { ...RIGHT_LAYOUT.resetBtn, kind: "button" },
    ],
    [rightSubsystemChips],
  );

  const paintLeftTablet = useCallback(
    (ctx: CanvasRenderingContext2D, hoveredId: string | null) => {
      const activeEnvPill = LEFT_ENV_PILLS.find((p) => p.id === state.environment) ?? LEFT_ENV_PILLS[0];
      paintGlassCardBase(ctx, "WORLD & PHYSICS", activeEnvPill?.label ?? "Grass", activeEnvPill?.dotColor ?? "#16a34a");

      paintPill(ctx, {
        x: 472,
        y: 38,
        w: 286,
        h: 62,
        label: state.diagramEditorEnabled ? "✦ Diagram Mode" : "◈ 3D Model Mode",
        active: state.diagramEditorEnabled,
        hovered: hoveredId === "studio:diagram3d",
        activeBg: "#0284c7",
        fontSize: 23,
        radius: 18,
      });

      paintSectionEyebrow(ctx, "ENVIRONMENT", 144);
      for (const pill of LEFT_ENV_PILLS) {
        const zoneId = `env:${pill.id}`;
        paintPill(ctx, {
          x: pill.x,
          y: pill.y,
          w: pill.w,
          h: pill.h,
          label: pill.label,
          active: state.environment === pill.id,
          hovered: hoveredId === zoneId,
          activeBg: pill.activeBg,
          dotColor: pill.dotColor,
          fontSize: 28,
          radius: 18,
        });
      }

      paintSectionEyebrow(ctx, "PHYSICS & CAE", 344);
      for (const pill of LEFT_CAE_PILLS) {
        const zoneId = `cae:${pill.id}`;
        paintPill(ctx, {
          x: pill.x,
          y: pill.y,
          w: pill.w,
          h: pill.h,
          label: pill.label,
          active: state.caeOverlay === pill.id,
          hovered: hoveredId === zoneId,
          activeBg: pill.activeBg,
          fontSize: 27,
          radius: 18,
        });
      }

      paintSectionEyebrow(ctx, "RENDER STYLE", 532);
      for (const pill of LEFT_STYLE_PILLS) {
        const zoneId = `style:${pill.id}`;
        paintPill(ctx, {
          x: pill.x,
          y: pill.y,
          w: pill.w,
          h: pill.h,
          label: pill.label,
          active: state.renderStyle === pill.id,
          hovered: hoveredId === zoneId,
          activeBg: pill.activeBg,
          fontSize: 26,
          radius: 18,
        });
      }

      paintSectionEyebrow(ctx, "STUDIO & FIELD HUD", 642);
      for (const pill of LEFT_VIEW_PILLS) {
        const active =
          pill.id === "ghost"
            ? state.ghostShellEnabled
            : pill.id === "labels"
              ? state.showLabels
              : pill.id === "turntable"
                ? state.autoTurntable
                : state.telemetryWingEnabled;
        paintPill(ctx, {
          x: pill.x,
          y: pill.y,
          w: pill.w,
          h: pill.h,
          label: pill.label,
          active,
          hovered: hoveredId === pill.zoneId,
          activeBg: pill.activeBg,
          fontSize: 23,
          radius: 18,
        });
      }

      const paintExitVrPill = (x: number, y: number, w: number, h: number) => {
        const isHovered = hoveredId === "xr:exit";
        drawRoundedRectPath(ctx, x, y + 3, w, h, 18);
        ctx.fillStyle = "rgba(2, 6, 23, 0.52)";
        ctx.fill();

        const exitGrad = ctx.createLinearGradient(x, y, x, y + h);
        exitGrad.addColorStop(0, isHovered ? "#ef4444" : "#dc2626");
        exitGrad.addColorStop(1, isHovered ? "#b91c1c" : "#991b1b");
        drawRoundedRectPath(ctx, x, y, w, h, 18);
        ctx.fillStyle = exitGrad;
        ctx.fill();

        drawRoundedRectPath(ctx, x + 8, y + 5, w - 16, 10, 5);
        ctx.fillStyle = "rgba(255, 255, 255, 0.24)";
        ctx.fill();

        drawRoundedRectPath(ctx, x, y, w, h, 18);
        ctx.lineWidth = isHovered ? 4 : 2.5;
        ctx.strokeStyle = isHovered ? "#fecaca" : "#fca5a5";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = `800 27px ${TABLET_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isArSession ? "Exit MR" : "Exit VR", x + w / 2, y + h / 2 + 1);
      };

      if (hasScenarioCycle) {
        const isHovered = hoveredId === "scenario:cycle";
        const { x, y, h } = SCENARIO_PILL_RECT;
        const w = showExitVrButton ? 636 : SCENARIO_PILL_RECT.w;
        const scenarioText = `Scenario: ${truncateText(activeScenarioLabel || "All Showcase", showExitVrButton ? 18 : 28)}  ↻`;
        paintPill(ctx, {
          x,
          y,
          w,
          h,
          label: scenarioText,
          active: false,
          hovered: isHovered,
          activeBg: "#0284c7",
          fontSize: 26,
          radius: 18,
        });

        if (showExitVrButton) {
          paintExitVrPill(x + 652, y, 268, h);
        }
      } else if (showExitVrButton) {
        const { x, y, w, h } = SCENARIO_PILL_RECT;
        paintExitVrPill(x, y, w, h);
      } else {
        ctx.fillStyle = "#94a3b8";
        ctx.font = `700 21px ${TABLET_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Tap any keycap to switch world, studio toggles, or physics overlay", CANVAS_W / 2, 780);
      }
    },
    [
      state.environment,
      state.caeOverlay,
      state.renderStyle,
      state.ghostShellEnabled,
      state.showLabels,
      state.autoTurntable,
      state.telemetryWingEnabled,
      state.diagramEditorEnabled,
      hasScenarioCycle,
      showExitVrButton,
      isArSession,
      activeScenarioLabel,
    ],
  );

  const paintRightTablet = useCallback(
    (ctx: CanvasRenderingContext2D, hoveredId: string | null, draggingId: string | null) => {
      const safeIndex = modelCount > 0 ? Math.min(modelCount, state.activeModelIndex + 1) : 0;
      const counterBadge = modelCount > 0 ? `${safeIndex} / ${modelCount}` : "";
      paintGlassCardBase(ctx, "MODEL & INSPECT", counterBadge, "#38bdf8");

      paintPill(ctx, {
        x: 472,
        y: 38,
        w: 286,
        h: 62,
        label: state.wristPaletteOpen ? "✕ Close Vault" : "＋ Stockroom",
        active: state.wristPaletteOpen,
        hovered: hoveredId === "studio:stockroom",
        activeBg: "#0284c7",
        fontSize: 23,
        radius: 18,
      });

      // 1. Model Paging Row: [◀ Prev]  [Model Title + 1/10]  [Next ▶]
      paintPill(ctx, {
        ...RIGHT_LAYOUT.prevBtn,
        label: "◀ Prev",
        active: false,
        hovered: hoveredId === RIGHT_LAYOUT.prevBtn.id,
        activeBg: "#0284c7",
        fontSize: 28,
        radius: 18,
      });

      const plate = RIGHT_LAYOUT.modelPlate;
      drawRoundedRectPath(ctx, plate.x, plate.y, plate.w, plate.h, 16);
      ctx.fillStyle = "#090f1d";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#334155";
      ctx.stroke();

      ctx.fillStyle = "#f8fafc";
      ctx.font = `800 26px ${TABLET_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(truncateText(activeModelTitle || "Engineering Assembly", 22), plate.x + plate.w / 2, plate.y + 30);

      ctx.fillStyle = "#38bdf8";
      ctx.font = `800 21px ${TABLET_FONT_FAMILY}`;
      ctx.fillText(
        modelCount > 0 ? `Model ${safeIndex}/${modelCount}` : "Active Model",
        plate.x + plate.w / 2,
        plate.y + 60,
      );

      paintPill(ctx, {
        ...RIGHT_LAYOUT.nextBtn,
        label: "Next ▶",
        active: false,
        hovered: hoveredId === RIGHT_LAYOUT.nextBtn.id,
        activeBg: "#0284c7",
        fontSize: 28,
        radius: 20,
      });

      // 2. Wide Explode Track Bar (0% → 100%)
      paintSliderTrack(ctx, {
        label: "EXPLODE ASSEMBLY",
        readout: `${Math.round(state.explodeFactor * 100)}%`,
        labelY: 246,
        trackLeft: RIGHT_LAYOUT.explodeSlider.trackLeft,
        trackRight: RIGHT_LAYOUT.explodeSlider.trackRight,
        trackCenterY: RIGHT_LAYOUT.explodeSlider.trackCenterY,
        trackHeight: 22,
        value: state.explodeFactor,
        min: RIGHT_LAYOUT.explodeSlider.min,
        max: RIGHT_LAYOUT.explodeSlider.max,
        activeColor: "#0284c7",
        hovered: hoveredId === RIGHT_LAYOUT.explodeSlider.id,
        dragging: draggingId === RIGHT_LAYOUT.explodeSlider.id,
      });

      // 3. Section Cut Row: [Cut ON/OFF] [X] [Y] [Z] + Cut Offset Slider
      paintSectionEyebrow(ctx, "SECTION CUT", 336);
      paintPill(ctx, {
        ...RIGHT_LAYOUT.cutToggle,
        label: state.sectionCutEnabled ? "Cut ON" : "Cut OFF",
        active: state.sectionCutEnabled,
        hovered: hoveredId === RIGHT_LAYOUT.cutToggle.id,
        activeBg: "#f59e0b",
        fontSize: 26,
        radius: 18,
      });

      for (const item of RIGHT_LAYOUT.cutAxes) {
        paintPill(ctx, {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          label: item.label,
          active: state.sectionCutAxis === item.axis,
          hovered: hoveredId === item.id,
          activeBg: state.sectionCutEnabled ? "#f59e0b" : "#0284c7",
          fontSize: 27,
          radius: 18,
        });
      }

      paintSliderTrack(ctx, {
        label: "CUT OFFSET",
        readout: `${state.sectionCutOffset >= 0 ? "+" : ""}${state.sectionCutOffset.toFixed(2)}`,
        labelY: 436,
        trackLeft: RIGHT_LAYOUT.cutSlider.trackLeft,
        trackRight: RIGHT_LAYOUT.cutSlider.trackRight,
        trackCenterY: RIGHT_LAYOUT.cutSlider.trackCenterY,
        trackHeight: 18,
        value: state.sectionCutOffset,
        min: RIGHT_LAYOUT.cutSlider.min,
        max: RIGHT_LAYOUT.cutSlider.max,
        activeColor: "#f59e0b",
        hovered: hoveredId === RIGHT_LAYOUT.cutSlider.id,
        dragging: draggingId === RIGHT_LAYOUT.cutSlider.id,
        bipolar: true,
        dimmed: !state.sectionCutEnabled,
      });

      // 4. Subsystem Solo Isolation Row (when the active assembly exposes numbered subsystems)
      if (rightSubsystemChips.length > 0) {
        paintSectionEyebrow(ctx, "SUBSYSTEM ISOLATION", 524);
        for (const chip of rightSubsystemChips) {
          paintPill(ctx, {
            x: chip.x,
            y: chip.y,
            w: chip.w,
            h: chip.h,
            label: truncateText(chip.label, 9),
            active: state.isolatedSubsystemId === chip.subsystemId,
            hovered: hoveredId === chip.zoneId,
            activeBg: chip.accentBg,
            fontSize: 18,
            radius: 14,
          });
        }
      } else {
        ctx.fillStyle = "#94a3b8";
        ctx.font = `700 20px ${TABLET_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Select Pelagos OC-8 or an articulated CAD model for subsystem solo chips", CANVAS_W / 2, 568);
      }

      // 5. Stage Row: Tabletop/1:1 Scale | Play/Pause | ⟲ -45° | +45° ⟳ | Reset
      paintSectionEyebrow(ctx, "STAGE & PLAYBACK", 630);
      paintPill(ctx, {
        ...RIGHT_LAYOUT.scaleBtn,
        label: rotundaScaleModeLabel(state.scaleMode),
        active: state.scaleMode !== "tabletop",
        hovered: hoveredId === RIGHT_LAYOUT.scaleBtn.id,
        activeBg: "#16a34a",
        fontSize: 27,
        radius: 18,
      });

      paintPill(ctx, {
        ...RIGHT_LAYOUT.playBtn,
        label: state.isPlaying ? "⏸ Pause" : "▶ Play",
        active: state.isPlaying,
        hovered: hoveredId === RIGHT_LAYOUT.playBtn.id,
        activeBg: state.isPlaying ? "#16a34a" : "#f59e0b",
        fontSize: 27,
        radius: 18,
      });

      paintPill(ctx, {
        ...RIGHT_LAYOUT.rotLeftBtn,
        label: "⟲ -45°",
        active: false,
        hovered: hoveredId === RIGHT_LAYOUT.rotLeftBtn.id,
        activeBg: "#0284c7",
        fontSize: 27,
        radius: 18,
      });

      paintPill(ctx, {
        ...RIGHT_LAYOUT.rotRightBtn,
        label: "+45° ⟳",
        active: false,
        hovered: hoveredId === RIGHT_LAYOUT.rotRightBtn.id,
        activeBg: "#0284c7",
        fontSize: 27,
        radius: 18,
      });

      paintPill(ctx, {
        ...RIGHT_LAYOUT.resetBtn,
        label: "Reset",
        active: false,
        hovered: hoveredId === RIGHT_LAYOUT.resetBtn.id,
        activeBg: "#0284c7",
        fontSize: 27,
        radius: 18,
      });
    },
    [
      activeModelTitle,
      modelCount,
      rightSubsystemChips,
      state.activeModelIndex,
      state.explodeFactor,
      state.sectionCutEnabled,
      state.sectionCutAxis,
      state.sectionCutOffset,
      state.isolatedSubsystemId,
      state.scaleMode,
      state.isPlaying,
      state.wristPaletteOpen,
    ],
  );

  const handleLeftPress = useCallback(
    (zoneId: string) => {
      if (zoneId.startsWith("env:")) {
        const envId = zoneId.slice(4) as RotundaEnvironmentId;
        if (onSelectEnvironment) {
          onSelectEnvironment(envId);
        } else {
          dispatch({ type: "setEnvironment", environment: envId });
          onPlayCue?.("env");
        }
        return;
      }
      if (zoneId.startsWith("cae:")) {
        const overlay = zoneId.slice(4) as RotundaCaeOverlay;
        dispatch({ type: "setCaeOverlay", overlay });
        onPlayCue?.("click");
        return;
      }
      if (zoneId.startsWith("style:")) {
        const style = zoneId.slice(6) as RotundaRenderStyle;
        dispatch({ type: "setRenderStyle", style });
        onPlayCue?.("click");
        return;
      }
      if (zoneId === "view:ghost") {
        dispatch({ type: "toggleGhostShell" });
        onPlayCue?.("click");
        return;
      }
      if (zoneId === "view:labels") {
        dispatch({ type: "toggleShowLabels" });
        onPlayCue?.("click");
        return;
      }
      if (zoneId === "view:turntable") {
        dispatch({ type: "toggleAutoTurntable" });
        onPlayCue?.("click");
        return;
      }
      if (zoneId === "view:telemetry") {
        dispatch({ type: "toggleTelemetryWing" });
        onPlayCue?.("click");
        return;
      }
      if (zoneId === "studio:diagram3d") {
        dispatch({ type: "toggleDiagramEditor" });
        onPlayCue?.("env");
        return;
      }
      if (zoneId === "scenario:cycle") {
        onCycleScenario?.();
        onPlayCue?.("page");
        return;
      }
      if (zoneId === "xr:exit") {
        onPlayCue?.("snap");
        onExitVr?.();
      }
    },
    [dispatch, onCycleScenario, onExitVr, onPlayCue, onSelectEnvironment],
  );

  const handleRightPress = useCallback(
    (zoneId: string) => {
      if (zoneId === "studio:stockroom") {
        dispatch({ type: "toggleWristPalette" });
        onPlayCue?.("snap");
        return;
      }
      if (zoneId === "isolate:hero") {
        dispatch({ type: "setIsolatedSubsystem", subsystemId: null });
        onPlayCue?.("snap");
        return;
      }
      if (zoneId.startsWith("isolate:")) {
        const subsystemId = zoneId.slice(8);
        dispatch({ type: "setIsolatedSubsystem", subsystemId });
        onPlayCue?.("click");
        return;
      }
      switch (zoneId) {
        case "model:prev":
          dispatch({ type: "pageModel", delta: -1, modelCount });
          onPlayCue?.("page");
          break;
        case "model:next":
          dispatch({ type: "pageModel", delta: 1, modelCount });
          onPlayCue?.("page");
          break;
        case "cut:toggle":
          dispatch({ type: "toggleSectionCut" });
          onPlayCue?.("click");
          break;
        case "cut:x":
          dispatch({ type: "setSectionCutAxis", axis: "x" });
          onPlayCue?.("tick");
          break;
        case "cut:y":
          dispatch({ type: "setSectionCutAxis", axis: "y" });
          onPlayCue?.("tick");
          break;
        case "cut:z":
          dispatch({ type: "setSectionCutAxis", axis: "z" });
          onPlayCue?.("tick");
          break;
        case "stage:scale":
          dispatch({ type: "toggleScaleMode" });
          onPlayCue?.("snap");
          break;
        case "stage:play":
          dispatch({ type: "togglePlaying" });
          onPlayCue?.("click");
          break;
        case "stage:rot-left":
          dispatch({ type: "rotatePlinth", deltaYaw: -Math.PI / 4 });
          onPlayCue?.("tick");
          break;
        case "stage:rot-right":
          dispatch({ type: "rotatePlinth", deltaYaw: Math.PI / 4 });
          onPlayCue?.("tick");
          break;
        case "stage:reset":
          dispatch({ type: "resetPlinthView" });
          onPlayCue?.("snap");
          break;
        default:
          break;
      }
    },
    [dispatch, modelCount, onPlayCue],
  );

  const handleRightSliderChange = useCallback(
    (zoneId: string, value: number) => {
      if (zoneId === RIGHT_LAYOUT.explodeSlider.id) {
        dispatch({ type: "setExplode", factor: value });
      } else if (zoneId === RIGHT_LAYOUT.cutSlider.id) {
        dispatch({ type: "setSectionCutOffset", offset: value });
      }
    },
    [dispatch],
  );

  const handleSliderDetent = useCallback(() => {
    onPlayCue?.("tick");
  }, [onPlayCue]);

  if (!visible) {
    return null;
  }

  return (
    <group name="rotunda-floating-tool-wings">
      {/* Podium-docked CNC side-console wings synchronized to desk position, scale & tilt */}
      <group
        ref={wingsDeskGroupRef}
        name="rotunda-podium-wings-frame"
        position={deskLayout.center}
        rotation={[targetTiltRad, 0, 0]}
        scale={deskLayout.scale}
      >
        <CurvedGlassTablet
          name="rotunda-left-wing"
          side="left"
          position={[-WING_HINGE_X, WING_CENTER_Y, 0.002]}
          yawRad={WING_HINGE_YAW_RAD}
          tiltRad={0}
          showHinges={podiumVisible}
          isInXr={isInXr}
          geometry={wingFaceGeometry}
          hitZones={leftHitZones}
          paint={paintLeftTablet}
          onPressZone={handleLeftPress}
        />

        <CurvedGlassTablet
          name="rotunda-right-wing"
          side="right"
          position={[WING_HINGE_X, WING_CENTER_Y, 0.002]}
          yawRad={-WING_HINGE_YAW_RAD}
          tiltRad={0}
          showHinges={podiumVisible}
          isInXr={isInXr}
          geometry={wingFaceGeometry}
          hitZones={rightHitZones}
          paint={paintRightTablet}
          onPressZone={handleRightPress}
          onSliderChange={handleRightSliderChange}
          onSliderDetent={handleSliderDetent}
        />
      </group>

      {telemetrySpec && state.telemetryWingEnabled && (
        <DiegeticTelemetryWing
          geometry={telemetryGeometry}
          spec={telemetrySpec}
          provider={telemetryProvider ?? null}
          simulationTime={state.simulationTime}
          simulationTimeRef={simulationTimeRef}
          isPlaying={state.isPlaying}
          subsystems={subsystems}
          isolatedSubsystemId={state.isolatedSubsystemId}
          onIsolateSubsystem={(subsystemId) => {
            dispatch({ type: "setIsolatedSubsystem", subsystemId });
            onPlayCue?.("click");
          }}
          onSeek={(t) => {
            dispatch({ type: "setSimulationTime", time: t });
            onSeekSimulationTime?.(t);
            onPlayCue?.("tick");
          }}
        />
      )}
    </group>
  );
}

/**
 * Stereo-safe diegetic 3D curved telemetry & Operation Log tablet painted at a
 * throttled 15 Hz from `simulationTimeRef` inside `useFrame` (zero React churn).
 */
function DiegeticTelemetryWing({
  geometry,
  spec,
  provider,
  simulationTime,
  simulationTimeRef,
  isPlaying,
  subsystems,
  isolatedSubsystemId,
  onIsolateSubsystem,
  onSeek,
}: {
  geometry: THREE.BufferGeometry;
  spec: SimulatorHudSpec;
  provider: TelemetryChannelProvider | null;
  simulationTime: number;
  simulationTimeRef?: React.RefObject<number> | undefined;
  isPlaying: boolean;
  subsystems?: readonly TelemetryCanvasSubsystemChip[] | undefined;
  isolatedSubsystemId: string | null;
  onIsolateSubsystem: (subsystemId: string | null) => void;
  onSeek: (time: number) => void;
}): React.ReactElement {
  const gl = useThree((s) => s.gl);
  const hitRegionsRef = useRef<CanvasHitRegion[]>([]);
  const lastPaintMsRef = useRef<number>(0);

  const canvasBundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return { canvas, ctx, texture };
  }, [gl]);

  useEffect(() => {
    return () => {
      canvasBundle?.texture.dispose();
    };
  }, [canvasBundle]);

  const repaintAt = useCallback(
    (t: number) => {
      if (!canvasBundle?.ctx) return;
      const ctx = canvasBundle.ctx;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = "rgba(9, 15, 29, 0.94)";
      ctx.beginPath();
      ctx.roundRect(12, 12, CANVAS_W - 24, CANVAS_H - 24, 34);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
      ctx.stroke();

      const frame = sampleTelemetryFrame(spec, t, null, provider);
      hitRegionsRef.current = paintTelemetryOverlayToCanvas(ctx, frame, CANVAS_W, CANVAS_H, {
        subsystems,
        isolatedSubsystemId,
      });
      canvasBundle.texture.needsUpdate = true;
    },
    [canvasBundle, spec, provider, subsystems, isolatedSubsystemId],
  );

  // Initial paint on mount and when isolation or seek time changes
  useEffect(() => {
    repaintAt(simulationTimeRef?.current ?? simulationTime);
  }, [repaintAt, simulationTime, simulationTimeRef]);

  // Throttled 15 Hz repaint (~66ms) while playing; paused sessions skip GPU uploads
  useFrame(() => {
    if (!isPlaying) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastPaintMsRef.current < 66) return;
    lastPaintMsRef.current = now;
    repaintAt(simulationTimeRef?.current ?? simulationTime);
  });

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!e.uv) return;
      e.stopPropagation();
      const px = e.uv.x * CANVAS_W;
      const py = (1 - e.uv.y) * CANVAS_H;
      for (const hit of hitRegionsRef.current) {
        if (px >= hit.x && px <= hit.x + hit.w && py >= hit.y && py <= hit.y + hit.h) {
          pulseEventHaptic(e, 0.08, 8);
          if (hit.action.kind === "seek") {
            onSeek(hit.action.time);
          } else if (hit.action.kind === "isolate") {
            onIsolateSubsystem(hit.action.subsystemId);
          }
          return;
        }
      }
    },
    [onIsolateSubsystem, onSeek],
  );

  if (!canvasBundle) return <group name="rotunda-telemetry-wing" />;

  return (
    <group name="rotunda-telemetry-wing" position={[0, 2.22, -1.48]} rotation={[0.22, 0, 0]} scale={[1.18, 1.18, 1]}>
      <mesh geometry={geometry} onPointerDown={handlePointerDown}>
        <meshBasicMaterial map={canvasBundle.texture} transparent side={THREE.FrontSide} />
      </mesh>
    </group>
  );
}
