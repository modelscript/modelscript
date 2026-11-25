// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SpatialDiagramSnapMode } from "./spatial-diagram-state.js";
import { evaluateWristPalmVisibility } from "./wrist-palette-logic.js";
import { pulseEventHaptic } from "./xr-handle.js";
import type { RotundaCueKind } from "./xr-session.js";

export interface WristPaletteToolProps {
  visible: boolean;
  paletteOpen: boolean;
  canUndo: boolean;
  snapMode: SpatialDiagramSnapMode;
  isPlaying: boolean;
  dark: boolean;
  onTogglePalette: () => void;
  onUndo: () => void;
  onCycleSnapMode: () => void;
  onTogglePlaying: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

type WristBtnId = "library" | "undo" | "snap" | "play";

interface WristBtnRect {
  id: WristBtnId;
  x: number;
  y: number;
  w: number;
  h: number;
}

const WRIST_CANVAS_W = 512;
const WRIST_CANVAS_H = 264;
const WRIST_MESH_W = 0.088;
const WRIST_MESH_H = 0.046;

const WRIST_BUTTONS: readonly WristBtnRect[] = [
  { id: "library", x: 18, y: 18, w: 476, h: 112 },
  { id: "undo", x: 18, y: 146, w: 148, h: 100 },
  { id: "snap", x: 182, y: 146, w: 148, h: 100 },
  { id: "play", x: 346, y: 146, w: 148, h: 100 },
] as const;

const SNAP_SHORT_LABELS: Record<SpatialDiagramSnapMode, string> = {
  "free-3d": "FREE 3D",
  "domain-layers": "LAYERS",
  "grid-5cm": "5cm GRID",
  "flat-2d": "FLAT 2D",
};

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function paintWristCanvas(
  canvas: HTMLCanvasElement,
  paletteOpen: boolean,
  canUndo: boolean,
  snapMode: SpatialDiagramSnapMode,
  isPlaying: boolean,
  hoveredBtn: WristBtnId | null,
  dark: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Sleek watch-band anodized glass housing
  drawRoundedRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 28);
  ctx.fillStyle = dark ? "rgba(10, 18, 34, 0.94)" : "rgba(248, 250, 252, 0.95)";
  ctx.fill();
  ctx.strokeStyle = paletteOpen ? "#22d3ee" : dark ? "rgba(148, 163, 184, 0.45)" : "rgba(15, 23, 42, 0.22)";
  ctx.lineWidth = 4;
  ctx.stroke();

  const paintBtn = (
    rect: WristBtnRect,
    title: string,
    subtitle: string,
    active: boolean,
    disabled: boolean,
    accent: string,
  ) => {
    const isHov = hoveredBtn === rect.id && !disabled;
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 18);
    ctx.fillStyle = disabled
      ? dark
        ? "rgba(30, 41, 59, 0.45)"
        : "rgba(226, 232, 240, 0.55)"
      : active
        ? accent
        : isHov
          ? dark
            ? "rgba(30, 58, 95, 0.9)"
            : "rgba(224, 242, 254, 0.95)"
          : dark
            ? "rgba(30, 41, 59, 0.85)"
            : "rgba(241, 245, 249, 0.95)";
    ctx.fill();

    ctx.strokeStyle = active
      ? "#ffffff"
      : isHov
        ? "#38bdf8"
        : dark
          ? "rgba(148, 163, 184, 0.35)"
          : "rgba(15, 23, 42, 0.14)";
    ctx.lineWidth = isHov || active ? 3 : 2;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = disabled ? "#64748b" : active ? "#ffffff" : dark ? "#f8fafc" : "#0f172a";
    ctx.font =
      rect.id === "library" ? "700 32px Inter, -apple-system, sans-serif" : "700 24px Inter, -apple-system, sans-serif";
    ctx.fillText(title, rect.x + rect.w * 0.5, rect.y + (subtitle ? rect.h * 0.38 : rect.h * 0.5));

