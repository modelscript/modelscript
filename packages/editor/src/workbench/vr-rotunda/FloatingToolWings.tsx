// SPDX-License-Identifier: AGPL-3.0-or-later

import { sampleTelemetryFrame, type SimulatorHudSpec, type TelemetryChannelProvider } from "@modelscript/cad";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  paintTelemetryOverlayToCanvas,
  type CanvasHitRegion,
  type TelemetryCanvasSubsystemChip,
} from "../cad-viewer/telemetry-canvas-painter.js";
import {
  clampNumber,
  type RotundaAction,
  type RotundaCaeOverlay,
  type RotundaClipAxis,
  type RotundaEnvironmentId,
  type RotundaRenderStyle,
  type RotundaState,
} from "./types.js";

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
}

const WING_WIDTH = 0.86;
const WING_HEIGHT = 0.72;
const WING_CURVE_DEPTH = 0.032;
const WING_YAW_RAD = (28 * Math.PI) / 180;
const LEFT_WING_POS: [number, number, number] = [-1.06, 1.32, -1.16];
const RIGHT_WING_POS: [number, number, number] = [1.06, 1.32, -1.16];

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
  { id: "outdoors", label: "Grass", dotColor: "#16a34a", activeBg: "#16a34a", x: 52, y: 164, w: 296, h: 70 },
  { id: "warehouse", label: "Factory", dotColor: "#f59e0b", activeBg: "#f59e0b", x: 364, y: 164, w: 296, h: 70 },
  { id: "office", label: "Studio", dotColor: "#0284c7", activeBg: "#0284c7", x: 676, y: 164, w: 296, h: 70 },
  { id: "dark-lab", label: "Dark Lab", dotColor: "#0891b2", activeBg: "#0f172a", x: 52, y: 246, w: 452, h: 70 },
  { id: "passthrough", label: "Passthrough", dotColor: "#8b5cf6", activeBg: "#7c3aed", x: 520, y: 246, w: 452, h: 70 },
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

  // Subtle ambient drop halo behind the frosted glass card
  ctx.save();
  drawRoundedRectPath(ctx, 18, 22, CANVAS_W - 36, CANVAS_H - 36, 44);
  ctx.fillStyle = "rgba(15, 23, 42, 0.14)";
  ctx.fill();
  ctx.restore();

  // Main light frosted studio glass card (rgba(248, 250, 252, 0.94))
  const cardGrad = ctx.createLinearGradient(0, 16, 0, CANVAS_H - 16);
  cardGrad.addColorStop(0, "rgba(255, 255, 255, 0.96)");
  cardGrad.addColorStop(0.5, "rgba(248, 250, 252, 0.94)");
  cardGrad.addColorStop(1, "rgba(241, 245, 249, 0.94)");

  drawRoundedRectPath(ctx, 16, 16, CANVAS_W - 32, CANVAS_H - 32, 42);
  ctx.fillStyle = cardGrad;
  ctx.fill();

  // Crisp luminous white specular glass edge + subtle outer slate hairline
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
  ctx.stroke();

  drawRoundedRectPath(ctx, 16, 16, CANVAS_W - 32, CANVAS_H - 32, 42);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.42)";
  ctx.stroke();

  // Header accent dot
  ctx.beginPath();
  ctx.arc(68, 76, 11, 0, Math.PI * 2);
  ctx.fillStyle = accentColor;
  ctx.fill();

  // Header title
  ctx.fillStyle = "#0f172a";
  ctx.font = `800 32px ${TABLET_FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 94, 77);

  // Header right status pill badge
  if (badgeText.length > 0) {
    ctx.font = `700 22px ${TABLET_FONT_FAMILY}`;
    const textW = ctx.measureText(badgeText).width;
    const pillW = Math.min(340, Math.max(116, textW + 44));
    const pillH = 44;
    const pillX = CANVAS_W - 52 - pillW;
    const pillY = 76 - pillH / 2;

    drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 22);
    ctx.fillStyle = "#e0f2fe";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(2, 132, 199, 0.28)";
    ctx.stroke();

    ctx.fillStyle = "#0369a1";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(truncateText(badgeText, 22), pillX + pillW / 2, 77);
  }

  // Clean hairline divider below header
  ctx.beginPath();
  ctx.moveTo(52, 124);
  ctx.lineTo(CANVAS_W - 52, 124);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(15, 23, 42, 0.09)";
  ctx.stroke();
}

function paintSectionEyebrow(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  ctx.fillStyle = "#475569";
  ctx.font = `700 21px ${TABLET_FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 54, y);
}

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
  const { x, y, w, h, label, active, hovered, activeBg, dotColor, fontSize = 29, radius = 22 } = opts;

  drawRoundedRectPath(ctx, x, y, w, h, radius);
  if (active) {
    ctx.fillStyle = activeBg;
    ctx.fill();
  } else {
    ctx.fillStyle = hovered ? "#cbd5e1" : "#e2e8f0";
    ctx.fill();
  }

  // Focus/hover highlight ring for unmistakable bare-hand pinch targeting in Quest 2
  if (hovered) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = active ? "#0f172a" : "#0284c7";
    ctx.stroke();
  } else {
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? "rgba(255, 255, 255, 0.45)" : "rgba(15, 23, 42, 0.08)";
    ctx.stroke();
  }

  const cy = y + h / 2 + 1;
  ctx.font = `700 ${fontSize}px ${TABLET_FONT_FAMILY}`;
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

  // Label + live value readout
  ctx.fillStyle = dimmed ? "#94a3b8" : "#475569";
  ctx.font = `700 21px ${TABLET_FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 54, labelY);

  ctx.fillStyle = dimmed ? "#94a3b8" : activeColor;
  ctx.font = `800 28px ${TABLET_FONT_FAMILY}`;
  ctx.textAlign = "right";
  ctx.fillText(readout, CANVAS_W - 54, labelY);

  // Soft track groove
  const trackY = trackCenterY - trackHeight / 2;
  drawRoundedRectPath(ctx, trackLeft, trackY, trackW, trackHeight, trackHeight / 2);
  ctx.fillStyle = hovered || dragging ? "#cbd5e1" : "#e2e8f0";
  ctx.fill();

  if (hovered || dragging) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = dimmed ? "#94a3b8" : activeColor;
    ctx.stroke();
  }

  // Optional center tick for bipolar cut-offset slider
  if (bipolar) {
    const zeroNorm = clampNumber((0 - min) / span, 0, 1);
    const zeroX = trackLeft + zeroNorm * trackW;
    ctx.beginPath();
    ctx.moveTo(zeroX, trackY - 8);
    ctx.lineTo(zeroX, trackY + trackHeight + 8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#94a3b8";
    ctx.stroke();

    const fillStart = Math.min(zeroX, thumbX);
    const fillW = Math.abs(thumbX - zeroX);
    if (fillW > 2) {
      drawRoundedRectPath(ctx, fillStart, trackY, fillW, trackHeight, trackHeight / 2);
      ctx.fillStyle = dimmed ? "#94a3b8" : activeColor;
      ctx.fill();
    }
  } else {
    const fillW = Math.max(trackHeight, thumbX - trackLeft);
    drawRoundedRectPath(ctx, trackLeft, trackY, Math.min(trackW, fillW), trackHeight, trackHeight / 2);
    ctx.fillStyle = dimmed ? "#94a3b8" : activeColor;
    ctx.fill();
  }

  // Tactile Vision-OS circular thumb knob
  const thumbRadius = dragging ? 26 : hovered ? 24 : 22;
  ctx.beginPath();
  ctx.arc(thumbX, trackCenterY + 2, thumbRadius + 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15, 23, 42, 0.16)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(thumbX, trackCenterY, thumbRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = dimmed ? "#94a3b8" : activeColor;
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
  position: [number, number, number];
  rotation: [number, number, number];
  geometry: THREE.PlaneGeometry;
  hitZones: readonly TabletHitZone[];
  paint: (ctx: CanvasRenderingContext2D, hoveredId: string | null, draggingId: string | null) => void;
  onPressZone: (zoneId: string) => void;
  onSliderChange?: ((zoneId: string, value: number) => void) | undefined;
  onSliderDetent?: (() => void) | undefined;
}

/**
 * Single sleek curved frosted-glass Vision-OS tablet backed by ONE high-DPI
 * `CanvasTexture` (1024×856) + ONE transparent ray/pinch hit plane (2 meshes total).
 * Repaints ONLY on semantic state or hover changes — ZERO per-frame repaints.
 */
function CurvedGlassTablet({
  name,
  position,
  rotation,
  geometry,
  hitZones,
  paint,
  onPressZone,
  onSliderChange,
  onSliderDetent,
}: CurvedGlassTabletProps): React.ReactElement {
  const hitMeshRef = useRef<THREE.Mesh | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const activeSliderRef = useRef<TabletHitZone | null>(null);
  const pressedButtonIdRef = useRef<string | null>(null);
  const lastDetentRef = useRef<number>(-1);
  const captureRef = useRef<{ target: PointerCaptureLike | null; pointerId: number | null }>({
    target: null,
    pointerId: null,
  });
  const tmpLocalPtRef = useRef(new THREE.Vector3());

  // Allocate ONE high-DPI CanvasTexture per tablet with mipmaps so distant text never shimmers
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
    tex.anisotropy = 4;

    canvasRef.current = canvas;
    textureRef.current = tex;
    setTexture(tex);

    return () => {
      canvasRef.current = null;
      textureRef.current = null;
      setTexture(null);
      tex.dispose();
    };
  }, []);

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
    if (activeSliderRef.current) {
      activeSliderRef.current = null;
      lastDetentRef.current = -1;
      setDraggingId(null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleWindowUp = () => {
      releaseDrag();
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
    (zone: TabletHitZone, canvasX: number) => {
      const value = mapSliderZoneValue(zone, canvasX);
      const min = zone.min ?? 0;
      const max = zone.max ?? 1;
      const norm = clampNumber((value - min) / Math.max(0.0001, max - min), 0, 1);
      const detent = Math.round(norm * 10);
      if (detent !== lastDetentRef.current) {
        lastDetentRef.current = detent;
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
        const pt = resolveCanvasPoint(e);
        if (pt) {
          applySliderPoint(activeSlider, pt.x);
        }
        return;
      }
      updateHover(e);
    },
    [applySliderPoint, resolveCanvasPoint, updateHover],
  );

  const handlePointerOut = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    pressedButtonIdRef.current = null;
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

      if (zone.kind === "slider") {
        pressedButtonIdRef.current = null;
        activeSliderRef.current = zone;
        lastDetentRef.current = -1;
        setDraggingId(zone.id);

        const target = e.target as unknown as PointerCaptureLike | null;
        if (target && typeof e.pointerId === "number" && typeof target.setPointerCapture === "function") {
          try {
            target.setPointerCapture(e.pointerId);
            captureRef.current = { target, pointerId: e.pointerId };
          } catch {
            captureRef.current = { target: null, pointerId: null };
          }
        }
        applySliderPoint(zone, pt.x);
        return;
      }

      pressedButtonIdRef.current = zone.id;
    },
    [applySliderPoint, hitZones, resolveCanvasPoint],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (activeSliderRef.current) {
        e.stopPropagation();
        releaseDrag();
        return;
      }
      const pressedId = pressedButtonIdRef.current;
      pressedButtonIdRef.current = null;
      if (!pressedId) return;
      e.stopPropagation();
      const pt = resolveCanvasPoint(e);
      if (!pt) return;
      const zone = findHitZone(hitZones, pt.x, pt.y);
      if (zone && zone.id === pressedId) {
        onPressZone(zone.id);
      }
    },
    [hitZones, onPressZone, releaseDrag, resolveCanvasPoint],
  );

  return (
    <group name={name} position={position} rotation={rotation}>
      {/* Visual frosted-glass curved tablet mesh (1 draw call) */}
      <mesh geometry={geometry}>
        {texture ? (
          <meshBasicMaterial
            key="tablet-tex"
            color="#ffffff"
            map={texture}
            transparent={true}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        ) : (
          <meshBasicMaterial
            key="tablet-fallback"
            color="#f8fafc"
            transparent={true}
            opacity={0.92}
            toneMapped={false}
          />
        )}
      </mesh>

      {/* Transparent interactive ray/pinch hit plane (1 mesh) */}
      <mesh
        ref={hitMeshRef}
        position={[0, 0, 0.003]}
        geometry={geometry}
        onPointerOver={handlePointerOver}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <meshBasicMaterial transparent={true} opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * Left & Right Vision-OS Style Frosted-Glass Floating Tool Tablets.
 * Uses exactly 2 `CanvasTexture`s and 4 meshes total for razor-sharp Quest 2 legibility,
 * effortless bare-hand pinching, and zero per-frame texture repaints.
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
}: FloatingToolWingsProps): React.ReactElement | null {
  const tabletGeometry = useMemo(() => createCurvedTabletGeometry(WING_WIDTH, WING_HEIGHT, WING_CURVE_DEPTH), []);

  useEffect(() => {
    return () => {
      tabletGeometry.dispose();
    };
  }, [tabletGeometry]);

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
        label: state.diagramEditorEnabled ? "✦ 3D Diagram ON" : "✦ 3D Diagram",
        active: state.diagramEditorEnabled,
        hovered: hoveredId === "studio:diagram3d",
        activeBg: "#0284c7",
        fontSize: 24,
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
        drawRoundedRectPath(ctx, x, y, w, h, 22);
        ctx.fillStyle = isHovered ? "#dc2626" : "#b91c1c";
        ctx.fill();
        ctx.lineWidth = isHovered ? 4 : 2.5;
        ctx.strokeStyle = "#fca5a5";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = `800 26px ${TABLET_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isArSession ? "Exit MR" : "Exit VR", x + w / 2, y + h / 2 + 1);
      };

      if (hasScenarioCycle) {
        const isHovered = hoveredId === "scenario:cycle";
        const { x, y, h } = SCENARIO_PILL_RECT;
        const w = showExitVrButton ? 636 : SCENARIO_PILL_RECT.w;
        drawRoundedRectPath(ctx, x, y, w, h, 22);
        ctx.fillStyle = isHovered ? "#bae6fd" : "#e0f2fe";
        ctx.fill();
        ctx.lineWidth = isHovered ? 4 : 2.5;
        ctx.strokeStyle = "#0284c7";
        ctx.stroke();

        const scenarioText = `Scenario: ${truncateText(activeScenarioLabel || "All Showcase", showExitVrButton ? 18 : 28)}  ↻`;
        ctx.fillStyle = "#0369a1";
        ctx.font = `800 26px ${TABLET_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(scenarioText, x + w / 2, y + h / 2 + 1);

        if (showExitVrButton) {
          paintExitVrPill(x + 652, y, 268, h);
        }
      } else if (showExitVrButton) {
        const { x, y, w, h } = SCENARIO_PILL_RECT;
        paintExitVrPill(x, y, w, h);
      } else {
        ctx.fillStyle = "#64748b";
        ctx.font = `600 21px ${TABLET_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Pinch any pill to switch world, studio toggles, or physics overlay", CANVAS_W / 2, 780);
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
      paintGlassCardBase(ctx, "MODEL & INSPECT", counterBadge, "#0284c7");

      // 1. Model Paging Row: [◀ Prev]  [Model Title + 1/10]  [Next ▶]
      paintPill(ctx, {
        ...RIGHT_LAYOUT.prevBtn,
        label: "◀ Prev",
        active: false,
        hovered: hoveredId === RIGHT_LAYOUT.prevBtn.id,
        activeBg: "#0284c7",
        fontSize: 28,
        radius: 20,
      });

      const plate = RIGHT_LAYOUT.modelPlate;
      drawRoundedRectPath(ctx, plate.x, plate.y, plate.w, plate.h, 20);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      ctx.stroke();

      ctx.fillStyle = "#0f172a";
      ctx.font = `800 26px ${TABLET_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(truncateText(activeModelTitle || "Engineering Assembly", 22), plate.x + plate.w / 2, plate.y + 30);

      ctx.fillStyle = "#0284c7";
      ctx.font = `700 21px ${TABLET_FONT_FAMILY}`;
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
        ctx.fillStyle = "#64748b";
        ctx.font = `600 20px ${TABLET_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Select Pelagos OC-8 or an articulated CAD model for subsystem solo chips", CANVAS_W / 2, 568);
      }

      // 5. Stage Row: Tabletop/1:1 Scale | Play/Pause | ⟲ -45° | +45° ⟳ | Reset
      paintSectionEyebrow(ctx, "STAGE & PLAYBACK", 630);
      paintPill(ctx, {
        ...RIGHT_LAYOUT.scaleBtn,
        label: state.scaleMode === "real-scale" ? "1:1 Scale" : "Tabletop",
        active: state.scaleMode === "real-scale",
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
      <CurvedGlassTablet
        name="rotunda-left-wing"
        position={LEFT_WING_POS}
        rotation={[0, WING_YAW_RAD, 0]}
        geometry={tabletGeometry}
        hitZones={leftHitZones}
        paint={paintLeftTablet}
        onPressZone={handleLeftPress}
      />

      <CurvedGlassTablet
        name="rotunda-right-wing"
        position={RIGHT_WING_POS}
        rotation={[0, -WING_YAW_RAD, 0]}
        geometry={tabletGeometry}
        hitZones={rightHitZones}
        paint={paintRightTablet}
        onPressZone={handleRightPress}
        onSliderChange={handleRightSliderChange}
        onSliderDetent={handleSliderDetent}
      />

      {telemetrySpec && state.telemetryWingEnabled && (
        <DiegeticTelemetryWing
          geometry={tabletGeometry}
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
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);

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

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!e.uv) return;
      e.stopPropagation();
      const px = e.uv.x * CANVAS_W;
      const py = (1 - e.uv.y) * CANVAS_H;
      for (const hit of hitRegionsRef.current) {
        if (px >= hit.x && px <= hit.x + hit.w && py >= hit.y && py <= hit.y + hit.h) {
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
    <group name="rotunda-telemetry-wing" position={[0, 2.06, -1.52]} rotation={[0.16, 0, 0]}>
      <mesh geometry={geometry} onClick={handleClick}>
        <meshBasicMaterial map={canvasBundle.texture} transparent side={THREE.FrontSide} />
      </mesh>
    </group>
  );
}
