// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ThreeEvent } from "@react-three/fiber";
import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { RotundaActiveView } from "./types.js";
import { pulseEventHaptic } from "./xr-handle.js";
import type { RotundaCueKind } from "./xr-session.js";

const NAV_CANVAS_W = 1280;
const NAV_CANVAS_H = 148;
const UI_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

const VIEW_LABELS: Record<RotundaActiveView, string> = {
  diagram: "Diagram",
  "3d": "3D",
  simulation: "Simulation",
  inspector: "Inspector",
  code: "Code",
};

interface NavHitBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
}

export interface VrSpatialNavBar3DProps {
  visible: boolean;
  activeView: RotundaActiveView;
  availableViews: readonly RotundaActiveView[];
  splitCodeOpen: boolean;
  fileCarouselOpen: boolean;
  fileCount: number;
  onSelectView: (view: RotundaActiveView) => void;
  onToggleSplitCode: () => void;
  onToggleFileCarousel: () => void;
  onExitVr: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

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

/**
 * In-headset (`isInXr === true`) diegetic 3D navigation rail mirroring the
 * workbench topbar 1:1 (`[Diagram | 3D | Simulation | Inspector | Code] | [Split] | [Files] | [Exit VR]`).
 */
export const VrSpatialNavBar3D: React.FC<VrSpatialNavBar3DProps> = ({
  visible,
  activeView,
  availableViews,
  splitCodeOpen,
  fileCarouselOpen,
  fileCount,
  onSelectView,
  onToggleSplitCode,
  onToggleFileCarousel,
  onExitVr,
  onCue,
}) => {
  const layout = useMemo(() => {
    const boxes: NavHitBox[] = [];
    const views =
      availableViews.length > 0 ? availableViews : (["diagram", "3d", "simulation", "inspector", "code"] as const);
    const padX = 28;
    const btnY = 30;
    const btnH = 88;
    const gap = 12;

    const rightControlsCount = 2 + (fileCount > 1 ? 1 : 0); // Split + (Files) + Exit VR
    const rightWidth = rightControlsCount * 144 + (rightControlsCount - 1) * gap + 24;
    const viewsTotalW = NAV_CANVAS_W - padX * 2 - rightWidth - 20;
    const viewBtnW = Math.floor((viewsTotalW - gap * (views.length - 1)) / views.length);

    let cursorX = padX;
    for (const v of views) {
      boxes.push({
        id: `view:${v}`,
        x: cursorX,
        y: btnY,
        w: viewBtnW,
        h: btnH,
        action: () => onSelectView(v),
      });
      cursorX += viewBtnW + gap;
    }

    cursorX += 20;

    // Split Code toggle (disabled visually when in Code view)
    boxes.push({
      id: "split",
      x: cursorX,
      y: btnY,
      w: 144,
      h: btnH,
      action: () => {
        if (activeView !== "code") onToggleSplitCode();
      },
    });
    cursorX += 144 + gap;

    if (fileCount > 1) {
      boxes.push({
        id: "files",
        x: cursorX,
        y: btnY,
        w: 144,
        h: btnH,
        action: onToggleFileCarousel,
      });
      cursorX += 144 + gap;
    }

    boxes.push({
      id: "exit",
      x: cursorX,
      y: btnY,
      w: 144,
      h: btnH,
      action: onExitVr,
    });

    return { boxes, views };
  }, [availableViews, fileCount, activeView, onSelectView, onToggleSplitCode, onToggleFileCarousel, onExitVr]);

  const texture = useMemo(() => {
    if (typeof document === "undefined" || !visible) return null;
    const canvas = document.createElement("canvas");
    canvas.width = NAV_CANVAS_W;
    canvas.height = NAV_CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, NAV_CANVAS_W, NAV_CANVAS_H);

    // Outer obsidian glass pill
    drawRoundedRect(ctx, 8, 12, NAV_CANVAS_W - 16, NAV_CANVAS_H - 24, 28);
    ctx.fillStyle = "rgba(9, 15, 29, 0.92)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const box of layout.boxes) {
      let label = "";
      let bg = "rgba(30, 41, 59, 0.72)";
      let border = "rgba(148, 163, 184, 0.25)";
      let fg = "#cbd5e1";

      if (box.id.startsWith("view:")) {
        const viewId = box.id.slice(5) as RotundaActiveView;
        const isActive = viewId === activeView;
        label = VIEW_LABELS[viewId];
        if (isActive) {
          bg = "rgba(8, 145, 178, 0.85)";
          border = "#22d3ee";
          fg = "#ffffff";
        }
      } else if (box.id === "split") {
        label = splitCodeOpen && activeView !== "code" ? "Split: ON" : "Split";
        const isDisabled = activeView === "code";
        bg = isDisabled
          ? "rgba(15, 23, 42, 0.4)"
          : splitCodeOpen
            ? "rgba(99, 102, 241, 0.75)"
            : "rgba(30, 41, 59, 0.72)";
        border = splitCodeOpen && !isDisabled ? "#818cf8" : "rgba(148, 163, 184, 0.25)";
        fg = isDisabled ? "#475569" : splitCodeOpen ? "#ffffff" : "#cbd5e1";
      } else if (box.id === "files") {
        label = `Files (${fileCount})`;
        bg = fileCarouselOpen ? "rgba(37, 99, 235, 0.8)" : "rgba(30, 41, 59, 0.72)";
        border = fileCarouselOpen ? "#60a5fa" : "rgba(148, 163, 184, 0.25)";
        fg = fileCarouselOpen ? "#ffffff" : "#cbd5e1";
      } else if (box.id === "exit") {
        label = "Exit VR";
        bg = "rgba(185, 28, 28, 0.78)";
        border = "rgba(248, 113, 113, 0.65)";
        fg = "#ffffff";
      }

      drawRoundedRect(ctx, box.x, box.y, box.w, box.h, 18);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = border;
      ctx.stroke();

      ctx.fillStyle = fg;
      ctx.font = `700 24px ${UI_FONT}`;
      ctx.fillText(label, box.x + box.w * 0.5, box.y + box.h * 0.5);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, [visible, layout, activeView, splitCodeOpen, fileCarouselOpen, fileCount]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  if (!visible || !texture) return null;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!e.uv) return;
    const px = e.uv.x * NAV_CANVAS_W;
    const py = (1 - e.uv.y) * NAV_CANVAS_H;
    for (const box of layout.boxes) {
      if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
        pulseEventHaptic(e, 0.14, 10);
        onCue?.(box.id.startsWith("view:") ? "arena-rotate" : "click");
        box.action();
        return;
      }
    }
  };

  return (
    <group name="vr-spatial-nav-bar" position={[0, 0.88, -0.86]} rotation={[-0.28, 0, 0]}>
      <mesh onPointerDown={handlePointerDown}>
        <planeGeometry args={[1.08, 0.125]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
};