    if (subtitle) {
      ctx.fillStyle = disabled ? "#475569" : active ? "rgba(255,255,255,0.88)" : dark ? "#94a3b8" : "#475569";
      ctx.font = "600 17px monospace";
      ctx.fillText(subtitle, rect.x + rect.w * 0.5, rect.y + rect.h * 0.72);
    }
  };

  paintBtn(
    WRIST_BUTTONS[0]!,
    paletteOpen ? "✕ Close Library Panel" : "+ Component Library",
    paletteOpen ? "PANEL OPEN IN 3D SPACE" : "PULL 2D ICONS → 3D PARTS",
    paletteOpen,
    false,
    "#0284c7",
  );
  paintBtn(WRIST_BUTTONS[1]!, "↶ Undo", canUndo ? "STEP BACK" : "EMPTY", false, !canUndo, "#0ea5e9");
  paintBtn(WRIST_BUTTONS[2]!, "⊞ Snap", SNAP_SHORT_LABELS[snapMode], snapMode !== "free-3d", false, "#0891b2");
  paintBtn(
    WRIST_BUTTONS[3]!,
    isPlaying ? "⏸ Pause" : "▶ Sim",
    isPlaying ? "LIVE" : "PAUSED",
    isPlaying,
    false,
    "#16a34a",
  );
}

function hitTestWristUv(uv: THREE.Vector2): WristBtnId | null {
  const px = uv.x * WRIST_CANVAS_W;
  const py = (1 - uv.y) * WRIST_CANVAS_H;
  for (const btn of WRIST_BUTTONS) {
    if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
      return btn.id;
    }
  }
  return null;
}

/**
 * Non-Dominant (Left) Wrist Tool Micro-Dock.
 *
 * - In WebXR bare-hand mode: mounts cleanly to the left wrist joint and reveals via palm-turn gaze guard.
 * - In WebXR controller mode: mounts onto the left controller dorsal wrist angle.
 * - In Desktop 3D mode: docks neatly as a sleek clickable holographic badge at the lower-left edge of the 3D Stage.
 */
