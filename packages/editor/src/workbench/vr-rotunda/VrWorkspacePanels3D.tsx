// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { resolveDiagramLanguageTheme, type DiagramLanguageTheme } from "./diagram-language-theme.js";
import type { RotundaInspectorData, RotundaWorkspaceFile } from "./types.js";
import { pulseEventHaptic } from "./xr-handle.js";
import type { RotundaCueKind } from "./xr-session.js";

const UI_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace";

const CODE_KEYWORDS = new Set([
  "model",
  "end",
  "package",
  "part",
  "port",
  "def",
  "connect",
  "equation",
  "algorithm",
  "parameter",
  "constant",
  "Real",
  "Integer",
  "Boolean",
  "String",
  "extends",
  "import",
  "within",
  "annotation",
  "module",
  "function",
  "if",
  "then",
  "else",
  "for",
  "in",
  "loop",
  "return",
  "attribute",
  "connection",
  "flow",
  "interface",
  "requirement",
  "constraint",
  "var",
  "let",
  "const",
]);

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

// ═══════════════════════════════════════════════════════════════════════════
// 1. DiagramTypeBanner3D — Prominent Language & Diagram Paradigm Header
// ═══════════════════════════════════════════════════════════════════════════

export interface DiagramTypeBanner3DProps {
  theme: DiagramLanguageTheme;
  fileName?: string | undefined;
  nodeCount: number;
  edgeCount: number;
  position?: [number, number, number] | undefined;
}

