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
  /** Optional X coordinate when right-docked beside wide stages such as Diagram. */
  dockOffsetX?: number | undefined;
  workspaceFiles?: readonly RotundaWorkspaceFile[] | undefined;
  activeFilePath?: string | undefined;
  onSelectFile?: ((path: string) => void) | undefined;
  diagnostics?: RotundaInspectorData["diagnostics"];
  focusLine?: number | null | undefined;
  /** External jump command triggered from dock controls (Scroll Top / Bottom). */
  scrollCommand?: { readonly action: "top" | "bottom"; readonly seq: number } | null | undefined;
  onClose: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

const CODE_CANVAS_W = 1024;
const CODE_CANVAS_H = 768;
const CODE_VISIBLE_LINES = 22;

export function FloatingCodePanel3D({
  visible,
  code,
  fileName,
  theme,
  centered = false,
  dockOffsetX = 1.16,
  workspaceFiles,
  activeFilePath,
  onSelectFile,
  diagnostics,
  focusLine = null,
  scrollCommand = null,
  onClose,
  onCue,
}: FloatingCodePanel3DProps): React.ReactElement | null {
  const [scrollLine, setScrollLine] = useState(0);
  const lines = useMemo(() => (code || "// Empty file").split(/\r?\n/), [code]);
  const maxScroll = Math.max(0, lines.length - CODE_VISIBLE_LINES);

  useEffect(() => {
    setScrollLine(0);
  }, [fileName]);

  useEffect(() => {
    if (focusLine && focusLine > 0) {
      setScrollLine(Math.max(0, Math.min(maxScroll, focusLine - 4)));
    }
  }, [focusLine, maxScroll]);

  useEffect(() => {
    if (!scrollCommand) return;
    setScrollLine(scrollCommand.action === "top" ? 0 : maxScroll);
  }, [scrollCommand, maxScroll]);

  const clampedScroll = Math.min(scrollLine, maxScroll);
  const shownTabs = useMemo(
    () => (workspaceFiles && workspaceFiles.length > 1 ? workspaceFiles.slice(0, 5) : []),
    [workspaceFiles],
  );
  const hasTabs = shownTabs.length > 1;

  const diagByLine = useMemo(() => {
    const map = new Map<number, { severity: "error" | "warning" | "info"; message: string }>();
    for (const d of diagnostics ?? []) {
      const existing = map.get(d.line);
      if (!existing || (d.severity === "error" && existing.severity !== "error")) {
        map.set(d.line, { severity: d.severity, message: d.message });
      }
    }
    return map;
  }, [diagnostics]);

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

    // Optional multi-file tab strip
    if (hasTabs) {
      const tabW = Math.floor((CODE_CANVAS_W - 44 - (shownTabs.length - 1) * 8) / shownTabs.length);
      for (let t = 0; t < shownTabs.length; t++) {
        const f = shownTabs[t]!;
        const tx = 22 + t * (tabW + 8);
        const isActive = f.path === activeFilePath || f.name === fileName;
        drawRoundedRect(ctx, tx, 88, tabW, 34, 8);
        ctx.fillStyle = isActive ? "rgba(56, 189, 248, 0.24)" : "rgba(30, 41, 59, 0.72)";
        ctx.fill();
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.strokeStyle = isActive ? theme.secondaryColor : "rgba(148, 163, 184, 0.22)";
        ctx.stroke();
        ctx.fillStyle = isActive ? "#ffffff" : "#94a3b8";
        ctx.font = `${isActive ? "700" : "500"} 15px ${MONO_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const tabLabel = f.name.length > 16 ? `${f.name.slice(0, 15)}…` : f.name;
        ctx.fillText(tabLabel, tx + tabW * 0.5, 105);
      }
    }

    // Code lines with lightweight syntax coloring + diagnostic gutter markers
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const startY = hasTabs ? 142 : 108;
    const lineH = 26;

    for (let i = 0; i < CODE_VISIBLE_LINES; i++) {
      const lineIdx = clampedScroll + i;
      if (lineIdx >= lines.length) break;
      const lineNum = lineIdx + 1;
      const y = startY + i * lineH;
      const rawLine = lines[lineIdx] ?? "";
      const diag = diagByLine.get(lineNum);

      // Highlight focused or diagnostic line background
      if (diag) {
        ctx.fillStyle = diag.severity === "error" ? "rgba(239, 68, 68, 0.16)" : "rgba(245, 158, 11, 0.14)";
        ctx.fillRect(18, y - 12, CODE_CANVAS_W - 36, 24);
      } else if (focusLine === lineNum) {
        ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
        ctx.fillRect(18, y - 12, CODE_CANVAS_W - 36, 24);
      }

      // Gutter diagnostic dot + line number
      if (diag) {
        ctx.beginPath();
        ctx.arc(24, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = diag.severity === "error" ? "#f87171" : "#fbbf24";
        ctx.fill();
      }
      ctx.fillStyle = diag ? (diag.severity === "error" ? "#fca5a5" : "#fde68a") : "#64748b";
      ctx.font = `600 17px ${MONO_FONT}`;
      ctx.fillText(String(lineNum).padStart(3, " "), 34, y);

      // Comment line shortcut
      const trimmed = rawLine.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
        ctx.fillStyle = "#6ee7b7";
        ctx.font = `500 18px ${MONO_FONT}`;
        ctx.fillText(rawLine.slice(0, 72), 92, y);
        continue;
      }

      // Token-colored rendering
      let cursorX = 92;
      const clipped = rawLine.slice(0, 74);
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

    // Footer status (includes active diagnostic count if any)
    const errCount = (diagnostics ?? []).filter((d) => d.severity === "error").length;
    const warnCount = (diagnostics ?? []).filter((d) => d.severity === "warning").length;
    ctx.fillStyle = errCount > 0 ? "#fca5a5" : "#94a3b8";
    ctx.font = `600 16px ${UI_FONT}`;
    ctx.textAlign = "left";
    const diagSuffix = errCount > 0 || warnCount > 0 ? ` · ${errCount} err / ${warnCount} warn` : " · 0 issues";
    ctx.fillText(
      `Lines ${clampedScroll + 1}–${Math.min(lines.length, clampedScroll + CODE_VISIBLE_LINES)} of ${lines.length}${diagSuffix} · Wheel or ▲/▼ to scroll`,
      28,
      CODE_CANVAS_H - 26,
    );

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, [
    visible,
    lines,
    clampedScroll,
    fileName,
    theme,
    hasTabs,
    shownTabs,
    activeFilePath,
    diagByLine,
    diagnostics,
    focusLine,
  ]);

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
      return;
    }
    if (hasTabs && py >= 86 && py <= 124 && onSelectFile) {
      const tabW = Math.floor((CODE_CANVAS_W - 44 - (shownTabs.length - 1) * 8) / shownTabs.length);
      for (let t = 0; t < shownTabs.length; t++) {
        const tx = 22 + t * (tabW + 8);
        if (px >= tx && px <= tx + tabW) {
          const target = shownTabs[t];
          if (target) {
            pulseEventHaptic(e, 0.12, 10);
            onCue?.("page");
            onSelectFile(target.path);
          }
          return;
        }
      }
    }
  };

  return (
    <group
      name="vr-floating-code-panel"
      position={centered ? [0, 1.46, -1.16] : [dockOffsetX, 1.46, -1.04]}
      rotation={centered ? [0, 0, 0] : [0, -0.34, 0]}
    >
      <mesh
        onPointerDown={handlePointerDown}
        onWheel={(e) => {
          e.stopPropagation();
          const deltaLines = e.deltaY > 0 ? 4 : -4;
          setScrollLine((s) => Math.max(0, Math.min(maxScroll, s + deltaLines)));
        }}
      >
        <planeGeometry args={centered ? [1.34, 1.0] : [0.92, 0.69]} />
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
  onJumpToLine?: ((line: number) => void) | undefined;
  onClose: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

const INSP_W = 896;
const INSP_H = 720;
const INSP_PARAMS_PER_PAGE = 6;
const INSP_PARAMS_START_Y = 198;
const INSP_PARAM_ROW_STRIDE = 48;
const INSP_DIAGS_START_Y = 548;

function computeParameterStep(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0) return 1;
  if (abs < 0.2) return 0.01;
  if (abs < 2) return 0.1;
  if (abs < 20) return 1;
  if (abs < 200) return 2;
  return Math.pow(10, Math.floor(Math.log10(abs)) - 1);
}

function formatSteppedParameterValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function VrInspectorPanel3D({
  visible,
  fileName,
  theme,
  inspectorData,
  centered = false,
  onJumpToLine,
  onClose,
  onCue,
}: VrInspectorPanel3DProps): React.ReactElement | null {
  const [paramOffset, setParamOffset] = useState(0);
  const params = useMemo(() => inspectorData?.parameters ?? [], [inspectorData?.parameters]);
  const diags = useMemo(() => inspectorData?.diagnostics ?? [], [inspectorData?.diagnostics]);
  const onModifyParameter = inspectorData?.onModifyParameter;
  const maxParamOffset = Math.max(0, params.length - INSP_PARAMS_PER_PAGE);

  useEffect(() => {
    setParamOffset(0);
  }, [fileName]);

  const clampedParamOffset = Math.min(paramOffset, maxParamOffset);

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
    let y = 110;
    ctx.fillStyle = "#94a3b8";
    ctx.font = `700 15px ${UI_FONT}`;
    ctx.fillText("ACTIVE ELEMENT / DIAGRAM PARADIGM", 28, y);
    y += 28;
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 21px ${MONO_FONT}`;
    ctx.fillText(inspectorData?.selectedComponent || theme.diagramKindLabel, 28, y);

    // Parameters Section Header + Scroll Pager
    y += 38;
    ctx.fillStyle = theme.secondaryColor;
    ctx.font = `800 16px ${UI_FONT}`;
    const editableHint = onModifyParameter ? " · CLICK − / + TO EDIT LIVE" : "";
    ctx.fillText(
      params.length > INSP_PARAMS_PER_PAGE
        ? `PARAMETERS (${clampedParamOffset + 1}–${Math.min(params.length, clampedParamOffset + INSP_PARAMS_PER_PAGE)} of ${params.length})${editableHint}`
        : `PARAMETERS (${params.length})${editableHint}`,
      28,
      y,
    );
    if (params.length > INSP_PARAMS_PER_PAGE) {
      drawRoundedRect(ctx, INSP_W - 154, y - 14, 56, 28, 7);
      ctx.fillStyle = clampedParamOffset > 0 ? "rgba(51, 65, 85, 0.9)" : "rgba(30, 41, 59, 0.4)";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 15px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("▲", INSP_W - 126, y);

      drawRoundedRect(ctx, INSP_W - 90, y - 14, 56, 28, 7);
      ctx.fillStyle = clampedParamOffset < maxParamOffset ? "rgba(51, 65, 85, 0.9)" : "rgba(30, 41, 59, 0.4)";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText("▼", INSP_W - 62, y);
      ctx.textAlign = "left";
    }
    y = INSP_PARAMS_START_Y;

    if (params.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `500 18px ${UI_FONT}`;
      ctx.fillText("No editable parameters extracted for this file yet.", 28, y + 18);
    } else {
      const shown = params.slice(clampedParamOffset, clampedParamOffset + INSP_PARAMS_PER_PAGE);
      for (const p of shown) {
        const numericVal = Number(p.value);
        const canStep = Boolean(onModifyParameter) && p.value.trim() !== "" && Number.isFinite(numericVal);
        drawRoundedRect(ctx, 26, y, INSP_W - 52, 42, 10);
        ctx.fillStyle = "rgba(30, 41, 59, 0.75)";
        ctx.fill();
        ctx.fillStyle = "#e2e8f0";
        ctx.font = `700 18px ${MONO_FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(p.name.slice(0, canStep ? 24 : 32), 42, y + 21);
        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "right";
        const valText = `${p.value}${p.unit ? ` ${p.unit}` : ""}`;
        ctx.fillText(valText.slice(0, 20), canStep ? INSP_W - 158 : INSP_W - 42, y + 21);

        if (canStep) {
          // Minus button
          drawRoundedRect(ctx, INSP_W - 144, y + 6, 44, 30, 7);
          ctx.fillStyle = "rgba(51, 65, 85, 0.92)";
          ctx.fill();
          ctx.fillStyle = "#f8fafc";
          ctx.font = `800 18px ${UI_FONT}`;
          ctx.textAlign = "center";
          ctx.fillText("−", INSP_W - 122, y + 21);

          // Plus button
          drawRoundedRect(ctx, INSP_W - 92, y + 6, 44, 30, 7);
          ctx.fillStyle = "rgba(14, 116, 144, 0.92)";
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.fillText("+", INSP_W - 70, y + 21);
        }
        y += INSP_PARAM_ROW_STRIDE;
      }
    }

    // Diagnostics Section (click any row to jump directly to VR Code at that line)
    let dy = INSP_DIAGS_START_Y - 26;
    ctx.textAlign = "left";
    ctx.fillStyle = diags.some((d) => d.severity === "error") ? "#f87171" : "#34d399";
    ctx.font = `800 16px ${UI_FONT}`;
    ctx.fillText(
      diags.length === 0
        ? "DIAGNOSTICS · ALL CLEAR (0 ISSUES)"
        : `DIAGNOSTICS (${diags.length}) · CLICK TO OPEN LINE IN CODE`,
      28,
      dy,
    );
    dy = INSP_DIAGS_START_Y;
    for (const d of diags.slice(0, 4)) {
      drawRoundedRect(ctx, 26, dy, INSP_W - 52, 32, 8);
      ctx.fillStyle = d.severity === "error" ? "rgba(127, 29, 29, 0.42)" : "rgba(120, 53, 15, 0.36)";
      ctx.fill();
      ctx.fillStyle = d.severity === "error" ? "#fca5a5" : "#fde68a";
      ctx.font = `600 15px ${MONO_FONT}`;
      ctx.fillText(`L${d.line}: ${d.message.slice(0, 62)}`, 38, dy + 16);
      dy += 38;
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, [visible, fileName, theme, inspectorData, params, diags, clampedParamOffset, maxParamOffset, onModifyParameter]);

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
      return;
    }
    if (params.length > INSP_PARAMS_PER_PAGE && py >= 158 && py <= 194) {
      if (px >= INSP_W - 156 && px <= INSP_W - 96) {
        setParamOffset((o) => Math.max(0, o - 3));
        pulseEventHaptic(e, 0.1, 8);
        onCue?.("tick");
        return;
      }
      if (px >= INSP_W - 92 && px <= INSP_W - 32) {
        setParamOffset((o) => Math.min(maxParamOffset, o + 3));
        pulseEventHaptic(e, 0.1, 8);
        onCue?.("tick");
        return;
      }
    }
    // Parameter row numeric − / + steppers
    if (
      onModifyParameter &&
      params.length > 0 &&
      py >= INSP_PARAMS_START_Y &&
      py <= INSP_PARAMS_START_Y + INSP_PARAMS_PER_PAGE * INSP_PARAM_ROW_STRIDE
    ) {
      const rowIdx = Math.floor((py - INSP_PARAMS_START_Y) / INSP_PARAM_ROW_STRIDE);
      const localY = (py - INSP_PARAMS_START_Y) % INSP_PARAM_ROW_STRIDE;
      const param = params[clampedParamOffset + rowIdx];
      if (param && localY <= 42) {
        const numericVal = Number(param.value);
        if (param.value.trim() !== "" && Number.isFinite(numericVal)) {
          const step = computeParameterStep(numericVal);
          if (px >= INSP_W - 146 && px <= INSP_W - 98) {
            pulseEventHaptic(e, 0.12, 10);
            onCue?.("tick");
            onModifyParameter(param.name, formatSteppedParameterValue(numericVal - step));
            return;
          }
          if (px >= INSP_W - 94 && px <= INSP_W - 46) {
            pulseEventHaptic(e, 0.12, 10);
            onCue?.("tick");
            onModifyParameter(param.name, formatSteppedParameterValue(numericVal + step));
            return;
          }
        }
      }
    }
    if (onJumpToLine && diags.length > 0 && py >= INSP_DIAGS_START_Y && py <= INSP_DIAGS_START_Y + 4 * 38) {
      const idx = Math.floor((py - INSP_DIAGS_START_Y) / 38);
      const diag = diags[idx];
      if (diag) {
        pulseEventHaptic(e, 0.14, 12);
        onCue?.("snap");
        onJumpToLine(diag.line);
      }
    }
  };

  return (
    <group
      name="vr-inspector-panel"
      position={centered ? [0, 1.46, -1.22] : [-0.92, 1.46, -0.82]}
      rotation={centered ? [0, 0, 0] : [0, 0.46, 0]}
    >
      <mesh
        onPointerDown={handlePointerDown}
        onWheel={(e) => {
          if (maxParamOffset <= 0) return;
          e.stopPropagation();
          const delta = e.deltaY > 0 ? 2 : -2;
          setParamOffset((o) => Math.max(0, Math.min(maxParamOffset, o + delta)));
        }}
      >
        <planeGeometry args={centered ? [1.22, 0.98] : [0.88, 0.7]} />
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