export function WristPaletteTool({
  visible,
  paletteOpen,
  canUndo,
  snapMode,
  isPlaying,
  dark,
  onTogglePalette,
  onUndo,
  onCycleSnapMode,
  onTogglePlaying,
  onCue,
}: WristPaletteToolProps): React.ReactElement | null {
  const leftHand = useXRInputSourceState("hand", "left");
  const leftController = useXRInputSourceState("controller", "left");
  const xrOrigin = useXR((s) => s.origin);
  const isInXr = useXR((s) => s.session !== null);
  const gl = useThree((s) => s.gl);

  const rootRef = useRef<THREE.Group | null>(null);
  const screenMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const bezelMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const palmVisibleRef = useRef(true);

  const [hoveredBtn, setHoveredBtn] = useState<WristBtnId | null>(null);

  // Pre-allocated scratch objects for zero-GC 90Hz wrist tracking
  const wristPos = useRef(new THREE.Vector3());
  const wristQuat = useRef(new THREE.Quaternion());
  const offsetVec = useRef(new THREE.Vector3());
  const rotTilt = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 0.38, 0.14, 0)));
  const normalVec = useRef(new THREE.Vector3());
  const toHeadVec = useRef(new THREE.Vector3());

  const { canvas, texture } = useMemo(() => {
    if (typeof document === "undefined") {
      return { canvas: null, texture: null };
    }
    const c = document.createElement("canvas");
    c.width = WRIST_CANVAS_W;
    c.height = WRIST_CANVAS_H;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, texture: t };
  }, []);

  const lastWristPressRef = useRef<{ hit: WristBtnId | null; atMs: number }>({ hit: null, atMs: 0 });

  useEffect(() => {
    if (!canvas || !texture) return;
    paintWristCanvas(canvas, paletteOpen, canUndo, snapMode, isPlaying, hoveredBtn, dark);
    texture.needsUpdate = true;
  }, [canvas, texture, paletteOpen, canUndo, snapMode, isPlaying, hoveredBtn, dark]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  useFrame((state, _delta, frame) => {
    const group = rootRef.current;
    if (!group || !visible) return;

    const cam = state.camera;
    let opacity = 1;

    if (isInXr) {
      const refSpace = gl.xr.getReferenceSpace();
      const xrHand = leftHand?.inputSource.hand;

      if (frame && refSpace && xrHand && typeof frame.getJointPose === "function") {
        const wristJoint = xrHand.get("wrist");
        const pose = wristJoint ? frame.getJointPose(wristJoint, refSpace) : undefined;
        if (pose) {
          const p = pose.transform.position;
          const o = pose.transform.orientation;
          wristPos.current.set(p.x, p.y, p.z);
          wristQuat.current.set(o.x, o.y, o.z, o.w);
          if (xrOrigin) {
            wristPos.current.applyMatrix4(xrOrigin.matrixWorld);
            wristQuat.current.premultiply(xrOrigin.quaternion);
          }

          // Place watch-dock cleanly on inner forearm/wrist side
          offsetVec.current.set(0.015, -0.024, 0.048).applyQuaternion(wristQuat.current);
          group.position.copy(wristPos.current).add(offsetVec.current);
          group.quaternion.copy(wristQuat.current).multiply(rotTilt.current);
          group.scale.setScalar(1.0);

          // Palm-turn gaze activation guard
          normalVec.current.set(0, 0, 1).applyQuaternion(group.quaternion).normalize();
          toHeadVec.current.copy(cam.position).sub(group.position).normalize();
          const vis = evaluateWristPalmVisibility(
            [normalVec.current.x, normalVec.current.y, normalVec.current.z],
            [toHeadVec.current.x, toHeadVec.current.y, toHeadVec.current.z],
            palmVisibleRef.current,
          );
          palmVisibleRef.current = vis.visible;
          opacity = vis.opacity;
          group.visible = vis.visible && opacity > 0.02;
        } else {
          group.visible = false;
          return;
        }
      } else if (leftController?.object) {
        leftController.object.getWorldPosition(wristPos.current);
        leftController.object.getWorldQuaternion(wristQuat.current);
        offsetVec.current.set(0.028, 0.048, 0.045).applyQuaternion(wristQuat.current);
        group.position.copy(wristPos.current).add(offsetVec.current);
        group.quaternion.copy(wristQuat.current).multiply(rotTilt.current);
        group.scale.setScalar(1.08);
        group.visible = true;
        opacity = 1;
      } else {
        // Fallback floating left-side ergonomic dock inside XR if controller/hand momentarily untracked
        group.position.set(-0.56, 1.18, -0.58);
        group.rotation.set(-0.22, 0.42, 0);
        group.scale.setScalar(1.8);
        group.visible = true;
      }
    } else {
      // Desktop 3D mode: crisp tactile floating dock at lower-left of the 3D Diagram Stage
      group.position.set(-0.66, 1.06, -0.52);
      group.rotation.set(-0.18, 0.34, 0);
      group.scale.setScalar(2.4);
      group.visible = true;
    }

    if (screenMatRef.current) screenMatRef.current.opacity = opacity;
    if (bezelMatRef.current) bezelMatRef.current.opacity = opacity * 0.96;
  });

  if (!visible || !texture) return null;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!e.uv) return;
    const hit = hitTestWristUv(e.uv);
    if (!hit) return;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (lastWristPressRef.current.hit === hit && nowMs - lastWristPressRef.current.atMs < 120) return;
    lastWristPressRef.current = { hit, atMs: nowMs };
    pulseEventHaptic(e, 0.1, 8);
    if (hit === "library") {
      onTogglePalette();
      onCue?.(paletteOpen ? "click" : "env");
    } else if (hit === "undo") {
      if (canUndo) {
        onUndo();
        onCue?.("snap");
      }
    } else if (hit === "snap") {
      onCycleSnapMode();
      onCue?.("tick");
    } else if (hit === "play") {
      onTogglePlaying();
      onCue?.("click");
    }
  };

  return (
    <group ref={rootRef} name="spatial-wrist-palette-tool">
      {/* Machined Anodized Watch-Dock Chassis */}
      <mesh position={[0, 0, -0.004]}>
        <boxGeometry args={[WRIST_MESH_W + 0.006, WRIST_MESH_H + 0.006, 0.007]} />
        <meshStandardMaterial
          ref={bezelMatRef}
          color={dark ? "#1e293b" : "#cbd5e1"}
          metalness={0.62}
          roughness={0.28}
          transparent
        />
      </mesh>

      {/* Interactive High-DPI Holographic Wrist Face */}
      <mesh
        position={[0, 0, 0.0005]}
        onPointerMove={(e) => {
          e.stopPropagation();
          if (!e.uv) return;
          setHoveredBtn(hitTestWristUv(e.uv));
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHoveredBtn(null);
        }}
        onPointerDown={handlePointerDown}
      >
        <planeGeometry args={[WRIST_MESH_W, WRIST_MESH_H]} />
        <meshBasicMaterial ref={screenMatRef} map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