export function DiagramTypeBanner3D({
  theme,
  fileName,
  nodeCount,
  edgeCount,
  position = [0, 0.56, 0.02],
}: DiagramTypeBanner3DProps): React.ReactElement | null {
  const texture = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 112;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Sleek language-tinted architectural pill banner
    drawRoundedRect(ctx, 6, 8, canvas.width - 12, canvas.height - 16, 22);
    ctx.fillStyle = theme.headerBg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.accentColor;
    ctx.stroke();

    // Vivid left language badge pill
    drawRoundedRect(ctx, 22, 22, 196, 68, 14);
    ctx.fillStyle = theme.accentColor;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 26px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(theme.badgeLabel, 120, 56);

    // Diagram kind title & active filename
    ctx.textAlign = "left";
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 24px ${UI_FONT}`;
    const kindText =
      theme.diagramKindLabel.length > 42 ? `${theme.diagramKindLabel.slice(0, 41)}…` : theme.diagramKindLabel;
    ctx.fillText(kindText, 240, 41);

    ctx.fillStyle = theme.secondaryColor;
    ctx.font = `600 18px ${MONO_FONT}`;
    const cleanFile = fileName ? (fileName.length > 34 ? `…${fileName.slice(-33)}` : fileName) : "Active Model";
    ctx.fillText(`${cleanFile}  ·  ${nodeCount} blocks · ${edgeCount} wires`, 240, 74);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, [theme, fileName, nodeCount, edgeCount]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  if (!texture) return null;

  return (
    <mesh name="vr-diagram-type-banner" position={position}>
      <planeGeometry args={[1.08, 0.118]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. FloatingCodePanel3D — Syntax-Highlighted Scrollable Floating Code Text
// ═══════════════════════════════════════════════════════════════════════════

export interface FloatingCodePanel3DProps {
  visible: boolean;
  code: string;
  fileName: string;
  theme: DiagramLanguageTheme;
  /** Centered prominently when in Code view, or docked to the right when overlaid over Diagram/3D. */
  centered?: boolean | undefined;
  onClose: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

const CODE_CANVAS_W = 1024;
const CODE_CANVAS_H = 768;
const CODE_VISIBLE_LINES = 24;

export function FloatingCodePanel3D({
  visible,
  code,
  fileName,
  theme,
  centered = false,
  onClose,
  onCue,
}: FloatingCodePanel3DProps): React.ReactElement | null {
  const [scrollLine, setScrollLine] = useState(0);
  const lines = useMemo(() => (code || "// Empty file").split(/\r?\n/), [code]);
  const maxScroll = Math.max(0, lines.length - CODE_VISIBLE_LINES);

  useEffect(() => {
    setScrollLine(0);
  }, [fileName]);

  const clampedScroll = Math.min(scrollLine, maxScroll);

  const texture = useMemo(() => {
    if (typeof document === "undefined" || !visible) return null;
    const canvas = document.createElement("canvas");
    canvas.width = CODE_CANVAS_W;
    canvas.height = CODE_CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, CODE_CANVAS_W, CODE_CANVAS_H);

    // Translucent obsidian glass card (mirrors 2D floating code overlay)
    drawRoundedRect(ctx, 8, 8, CODE_CANVAS_W - 16, CODE_CANVAS_H - 16, 22);
    ctx.fillStyle = "rgba(9, 15, 29, 0.94)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.accentColor;
    ctx.stroke();

    // Header bar
    drawRoundedRect(ctx, 18, 18, CODE_CANVAS_W - 36, 62, 14);
    ctx.fillStyle = theme.headerBg;
    ctx.fill();

    // Language badge
    drawRoundedRect(ctx, 30, 30, 146, 38, 10);
    ctx.fillStyle = theme.accentColor;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 18px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(theme.badgeLabel, 103, 49);

    // File name & line range
    ctx.textAlign = "left";
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 22px ${MONO_FONT}`;
    const shortName = fileName.length > 28 ? `…${fileName.slice(-27)}` : fileName;
    ctx.fillText(shortName, 194, 49);

    // Interactive header buttons: [▲] [▼] [✕]
    const drawBtn = (x: number, w: number, label: string, bg: string) => {
      drawRoundedRect(ctx, x, 28, w, 42, 10);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 18px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(label, x + w * 0.5, 49);
    };
    drawBtn(732, 82, "▲ UP", "rgba(51, 65, 85, 0.9)");
    drawBtn(822, 86, "▼ DN", "rgba(51, 65, 85, 0.9)");
    drawBtn(916, 76, "✕", "rgba(185, 28, 28, 0.85)");

    // Code lines with lightweight syntax coloring
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const startY = 104;
    const lineH = 26;

    for (let i = 0; i < CODE_VISIBLE_LINES; i++) {
      const lineIdx = clampedScroll + i;
      if (lineIdx >= lines.length) break;
      const y = startY + i * lineH;
      const rawLine = lines[lineIdx] ?? "";

      // Gutter line number
      ctx.fillStyle = "#64748b";
      ctx.font = `600 17px ${MONO_FONT}`;
      ctx.fillText(String(lineIdx + 1).padStart(3, " "), 26, y);

      // Comment line shortcut
      const trimmed = rawLine.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
        ctx.fillStyle = "#6ee7b7";
        ctx.font = `500 18px ${MONO_FONT}`;
        ctx.fillText(rawLine.slice(0, 74), 84, y);
        continue;
      }

      // Token-colored rendering
      let cursorX = 84;
      const clipped = rawLine.slice(0, 76);
      const tokens = clipped.split(/(\s+|"[^"]*"|[(){};,=.+\-*/:]+)/g);
      ctx.font = `500 18px ${MONO_FONT}`;
      for (const tok of tokens) {
        if (!tok) continue;
        if (tok.startsWith('"')) {
          ctx.fillStyle = "#fde68a";
        } else if (CODE_KEYWORDS.has(tok)) {
          ctx.fillStyle = "#38bdf8";
        } else if (/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(tok)) {
          ctx.fillStyle = "#f472b6";
        } else if (/^[(){};,=.+\-*/:]+$/.test(tok)) {
          ctx.fillStyle = "#94a3b8";
        } else {
          ctx.fillStyle = "#e2e8f0";
        }
        ctx.fillText(tok, cursorX, y);
        cursorX += ctx.measureText(tok).width;
        if (cursorX > CODE_CANVAS_W - 28) break;
      }
    }

    // Footer status
    ctx.fillStyle = "#94a3b8";
    ctx.font = `600 16px ${UI_FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(
      `Lines ${clampedScroll + 1}–${Math.min(lines.length, clampedScroll + CODE_VISIBLE_LINES)} of ${lines.length} · Synced live with Ansatz Editor`,
      28,
      CODE_CANVAS_H - 26,
    );

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, [visible, lines, clampedScroll, fileName, theme]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  if (!visible || !texture) return null;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!e.uv) return;
    const px = e.uv.x * CODE_CANVAS_W;
    const py = (1 - e.uv.y) * CODE_CANVAS_H;
    if (py >= 24 && py <= 76) {
      if (px >= 732 && px <= 814) {
        setScrollLine((s) => Math.max(0, s - 8));
        pulseEventHaptic(e, 0.1, 8);
        onCue?.("tick");
      } else if (px >= 822 && px <= 908) {
        setScrollLine((s) => Math.min(maxScroll, s + 8));
        pulseEventHaptic(e, 0.1, 8);
        onCue?.("tick");
      } else if (px >= 916 && px <= 996) {
        pulseEventHaptic(e, 0.14, 10);
        onCue?.("click");
        onClose();
      }
    }
  };

  return (
    <group
      name="vr-floating-code-panel"
      position={centered ? [0, 1.44, -1.08] : [0.92, 1.46, -0.82]}
      rotation={centered ? [0, 0, 0] : [0, -0.46, 0]}
    >
      <mesh onPointerDown={handlePointerDown}>
        <planeGeometry args={centered ? [1.28, 0.96] : [0.96, 0.72]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. VrInspectorPanel3D — Live Parameters, Selected Component & Diagnostics
// ═══════════════════════════════════════════════════════════════════════════

export interface VrInspectorPanel3DProps {
  visible: boolean;
  fileName: string;
  theme: DiagramLanguageTheme;
  inspectorData?: RotundaInspectorData | undefined;
  centered?: boolean | undefined;
  onClose: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

const INSP_W = 896;
const INSP_H = 720;

export function VrInspectorPanel3D({
  visible,
  fileName,
  theme,
  inspectorData,
  centered = false,
  onClose,
  onCue,
}: VrInspectorPanel3DProps): React.ReactElement | null {
  const texture = useMemo(() => {
    if (typeof document === "undefined" || !visible) return null;
    const canvas = document.createElement("canvas");
    canvas.width = INSP_W;
    canvas.height = INSP_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, INSP_W, INSP_H);

    drawRoundedRect(ctx, 8, 8, INSP_W - 16, INSP_H - 16, 22);
    ctx.fillStyle = "rgba(11, 18, 34, 0.94)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.secondaryColor;
    ctx.stroke();

    // Header
    drawRoundedRect(ctx, 18, 18, INSP_W - 36, 62, 14);
    ctx.fillStyle = theme.headerBg;
    ctx.fill();

    drawRoundedRect(ctx, 30, 30, 148, 38, 10);
    ctx.fillStyle = theme.accentColor;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 17px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("INSPECTOR", 104, 49);

    ctx.textAlign = "left";
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 22px ${UI_FONT}`;
    ctx.fillText(`${theme.badgeLabel} · ${fileName.slice(0, 26)}`, 196, 49);

    // Close button
    drawRoundedRect(ctx, INSP_W - 96, 28, 68, 42, 10);
    ctx.fillStyle = "rgba(185, 28, 28, 0.85)";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText("✕", INSP_W - 62, 49);

    // Selected Component Banner
    ctx.textAlign = "left";
    let y = 112;
    ctx.fillStyle = "#94a3b8";
    ctx.font = `700 16px ${UI_FONT}`;
    ctx.fillText("ACTIVE ELEMENT / DIAGRAM PARADIGM", 28, y);
    y += 28;
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 21px ${MONO_FONT}`;
    ctx.fillText(inspectorData?.selectedComponent || theme.diagramKindLabel, 28, y);

    // Parameters Section
    y += 42;
    ctx.fillStyle = theme.secondaryColor;
    ctx.font = `800 17px ${UI_FONT}`;
    const params = inspectorData?.parameters ?? [];
    ctx.fillText(`PARAMETERS (${params.length})`, 28, y);
    y += 22;

    if (params.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `500 18px ${UI_FONT}`;
      ctx.fillText("No editable parameters extracted for this file yet.", 28, y + 18);
      y += 46;
    } else {
      const shown = params.slice(0, 8);
      for (const p of shown) {
        drawRoundedRect(ctx, 26, y, INSP_W - 52, 42, 10);
        ctx.fillStyle = "rgba(30, 41, 59, 0.75)";
        ctx.fill();
        ctx.fillStyle = "#e2e8f0";
        ctx.font = `700 18px ${MONO_FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(p.name.slice(0, 32), 42, y + 21);
        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "right";
        const valText = `${p.value}${p.unit ? ` ${p.unit}` : ""}`;
        ctx.fillText(valText.slice(0, 22), INSP_W - 42, y + 21);
        y += 48;
      }
    }

    // Diagnostics Section
    y = Math.max(y + 18, 520);
    const diags = inspectorData?.diagnostics ?? [];
    ctx.textAlign = "left";
    ctx.fillStyle = diags.some((d) => d.severity === "error") ? "#f87171" : "#34d399";
    ctx.font = `800 17px ${UI_FONT}`;
    ctx.fillText(diags.length === 0 ? "DIAGNOSTICS · ALL CLEAR (0 ISSUES)" : `DIAGNOSTICS (${diags.length})`, 28, y);
    y += 28;
    for (const d of diags.slice(0, 4)) {
      ctx.fillStyle = d.severity === "error" ? "#fca5a5" : "#fde68a";
      ctx.font = `600 16px ${MONO_FONT}`;
      ctx.fillText(`L${d.line}: ${d.message.slice(0, 62)}`, 28, y);
      y += 26;
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, [visible, fileName, theme, inspectorData]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  if (!visible || !texture) return null;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!e.uv) return;
    const px = e.uv.x * INSP_W;
    const py = (1 - e.uv.y) * INSP_H;
    if (py >= 24 && py <= 76 && px >= INSP_W - 98) {
      pulseEventHaptic(e, 0.14, 10);
      onCue?.("click");
      onClose();
    }
  };

  return (
    <group
      name="vr-inspector-panel"
      position={centered ? [0, 1.44, -1.08] : [-0.92, 1.46, -0.82]}
      rotation={centered ? [0, 0, 0] : [0, 0.46, 0]}
    >
      <mesh onPointerDown={handlePointerDown}>
        <planeGeometry args={centered ? [1.18, 0.94] : [0.88, 0.7]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. VrFileCarousel3D — Animated Curved 3D Workspace File Switcher Carousel
// ═══════════════════════════════════════════════════════════════════════════

export interface VrFileCarousel3DProps {
  visible: boolean;
  files: readonly RotundaWorkspaceFile[];
  activeFilePath?: string | undefined;
  onSelectFile: (filePath: string) => void;
  onClose: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

function createFileCardTexture(
  file: RotundaWorkspaceFile,
  isActive: boolean,
  isHovered: boolean,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const theme = resolveDiagramLanguageTheme(file.languageId, file.diagramType);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawRoundedRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 20);
  ctx.fillStyle = isActive ? theme.headerBg : isHovered ? "#13223b" : "rgba(15, 23, 42, 0.92)";
  ctx.fill();
  ctx.lineWidth = isActive ? 5 : isHovered ? 3.5 : 2;
  ctx.strokeStyle = isActive ? theme.secondaryColor : isHovered ? "#38bdf8" : "#334155";
  ctx.stroke();

  // Top language strip
  drawRoundedRect(ctx, 20, 18, canvas.width - 40, 10, 5);
  ctx.fillStyle = theme.accentColor;
  ctx.fill();

  // Language pill
  drawRoundedRect(ctx, 22, 42, 148, 34, 9);
  ctx.fillStyle = theme.accentColor;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 16px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(theme.badgeLabel, 96, 59);

  if (isActive) {
    drawRoundedRect(ctx, canvas.width - 124, 42, 102, 34, 9);
    ctx.fillStyle = "#059669";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 14px ${UI_FONT}`;
    ctx.fillText("● ACTIVE", canvas.width - 73, 59);
  }

  // File name
  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = `700 26px ${MONO_FONT}`;
  const cleanName = file.name.length > 18 ? `${file.name.slice(0, 17)}…` : file.name;
  ctx.fillText(`${cleanName}${file.dirty ? " •" : ""}`, 24, 126);

  // Path + diagram kind subtitle
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 16px ${UI_FONT}`;
  ctx.fillText(theme.diagramKindLabel.slice(0, 32), 24, 168);

  ctx.fillStyle = "#64748b";
  ctx.font = `500 15px ${MONO_FONT}`;
  const shortPath = file.path.length > 32 ? `…${file.path.slice(-31)}` : file.path;
  ctx.fillText(shortPath, 24, 202);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function FileCarouselCard({
  file,
  isActive,
  onSelect,
  onCue,
}: {
  file: RotundaWorkspaceFile;
  isActive: boolean;
  onSelect: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}): React.ReactElement | null {
  const [hovered, setHovered] = useState(false);
  const tex = useMemo(() => createFileCardTexture(file, isActive, hovered), [file, isActive, hovered]);
  useEffect(() => {
    return () => {
      tex?.dispose();
    };
  }, [tex]);
  if (!tex) return null;

  return (
    <mesh
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        pulseEventHaptic(e, 0.06, 5);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHovered(false);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        pulseEventHaptic(e, 0.16, 12);
        onCue?.("page");
        onSelect();
      }}
    >
      <planeGeometry args={[0.38, 0.24]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

/**
 * Curved 3D Workspace File Carousel floating cleanly at eye level, displaying
 * all available files in the current Ansatz workspace with smooth orbital
 * slide animation when switching files.
 */
export function VrFileCarousel3D({
  visible,
  files,
  activeFilePath,
  onSelectFile,
  onClose,
  onCue,
}: VrFileCarousel3DProps): React.ReactElement | null {
  const activeIndex = Math.max(
    0,
    files.findIndex((f) => f.path === activeFilePath),
  );
  const smoothIndexRef = useRef(activeIndex);
  const cardGroupRefs = useRef<(THREE.Group | null)[]>([]);

  useFrame((_state, rawDelta) => {
    if (!visible) return;
    const dt = Math.min(rawDelta, 0.05);
    const alpha = 1 - Math.exp(-dt * 10);
    smoothIndexRef.current += (activeIndex - smoothIndexRef.current) * alpha;

    const radius = 1.42;
    const angleStep = 0.31;
    for (let i = 0; i < files.length; i++) {
      const grp = cardGroupRefs.current[i];
      if (!grp) continue;
      const rel = i - smoothIndexRef.current;
      const clampedRel = Math.max(-3.5, Math.min(3.5, rel));
      const theta = clampedRel * angleStep;
      const x = Math.sin(theta) * radius;
      const z = -Math.cos(theta) * radius + radius * 0.25;
      const y = -Math.abs(clampedRel) * 0.025;
      const scale = Math.max(0.55, 1.08 - Math.abs(clampedRel) * 0.14);
      grp.position.set(x, y, z);
      grp.rotation.set(0, -theta * 0.85, 0);
      grp.scale.setScalar(scale);
      grp.visible = Math.abs(rel) <= 3.6;
    }
  });

  if (!visible || files.length === 0) return null;

  return (
    <group name="vr-workspace-file-carousel" position={[0, 1.76, -0.22]}>
      {files.map((file, idx) => (
        <group
          key={file.path}
          ref={(el) => {
            cardGroupRefs.current[idx] = el;
          }}
        >
          <FileCarouselCard
            file={file}
            isActive={file.path === activeFilePath}
            onSelect={() => {
              onSelectFile(file.path);
              onClose();
            }}
            onCue={onCue}
          />
        </group>
      ))}
    </group>
  );
}
