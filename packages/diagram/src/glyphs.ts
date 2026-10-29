// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared Vector Glyphs & Engineering Shape Library for AntV X6 rendering.
// Provides reusable DOM-free SVG markup definitions for UML, SysML, and engineering diagrams.

import type { X6Markup } from "./polyglot-diagram-builder.js";

export interface GlyphOptions {
  fill?: string | undefined;
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
  strokeDasharray?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
}

/**
 * UML / SysML Stick Figure Actor Glyph.
 * Consists of head (circle), spine (line), arms (line), and legs (lines).
 */
export function stickFigureActorGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#333333";
  const strokeWidth = options?.strokeWidth ?? 1.5;
  const fill = options?.fill ?? "none";

  return [
    // Head
    {
      tagName: "circle",
      selector: "actorHead",
      attrs: {
        cx: 20,
        cy: 10,
        r: 8,
        fill,
        stroke,
        strokeWidth,
      },
    },
    // Spine
    {
      tagName: "line",
      selector: "actorSpine",
      attrs: {
        x1: 20,
        y1: 18,
        x2: 20,
        y2: 36,
        stroke,
        strokeWidth,
      },
    },
    // Arms
    {
      tagName: "line",
      selector: "actorArms",
      attrs: {
        x1: 6,
        y1: 24,
        x2: 34,
        y2: 24,
        stroke,
        strokeWidth,
      },
    },
    // Left leg
    {
      tagName: "line",
      selector: "actorLeftLeg",
      attrs: {
        x1: 20,
        y1: 36,
        x2: 8,
        y2: 52,
        stroke,
        strokeWidth,
      },
    },
    // Right leg
    {
      tagName: "line",
      selector: "actorRightLeg",
      attrs: {
        x1: 20,
        y1: 36,
        x2: 32,
        y2: 52,
        stroke,
        strokeWidth,
      },
    },
    // Label
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "{{name}}",
        fill: stroke,
        fontSize: 11,
        textAnchor: "middle",
        refX: 20,
        refY: 64,
      },
    },
  ];
}

/**
 * Decision / Merge Diamond Glyph for Activity diagrams.
 */
export function decisionDiamondGlyph(options?: GlyphOptions): X6Markup[] {
  const fill = options?.fill ?? "#e1f5fe";
  const stroke = options?.stroke ?? "#0288d1";
  const strokeWidth = options?.strokeWidth ?? 1.5;

  return [
    {
      tagName: "polygon",
      selector: "body",
      attrs: {
        points: "20,0 40,18 20,36 0,18",
        fill,
        stroke,
        strokeWidth,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "#333",
        fontSize: 10,
        textAnchor: "middle",
        refX: 20,
        refY: 44,
      },
    },
  ];
}

/**
 * Fork / Join Synchronization Bar Glyph for Activity diagrams.
 */
export function forkJoinBarGlyph(options?: {
  orientation?: "horizontal" | "vertical" | undefined;
  length?: number | undefined;
  thickness?: number | undefined;
  fill?: string | undefined;
}): X6Markup[] {
  const orientation = options?.orientation ?? "horizontal";
  const length = options?.length ?? 60;
  const thickness = options?.thickness ?? 6;
  const fill = options?.fill ?? "#263238";

  const width = orientation === "horizontal" ? length : thickness;
  const height = orientation === "horizontal" ? thickness : length;

  return [
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        width,
        height,
        fill,
        rx: 1,
        ry: 1,
      },
    },
  ];
}

/**
 * Initial Pseudostate Glyph (filled solid black circle).
 */
export function pseudostateInitialGlyph(options?: { r?: number | undefined; fill?: string | undefined }): X6Markup[] {
  const r = options?.r ?? 10;
  const fill = options?.fill ?? "#212121";

  return [
    {
      tagName: "circle",
      selector: "body",
      attrs: {
        cx: r,
        cy: r,
        r,
        fill,
        stroke: "none",
      },
    },
  ];
}

/**
 * Final Pseudostate Glyph (bullseye: outer circle with inner solid circle).
 */
export function pseudostateFinalGlyph(options?: {
  outerR?: number | undefined;
  innerR?: number | undefined;
  stroke?: string | undefined;
  fill?: string | undefined;
}): X6Markup[] {
  const outerR = options?.outerR ?? 12;
  const innerR = options?.innerR ?? 7;
  const stroke = options?.stroke ?? "#212121";
  const fill = options?.fill ?? "#212121";

  return [
    {
      tagName: "circle",
      selector: "outer",
      attrs: {
        cx: outerR,
        cy: outerR,
        r: outerR - 1,
        fill: "#ffffff",
        stroke,
        strokeWidth: 1.5,
      },
    },
    {
      tagName: "circle",
      selector: "inner",
      attrs: {
        cx: outerR,
        cy: outerR,
        r: innerR,
        fill,
        stroke: "none",
      },
    },
  ];
}

/**
 * History Pseudostate Glyph (circle containing 'H' or 'H*').
 */
export function pseudostateHistoryGlyph(options?: { deep?: boolean | undefined; r?: number | undefined }): X6Markup[] {
  const deep = options?.deep ?? false;
  const r = options?.r ?? 11;
  const label = deep ? "H*" : "H";

  return [
    {
      tagName: "circle",
      selector: "body",
      attrs: {
        cx: r,
        cy: r,
        r: r - 1,
        fill: "#ffffff",
        stroke: "#333333",
        strokeWidth: 1.5,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: label,
        fill: "#333333",
        fontSize: 12,
        fontWeight: "bold",
        textAnchor: "middle",
        refX: r,
        refY: r + 4,
      },
    },
  ];
}

/**
 * Parameter Pin Port Glyph for Actions and Activities.
 */
export function pinPortGlyph(options?: {
  direction?: "in" | "out" | "inout" | undefined;
  conjugated?: boolean | undefined;
  size?: number | undefined;
}): X6Markup[] {
  const size = options?.size ?? 12;
  const conjugated = options?.conjugated ?? false;
  const fill = conjugated ? "#ffffff" : "#ef6c00";
  const stroke = "#ef6c00";

  return [
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        width: size,
        height: size,
        fill,
        stroke,
        strokeWidth: 1.5,
      },
    },
  ];
}

// ── Interactive SCADA / Modelica Glyphs ─────────────────────────────────────

/**
 * Industrial Pushbutton / Momentary Switch Glyph.
 * Features a tactile button cap, bevel border, and central text label.
 */
export function momentaryButtonGlyph(options?: {
  width?: number | undefined;
  height?: number | undefined;
  color?: string | undefined;
  label?: string | undefined;
}): X6Markup[] {
  const width = options?.width ?? 60;
  const height = options?.height ?? 32;
  const color = options?.color ?? "#d32f2f";
  const label = options?.label ?? "PUSH";

  return [
    // Base bevel
    {
      tagName: "rect",
      selector: "base",
      attrs: {
        width,
        height,
        fill: "#263238",
        stroke: "#37474f",
        strokeWidth: 2,
        rx: 4,
        ry: 4,
      },
    },
    // Button cap (moves down on press)
    {
      tagName: "rect",
      selector: "button",
      attrs: {
        x: 4,
        y: 4,
        width: width - 8,
        height: height - 8,
        fill: color,
        stroke: "#ffffff",
        strokeWidth: 1,
        rx: 3,
        ry: 3,
        cursor: "pointer",
      },
    },
    // Label
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: label,
        fill: "#ffffff",
        fontSize: 10,
        fontWeight: "bold",
        textAnchor: "middle",
        refX: width / 2,
        refY: height / 2 + 3,
        pointerEvents: "none",
      },
    },
  ];
}

/**
 * Industrial Toggle Switch Glyph.
 * Features a switch housing, movable lever handle, and status LED indicator.
 */
export function toggleSwitchGlyph(options?: {
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
}): X6Markup[] {
  const width = options?.width ?? 50;
  const height = options?.height ?? 34;
  const label = options?.label ?? "SW";

  return [
    // Switch plate
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        width,
        height,
        fill: "#eceff1",
        stroke: "#78909c",
        strokeWidth: 1.5,
        rx: 4,
        ry: 4,
        cursor: "pointer",
      },
    },
    // Status LED indicator
    {
      tagName: "circle",
      selector: "indicator",
      attrs: {
        cx: 12,
        cy: 12,
        r: 4,
        fill: "#57606a",
        stroke: "#37474f",
        strokeWidth: 1,
      },
    },
    // Toggle handle lever
    {
      tagName: "line",
      selector: "handle",
      attrs: {
        x1: 25,
        y1: 24,
        x2: 35,
        y2: 10,
        stroke: "#263238",
        strokeWidth: 4,
        strokeLinecap: "round",
        cursor: "pointer",
      },
    },
    // Label
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: label,
        fill: "#37474f",
        fontSize: 9,
        fontWeight: "bold",
        textAnchor: "middle",
        refX: width / 2,
        refY: height - 4,
        pointerEvents: "none",
      },
    },
  ];
}

/**
 * Linear Slider Track Glyph with Draggable Thumb.
 */
export function sliderTrackGlyph(options?: {
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
}): X6Markup[] {
  const width = options?.width ?? 100;
  const height = options?.height ?? 26;
  const label = options?.label ?? "SETPOINT";

  return [
    // Frame
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        width,
        height,
        fill: "#f8f9fa",
        stroke: "#cfd8dc",
        strokeWidth: 1,
        rx: 3,
        ry: 3,
      },
    },
    // Track groove
    {
      tagName: "rect",
      selector: "track",
      attrs: {
        x: 8,
        y: 11,
        width: width - 16,
        height: 4,
        fill: "#b0bec5",
        rx: 2,
        ry: 2,
      },
    },
    // Thumb handle
    {
      tagName: "circle",
      selector: "thumb",
      attrs: {
        cx: 12,
        cy: 13,
        r: 7,
        fill: "#1976d2",
        stroke: "#ffffff",
        strokeWidth: 2,
        cursor: "ew-resize",
      },
    },
    // Readout label
    {
      tagName: "text",
      selector: "value",
      attrs: {
        text: label,
        fill: "#455a64",
        fontSize: 8,
        textAnchor: "middle",
        refX: width / 2,
        refY: height - 2,
        pointerEvents: "none",
      },
    },
  ];
}

/**
 * Numeric Readout / Setpoint Badge Glyph.
 */
export function numericReadoutBadgeGlyph(options?: {
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  unit?: string | undefined;
}): X6Markup[] {
  const width = options?.width ?? 70;
  const height = options?.height ?? 28;
  const label = options?.label ?? "SP";

  return [
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        width,
        height,
        fill: "#1e1e1e",
        stroke: "#424242",
        strokeWidth: 1.5,
        rx: 3,
        ry: 3,
        cursor: "pointer",
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: label,
        fill: "#90caf9",
        fontSize: 8,
        fontWeight: "bold",
        refX: 6,
        refY: 10,
        pointerEvents: "none",
      },
    },
    {
      tagName: "text",
      selector: "value",
      attrs: {
        text: "--",
        fill: "#00e676",
        fontSize: 12,
        fontFamily: "monospace",
        fontWeight: "bold",
        refX: 6,
        refY: 22,
        pointerEvents: "none",
      },
    },
  ];
}

/**
 * IEEE / PSCAD Standard 2-Winding 3-Phase Transformer Glyph
 * (Overlapping Windings, Magnetic Core Bars, Y/Delta Vector Badges, and Terminal Leads).
 */
export function transformerGlyph(
  options?: GlyphOptions & {
    leftPortX?: number | undefined;
    rightPortX?: number | undefined;
    primaryGroup?: string | undefined;
    secondaryGroup?: string | undefined;
  },
): X6Markup[] {
  const stroke = options?.stroke ?? "#0284c7";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  const fill = options?.fill ?? "rgba(2, 132, 199, 0.06)";
  const width = options?.width ?? 72;
  const height = options?.height ?? 52;
  const cy = Math.round(height / 2);
  const centerX = Math.round(width / 2);
  const xLeft = options?.leftPortX !== undefined ? centerX + options.leftPortX : 0;
  const xRight = options?.rightPortX !== undefined ? centerX + options.rightPortX : width;
  const midX = Math.round((xLeft + xRight) / 2);
  const r = 13;
  const priCx = midX - 9;
  const secCx = midX + 9;
  const priBadge = options?.primaryGroup ?? "Y";
  const secBadge = options?.secondaryGroup ?? "Δ";

  return [
    // Primary Terminal Lead
    {
      tagName: "line",
      selector: "primaryLead",
      attrs: {
        x1: xLeft,
        y1: cy,
        x2: priCx - r,
        y2: cy,
        stroke,
        strokeWidth: 2,
      },
    },
    // Secondary Terminal Lead
    {
      tagName: "line",
      selector: "secondaryLead",
      attrs: {
        x1: secCx + r,
        y1: cy,
        x2: xRight,
        y2: cy,
        stroke,
        strokeWidth: 2,
      },
    },
    // Magnetic Core Bars
    {
      tagName: "line",
      selector: "coreBar1",
      attrs: {
        x1: midX - 1.5,
        y1: cy - 15,
        x2: midX - 1.5,
        y2: cy + 15,
        stroke: "#64748b",
        strokeWidth: 1.2,
      },
    },
    {
      tagName: "line",
      selector: "coreBar2",
      attrs: {
        x1: midX + 1.5,
        y1: cy - 15,
        x2: midX + 1.5,
        y2: cy + 15,
        stroke: "#64748b",
        strokeWidth: 1.2,
      },
    },
    // Primary Winding Circle
    {
      tagName: "circle",
      selector: "primaryWinding",
      attrs: {
        cx: priCx,
        cy,
        r,
        fill,
        stroke,
        strokeWidth,
      },
    },
    // Secondary Winding Circle
    {
      tagName: "circle",
      selector: "secondaryWinding",
      attrs: {
        cx: secCx,
        cy,
        r,
        fill,
        stroke,
        strokeWidth,
      },
    },
    // Primary Vector Group Symbol
    {
      tagName: "text",
      selector: "priGroup",
      attrs: {
        text: priBadge,
        fill: stroke,
        fontSize: 7.5,
        fontWeight: "bold",
        fontFamily: "sans-serif",
        refX: priCx - 4,
        refY: cy + 3,
        textAnchor: "middle",
      },
    },
    // Secondary Vector Group Symbol
    {
      tagName: "text",
      selector: "secGroup",
      attrs: {
        text: secBadge,
        fill: stroke,
        fontSize: 7.5,
        fontWeight: "bold",
        fontFamily: "sans-serif",
        refX: secCx + 4,
        refY: cy + 3,
        textAnchor: "middle",
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 9,
        fontWeight: "bold",
        refX: midX,
        refY: height + 4,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * PSCAD / IEEE Synchronous Generator & Three-Phase AC Voltage Source Glyph
 * (Stator Circle, Sine Wave, Grounded Neutral Reference, and Terminal Lead).
 */
export function generatorGlyph(
  options?: GlyphOptions & {
    portOffsetX?: number | undefined;
  },
): X6Markup[] {
  const stroke = options?.stroke ?? "#d97706";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  const fill = options?.fill ?? "rgba(217, 119, 6, 0.08)";
  const width = options?.width ?? 72;
  const height = options?.height ?? 48;
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const r = 15;
  const leadEndX = cx + (options?.portOffsetX ?? 36);

  return [
    // Grounded Neutral Reference Tail (Left)
    {
      tagName: "line",
      selector: "genGndLead",
      attrs: {
        x1: cx - r - 9,
        y1: cy,
        x2: cx - r,
        y2: cy,
        stroke: "#64748b",
        strokeWidth: 1.5,
      },
    },
    {
      tagName: "line",
      selector: "genGndBar1",
      attrs: {
        x1: cx - r - 9,
        y1: cy - 7,
        x2: cx - r - 9,
        y2: cy + 7,
        stroke: "#64748b",
        strokeWidth: 1.6,
      },
    },
    {
      tagName: "line",
      selector: "genGndBar2",
      attrs: {
        x1: cx - r - 12,
        y1: cy - 4.5,
        x2: cx - r - 12,
        y2: cy + 4.5,
        stroke: "#64748b",
        strokeWidth: 1.4,
      },
    },
    {
      tagName: "line",
      selector: "genGndBar3",
      attrs: {
        x1: cx - r - 15,
        y1: cy - 2,
        x2: cx - r - 15,
        y2: cy + 2,
        stroke: "#64748b",
        strokeWidth: 1.2,
      },
    },
    // Output Terminal Lead (Right)
    {
      tagName: "line",
      selector: "genLead",
      attrs: {
        x1: cx + r,
        y1: cy,
        x2: leadEndX,
        y2: cy,
        stroke: "#0284c7",
        strokeWidth: 2,
      },
    },
    // Outer Stator Ring
    {
      tagName: "circle",
      selector: "genCircle",
      attrs: {
        cx,
        cy,
        r,
        fill,
        stroke,
        strokeWidth,
      },
    },
    // Sine Wave ~
    {
      tagName: "path",
      selector: "genSine",
      attrs: {
        d: `M ${cx - 9},${cy} Q ${cx - 4.5},${cy - 8} ${cx},${cy} Q ${cx + 4.5},${cy + 8} ${cx + 9},${cy}`,
        fill: "none",
        stroke,
        strokeWidth: 1.8,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 9,
        fontWeight: "bold",
        refX: cx,
        refY: height + 6,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * PSCAD / IEEE Inverter-Based Resource (IBR / Grid-Forming VSC / BESS) Glyph.
 */
export function inverterIbrGlyph(
  options?: GlyphOptions & {
    portOffsetX?: number | undefined;
    badge?: string | undefined;
  },
): X6Markup[] {
  const stroke = options?.stroke ?? "#059669";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  const fill = options?.fill ?? "rgba(5, 150, 105, 0.08)";
  const width = options?.width ?? 64;
  const height = options?.height ?? 48;
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const portX = cx + (options?.portOffsetX ?? -20);
  const boxX = Math.max(8, portX);
  const boxW = width - boxX - 4;
  const boxY = 4;
  const boxH = height - 8;

  return [
    // AC Terminal Lead
    {
      tagName: "line",
      selector: "ibrLeadL",
      attrs: {
        x1: portX,
        y1: cy,
        x2: boxX,
        y2: cy,
        stroke: "#0284c7",
        strokeWidth: 2,
      },
    },
    // Converter Bridge Housing
    {
      tagName: "rect",
      selector: "ibrBox",
      attrs: {
        x: boxX,
        y: boxY,
        width: boxW,
        height: boxH,
        rx: 3,
        ry: 3,
        fill,
        stroke,
        strokeWidth,
      },
    },
    // Diagonal AC/DC Divider
    {
      tagName: "line",
      selector: "ibrDivider",
      attrs: {
        x1: boxX,
        y1: boxY + boxH,
        x2: boxX + boxW,
        y2: boxY,
        stroke,
        strokeWidth: 1.5,
      },
    },
    // AC Symbol ~ (Top-Left, AC side)
    {
      tagName: "path",
      selector: "acSine",
      attrs: {
        d: `M ${boxX + 6},${boxY + 13} Q ${boxX + 10},${boxY + 7} ${boxX + 14},${boxY + 13} Q ${boxX + 18},${boxY + 19} ${boxX + 22},${boxY + 13}`,
        fill: "none",
        stroke,
        strokeWidth: 1.6,
      },
    },
    // DC Symbol = (Bottom-Right, DC link / BESS side)
    {
      tagName: "line",
      selector: "dcLine1",
      attrs: {
        x1: boxX + boxW - 22,
        y1: boxY + boxH - 14,
        x2: boxX + boxW - 8,
        y2: boxY + boxH - 14,
        stroke,
        strokeWidth: 1.6,
      },
    },
    {
      tagName: "line",
      selector: "dcLine2",
      attrs: {
        x1: boxX + boxW - 22,
        y1: boxY + boxH - 10,
        x2: boxX + boxW - 8,
        y2: boxY + boxH - 10,
        stroke,
        strokeWidth: 1.6,
        strokeDasharray: "3,2",
      },
    },
    // Mode Badge
    {
      tagName: "text",
      selector: "ibrBadge",
      attrs: {
        text: options?.badge ?? "VSC",
        fill: stroke,
        fontSize: 7,
        fontWeight: "bold",
        fontFamily: "monospace",
        refX: boxX + boxW - 14,
        refY: boxY + boxH - 2,
        textAnchor: "middle",
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 9,
        fontWeight: "bold",
        refX: cx,
        refY: height + 6,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * High-Voltage Busbar Glyph.
 */
export function busbarGlyph(options?: {
  length?: number | undefined;
  voltageBaseKv?: number | undefined;
  label?: string | undefined;
}): X6Markup[] {
  const length = options?.length ?? 80;
  const vbase = options?.voltageBaseKv ?? 230;
  const color = vbase >= 200 ? "#ff5252" : vbase >= 69 ? "#ffab40" : "#40c4ff";
  const textLabel = options?.label ? `${options.label} (${vbase} kV)` : `${vbase} kV`;

  return [
    {
      tagName: "rect",
      selector: "busbar",
      attrs: {
        x: 0,
        y: 0,
        width: length,
        height: 6,
        fill: color,
        rx: 2,
        ry: 2,
      },
    },
    {
      tagName: "text",
      selector: "busLabel",
      attrs: {
        text: textLabel,
        fill: color,
        fontSize: 9,
        fontWeight: "bold",
        fontFamily: "monospace",
        refX: length / 2,
        refY: -4,
        textAnchor: "middle",
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: textLabel,
        fill: "none",
        fontSize: 0,
      },
    },
  ];
}

/**
 * IEEE/PSCAD Circuit Breaker Glyph (Square Breaker Housing with Interrupt Cross & Leads).
 */
export function breakerGlyph(options?: GlyphOptions & { isOpen?: boolean | undefined }): X6Markup[] {
  const isOpen = options?.isOpen ?? false;
  const width = options?.width ?? 36;
  const height = options?.height ?? 36;
  const cy = Math.round(height / 2);
  const cx = Math.round(width / 2);
  const stroke = options?.stroke ?? (isOpen ? "#16a34a" : "#dc2626");
  const fill = options?.fill ?? (isOpen ? "rgba(22, 163, 74, 0.12)" : "rgba(220, 38, 38, 0.14)");
  const boxHalf = 11;

  return [
    {
      tagName: "line",
      selector: "brkLeadL",
      attrs: { x1: 0, y1: cy, x2: cx - boxHalf, y2: cy, stroke: "#0284c7", strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "brkLeadR",
      attrs: { x1: cx + boxHalf, y1: cy, x2: width, y2: cy, stroke: "#0284c7", strokeWidth: 2 },
    },
    {
      tagName: "rect",
      selector: "brkBox",
      attrs: {
        x: cx - boxHalf,
        y: cy - boxHalf,
        width: boxHalf * 2,
        height: boxHalf * 2,
        rx: 2,
        ry: 2,
        fill,
        stroke,
        strokeWidth: 1.8,
      },
    },
    {
      tagName: "line",
      selector: "brkCross1",
      attrs: { x1: cx - 6, y1: cy - 6, x2: cx + 6, y2: cy + 6, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "brkCross2",
      attrs: { x1: cx - 6, y1: cy + 6, x2: cx + 6, y2: cy - 6, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 8.5,
        fontWeight: "bold",
        refX: cx,
        refY: height + 5,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * IEEE/IEC ZnO Metal-Oxide Varistor (MOV) Surge Arrester Glyph.
 */
export function surgeArresterGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#7c3aed";
  const fill = options?.fill ?? "rgba(124, 58, 237, 0.12)";
  const width = options?.width ?? 36;
  const height = options?.height ?? 36;
  const cx = Math.round(width / 2);

  return [
    {
      tagName: "line",
      selector: "arrLeadTop",
      attrs: { x1: cx, y1: 0, x2: cx, y2: 7, stroke: "#0284c7", strokeWidth: 2 },
    },
    {
      tagName: "rect",
      selector: "arrBody",
      attrs: { x: cx - 7, y: 7, width: 14, height: 18, rx: 1.5, ry: 1.5, fill, stroke, strokeWidth: 1.6 },
    },
    {
      tagName: "polyline",
      selector: "arrNonlinearBar",
      attrs: {
        points: `${cx - 10},20 ${cx - 5},20 ${cx + 5},11 ${cx + 10},11`,
        fill: "none",
        stroke,
        strokeWidth: 1.5,
      },
    },
    {
      tagName: "line",
      selector: "arrLeadGnd",
      attrs: { x1: cx, y1: 25, x2: cx, y2: 30, stroke, strokeWidth: 1.6 },
    },
    {
      tagName: "line",
      selector: "gnd1",
      attrs: { x1: cx - 8, y1: 30, x2: cx + 8, y2: 30, stroke, strokeWidth: 1.6 },
    },
    {
      tagName: "line",
      selector: "gnd2",
      attrs: { x1: cx - 5, y1: 33, x2: cx + 5, y2: 33, stroke, strokeWidth: 1.4 },
    },
    {
      tagName: "line",
      selector: "gnd3",
      attrs: { x1: cx - 2.5, y1: 36, x2: cx + 2.5, y2: 36, stroke, strokeWidth: 1.2 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 8.5,
        fontWeight: "bold",
        refX: cx,
        refY: height + 6,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * PSCAD Short-Circuit Fault Branch (`master:tpflt` / `fault`) Glyph.
 * Connects at top terminal `(0, -18)` (`(cx, 0)`) with tap lead, fault strike bolt, and ground reference.
 */
export function faultGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#dc2626";
  const fill = options?.fill ?? "rgba(220, 38, 38, 0.22)";
  const width = options?.width ?? 36;
  const height = options?.height ?? 36;
  const cx = Math.round(width / 2);

  return [
    // Top tap lead from port (cx, 0)
    {
      tagName: "line",
      selector: "faultLeadTop",
      attrs: { x1: cx, y1: 0, x2: cx, y2: 6, stroke: "#0284c7", strokeWidth: 2 },
    },
    // Lightning strike polygon
    {
      tagName: "polygon",
      selector: "faultBolt",
      attrs: {
        points: `${cx + 3},4 ${cx - 7},17 ${cx},17 ${cx - 4},29 ${cx + 9},14 ${cx + 1},14`,
        fill,
        stroke,
        strokeWidth: 1.6,
      },
    },
    // Earth ground reference at bottom of fault branch
    {
      tagName: "line",
      selector: "faultGndLead",
      attrs: { x1: cx, y1: 28, x2: cx, y2: 31, stroke: "#64748b", strokeWidth: 1.5 },
    },
    {
      tagName: "line",
      selector: "faultGnd1",
      attrs: { x1: cx - 7, y1: 31, x2: cx + 7, y2: 31, stroke: "#64748b", strokeWidth: 1.5 },
    },
    {
      tagName: "line",
      selector: "faultGnd2",
      attrs: { x1: cx - 4.5, y1: 33.5, x2: cx + 4.5, y2: 33.5, stroke: "#64748b", strokeWidth: 1.3 },
    },
    {
      tagName: "line",
      selector: "faultGnd3",
      attrs: { x1: cx - 2, y1: 36, x2: cx + 2, y2: 36, stroke: "#64748b", strokeWidth: 1.1 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 8.5,
        fontWeight: "bold",
        refX: cx,
        refY: height + 6,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * HVDC / Power-Electronics Converter Bridge (VSC / LCC / MMC) Glyph.
 */
export function converterBridgeGlyph(options?: GlyphOptions & { badge?: string | undefined }): X6Markup[] {
  const stroke = options?.stroke ?? "#059669";
  const fill = options?.fill ?? "rgba(5, 150, 105, 0.1)";
  const badge = options?.badge ?? "MMC";

  return [
    {
      tagName: "rect",
      selector: "convBox",
      attrs: { x: 4, y: 4, width: 64, height: 52, rx: 4, ry: 4, fill, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "convDivider",
      attrs: { x1: 4, y1: 56, x2: 68, y2: 4, stroke, strokeWidth: 1.5 },
    },
    {
      tagName: "path",
      selector: "convAcSine",
      attrs: { d: "M 10,20 Q 16,12 22,20 Q 28,28 34,20", fill: "none", stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "convDc1",
      attrs: { x1: 40, y1: 38, x2: 58, y2: 38, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "convDc2",
      attrs: { x1: 40, y1: 44, x2: 58, y2: 44, stroke, strokeWidth: 1.8, strokeDasharray: "3,2" },
    },
    {
      tagName: "text",
      selector: "convBadge",
      attrs: {
        text: badge,
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 8,
        fontWeight: "bold",
        fontFamily: "monospace",
        refX: 52,
        refY: 16,
        textAnchor: "middle",
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 9,
        fontWeight: "bold",
        refX: 36,
        refY: 66,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * PSCAD Overhead Transmission Line / Underground Coaxial Cable Segment Glyph.
 */
export function transmissionLineGlyph(options?: GlyphOptions & { isCable?: boolean | undefined }): X6Markup[] {
  const isCable = options?.isCable ?? false;
  const width = options?.width ?? 72;
  const height = options?.height ?? 36;
  const cy = Math.round(height / 2);
  const cx = Math.round(width / 2);
  const stroke = options?.stroke ?? (isCable ? "#c026d3" : "#0284c7");
  const fill = options?.fill ?? (isCable ? "rgba(192, 38, 211, 0.08)" : "rgba(2, 132, 199, 0.08)");

  return [
    // Cylinder / Pi-Section Capsule
    {
      tagName: "rect",
      selector: "tlineBox",
      attrs: {
        x: 8,
        y: cy - 9,
        width: width - 16,
        height: 18,
        rx: 9,
        ry: 9,
        fill,
        stroke,
        strokeWidth: 1.6,
      },
    },
    // Through-Conductor Line reaching exact ports at x=0 and x=width
    {
      tagName: "line",
      selector: "tlineCore",
      attrs: {
        x1: 0,
        y1: cy,
        x2: width,
        y2: cy,
        stroke,
        strokeWidth: 2,
        ...(isCable ? { strokeDasharray: "4,2" } : {}),
      },
    },
    // Three-Phase Bundle Slash Marks (///)
    {
      tagName: "line",
      selector: "tlinePhase1",
      attrs: { x1: cx - 6, y1: cy + 5, x2: cx - 2, y2: cy - 5, stroke, strokeWidth: 1.3 },
    },
    {
      tagName: "line",
      selector: "tlinePhase2",
      attrs: { x1: cx - 2, y1: cy + 5, x2: cx + 2, y2: cy - 5, stroke, strokeWidth: 1.3 },
    },
    {
      tagName: "line",
      selector: "tlinePhase3",
      attrs: { x1: cx + 2, y1: cy + 5, x2: cx + 6, y2: cy - 5, stroke, strokeWidth: 1.3 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 8.5,
        fontWeight: "bold",
        refX: cx,
        refY: height + 6,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * PSCAD / IEEE Passive Branch Glyph (`master:rlc`, `master:resistor`, `master:inductor`, `master:capacitor`).
 * Aligned to PSCAD's 18-unit grid ports (`(-18, 0)` to `(+18, 0)` on a `36 x 36` canvas).
 */
export function passiveBranchGlyph(
  options?: GlyphOptions & {
    kind?: "rlc" | "resistor" | "inductor" | "capacitor" | undefined;
    hasShuntC?: boolean | undefined;
  },
): X6Markup[] {
  const kind = options?.kind ?? "rlc";
  const width = options?.width ?? 36;
  const height = options?.height ?? 36;
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const stroke = options?.stroke ?? "#0284c7";
  const strokeWidth = options?.strokeWidth ?? 1.8;

  if (kind === "capacitor") {
    return [
      {
        tagName: "line",
        selector: "passiveLeadL",
        attrs: { x1: 0, y1: cy, x2: cx - 3, y2: cy, stroke, strokeWidth: 2 },
      },
      {
        tagName: "line",
        selector: "passiveLeadR",
        attrs: { x1: cx + 3, y1: cy, x2: width, y2: cy, stroke, strokeWidth: 2 },
      },
      {
        tagName: "line",
        selector: "capPlate1",
        attrs: { x1: cx - 3, y1: cy - 9, x2: cx - 3, y2: cy + 9, stroke, strokeWidth: 2.2 },
      },
      {
        tagName: "line",
        selector: "capPlate2",
        attrs: { x1: cx + 3, y1: cy - 9, x2: cx + 3, y2: cy + 9, stroke, strokeWidth: 2.2 },
      },
      {
        tagName: "text",
        selector: "label",
        attrs: {
          text: options?.label ?? "",
          fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
          fontSize: 8.5,
          fontWeight: "bold",
          refX: cx,
          refY: height + 5,
          textAnchor: "middle",
        },
      },
    ];
  }

  if (kind === "resistor") {
    return [
      {
        tagName: "line",
        selector: "passiveLeadL",
        attrs: { x1: 0, y1: cy, x2: 5, y2: cy, stroke, strokeWidth: 2 },
      },
      {
        tagName: "line",
        selector: "passiveLeadR",
        attrs: { x1: width - 5, y1: cy, x2: width, y2: cy, stroke, strokeWidth: 2 },
      },
      {
        tagName: "polyline",
        selector: "passiveBody",
        attrs: {
          points: `5,${cy} 8,${cy - 6} 12,${cy + 6} 16,${cy - 6} 20,${cy + 6} 24,${cy - 6} 28,${cy + 6} ${width - 5},${cy}`,
          fill: "none",
          stroke,
          strokeWidth,
        },
      },
      {
        tagName: "text",
        selector: "label",
        attrs: {
          text: options?.label ?? "",
          fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
          fontSize: 8.5,
          fontWeight: "bold",
          refX: cx,
          refY: height + 5,
          textAnchor: "middle",
        },
      },
    ];
  }

  // Inductor or composite RLC / LCL harmonic filter
  const showShunt = kind === "rlc" && (options?.hasShuntC ?? true);
  const items: X6Markup[] = [
    {
      tagName: "line",
      selector: "passiveLeadL",
      attrs: { x1: 0, y1: cy, x2: 4, y2: cy, stroke, strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "passiveLeadR",
      attrs: { x1: width - 4, y1: cy, x2: width, y2: cy, stroke, strokeWidth: 2 },
    },
    {
      tagName: "path",
      selector: "passiveBody",
      attrs: {
        d: `M 4,${cy} A 3.5,5 0 0,1 11,${cy} A 3.5,5 0 0,1 18,${cy} A 3.5,5 0 0,1 25,${cy} A 3.5,5 0 0,1 ${width - 4},${cy}`,
        fill: "none",
        stroke,
        strokeWidth,
      },
    },
  ];

  if (showShunt) {
    items.push(
      {
        tagName: "line",
        selector: "shuntTap",
        attrs: { x1: cx, y1: cy, x2: cx, y2: cy + 6, stroke, strokeWidth: 1.5 },
      },
      {
        tagName: "line",
        selector: "shuntCap1",
        attrs: { x1: cx - 5, y1: cy + 6, x2: cx + 5, y2: cy + 6, stroke, strokeWidth: 1.8 },
      },
      {
        tagName: "line",
        selector: "shuntCap2",
        attrs: { x1: cx - 5, y1: cy + 9, x2: cx + 5, y2: cy + 9, stroke, strokeWidth: 1.8 },
      },
      {
        tagName: "line",
        selector: "shuntGndLead",
        attrs: { x1: cx, y1: cy + 9, x2: cx, y2: cy + 13, stroke: "#64748b", strokeWidth: 1.4 },
      },
      {
        tagName: "line",
        selector: "shuntGnd1",
        attrs: { x1: cx - 4, y1: cy + 13, x2: cx + 4, y2: cy + 13, stroke: "#64748b", strokeWidth: 1.4 },
      },
      {
        tagName: "line",
        selector: "shuntGnd2",
        attrs: { x1: cx - 2, y1: cy + 15.5, x2: cx + 2, y2: cy + 15.5, stroke: "#64748b", strokeWidth: 1.2 },
      },
    );
  }

  items.push({
    tagName: "text",
    selector: "label",
    attrs: {
      text: options?.label ?? "",
      fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
      fontSize: 8.5,
      fontWeight: "bold",
      refX: cx,
      refY: height + 5,
      textAnchor: "middle",
    },
  });

  return items;
}

/**
 * PSCAD Earth Ground Symbol (`master:ground`) with top port at `(0, -18)` (`(cx, 0)`).
 */
export function pscadGroundGlyph(options?: GlyphOptions): X6Markup[] {
  const width = options?.width ?? 24;
  const cx = Math.round(width / 2);
  const stroke = options?.stroke ?? "#64748b";

  return [
    {
      tagName: "line",
      selector: "gndLead",
      attrs: { x1: cx, y1: 0, x2: cx, y2: 18, stroke, strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "gndBar1",
      attrs: { x1: cx - 9, y1: 18, x2: cx + 9, y2: 18, stroke, strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "gndBar2",
      attrs: { x1: cx - 6, y1: 23, x2: cx + 6, y2: 23, stroke, strokeWidth: 1.7 },
    },
    {
      tagName: "line",
      selector: "gndBar3",
      attrs: { x1: cx - 3, y1: 28, x2: cx + 3, y2: 28, stroke, strokeWidth: 1.4 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: "",
        fill: "none",
        fontSize: 0,
      },
    },
  ];
}

/**
 * PSCAD Three-Phase PQ Feeder Load Symbol (`master:fixed_load` / `master:load`).
 */
export function loadGlyph(options?: GlyphOptions): X6Markup[] {
  const width = options?.width ?? 32;
  const height = options?.height ?? 36;
  const cx = Math.round(width / 2);
  const stroke = options?.stroke ?? "#0284c7";
  const fill = options?.fill ?? "rgba(2, 132, 199, 0.14)";

  return [
    {
      tagName: "line",
      selector: "loadLead",
      attrs: { x1: cx, y1: 0, x2: cx, y2: 12, stroke, strokeWidth: 2 },
    },
    {
      tagName: "polygon",
      selector: "loadTriangle",
      attrs: {
        points: `${cx - 10},12 ${cx + 10},12 ${cx},30`,
        fill,
        stroke,
        strokeWidth: 1.8,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 8.5,
        fontWeight: "bold",
        refX: cx,
        refY: height + 5,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * PSCAD CSMF (Continuous System Model Functions) Control Block Glyph.
 * Supports Summing Junction (Σ), Gain Triangle (K), PI / Lag Transfer Function,
 * Hard Limiter Saturation Curve, Comparator Relay, and Constant Setpoint.
 */
export function csmfBlockGlyph(
  options?: GlyphOptions & {
    kind?: "pi" | "lag" | "sum" | "gain" | "limit" | "compar" | "const" | undefined;
    label?: string | undefined;
  },
): X6Markup[] {
  const kind = options?.kind ?? "pi";
  const stroke = options?.stroke ?? "#7c3aed";
  const fill = options?.fill ?? "rgba(124, 58, 237, 0.08)";
  const label = options?.label ?? kind.toUpperCase();

  if (kind === "sum") {
    return [
      {
        tagName: "circle",
        selector: "csmfSumCircle",
        attrs: { cx: 22, cy: 22, r: 18, fill, stroke, strokeWidth: 1.8 },
      },
      {
        tagName: "text",
        selector: "csmfSymbol",
        attrs: {
          text: "Σ",
          fill: "#6d28d9",
          fontSize: 14,
          fontWeight: "bold",
          refX: 22,
          refY: 22,
          textAnchor: "middle",
          textVerticalAnchor: "middle",
        },
      },
      {
        tagName: "text",
        selector: "label",
        attrs: {
          text: label,
          fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
          fontSize: 8,
          refX: 22,
          refY: 46,
          textAnchor: "middle",
        },
      },
    ];
  }

  if (kind === "gain") {
    return [
      {
        tagName: "polygon",
        selector: "csmfGainTriangle",
        attrs: { points: "4,4 48,20 4,36", fill, stroke, strokeWidth: 1.8 },
      },
      {
        tagName: "text",
        selector: "csmfSymbol",
        attrs: {
          text: "K",
          fill: "#6d28d9",
          fontSize: 11,
          fontWeight: "bold",
          refX: 18,
          refY: 20,
          textAnchor: "middle",
          textVerticalAnchor: "middle",
        },
      },
      {
        tagName: "text",
        selector: "label",
        attrs: {
          text: label,
          fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
          fontSize: 8,
          refX: 26,
          refY: 46,
          textAnchor: "middle",
        },
      },
    ];
  }

  const curvePath =
    kind === "limit"
      ? "M 12,30 L 22,30 L 40,12 L 50,12"
      : kind === "compar"
        ? "M 12,30 L 30,30 L 30,12 L 50,12"
        : "M 12,30 Q 24,14 50,12";

  return [
    {
      tagName: "rect",
      selector: "csmfBox",
      attrs: { x: 2, y: 2, width: 60, height: 38, rx: 4, ry: 4, fill, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "path",
      selector: "csmfCurve",
      attrs: { d: curvePath, fill: "none", stroke: "#7c3aed", strokeWidth: 1.5 },
    },
    {
      tagName: "text",
      selector: "csmfBadge",
      attrs: {
        text: kind === "pi" ? "PI" : kind === "lag" ? "1/(1+sT)" : kind === "const" ? "CONST" : kind.toUpperCase(),
        fill: "#6d28d9",
        fontSize: 8,
        fontWeight: "bold",
        fontFamily: "monospace",
        refX: 32,
        refY: 9,
        textAnchor: "middle",
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: label,
        fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
        fontSize: 8,
        refX: 32,
        refY: 48,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * PSCAD Oscilloscope Output Channel Probe (`PGB`) & Digital Multimeter (`V, I, P, Q`) Glyph.
 */
export function meterProbeGlyph(
  options?: GlyphOptions & {
    kind?: "pgb" | "multimeter" | "voltmeter" | "ammeter" | undefined;
    label?: string | undefined;
  },
): X6Markup[] {
  const kind = options?.kind ?? "pgb";
  const stroke = options?.stroke ?? "#10b981";
  const fill = options?.fill ?? "rgba(16, 185, 129, 0.12)";
  const label = options?.label ?? (kind === "pgb" ? "PGB" : "V/I/PQ");

  if (kind === "pgb") {
    return [
      {
        tagName: "polygon",
        selector: "pgbTag",
        attrs: { points: "0,17 12,4 52,4 52,30 12,30", fill, stroke, strokeWidth: 1.8 },
      },
      {
        tagName: "path",
        selector: "pgbWave",
        attrs: { d: "M 16,17 Q 21,9 26,17 Q 31,25 36,17", fill: "none", stroke, strokeWidth: 1.5 },
      },
      {
        tagName: "text",
        selector: "label",
        attrs: {
          text: label,
          fill: "#ecfdf5",
          fontSize: 8,
          fontWeight: "bold",
          fontFamily: "monospace",
          refX: 34,
          refY: 27,
          textAnchor: "middle",
        },
      },
    ];
  }

  return [
    {
      tagName: "circle",
      selector: "meterCircle",
      attrs: { cx: 24, cy: 22, r: 18, fill, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "meterNeedle",
      attrs: { x1: 24, y1: 26, x2: 32, y2: 14, stroke: "#34d399", strokeWidth: 1.6 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: label,
        fill: "#ecfdf5",
        fontSize: 8,
        fontWeight: "bold",
        fontFamily: "monospace",
        refX: 24,
        refY: 31,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * PSCAD Wireless Data Label (`master:datalabel`) & XNode (`master:xnode` / `pin`) Tag Glyph.
 */
export function wirelessNetLabelGlyph(
  options?: GlyphOptions & {
    label?: string | undefined;
    isElectrical?: boolean | undefined;
  },
): X6Markup[] {
  const isElectrical = options?.isElectrical ?? false;
  const stroke = options?.stroke ?? (isElectrical ? "#38bdf8" : "#c084fc");
  const fill = options?.fill ?? (isElectrical ? "rgba(56, 189, 248, 0.14)" : "rgba(192, 132, 252, 0.14)");
  const label = options?.label ?? "NET";

  return [
    {
      tagName: "circle",
      selector: "netPin",
      attrs: { cx: 6, cy: 12, r: 3.5, fill: stroke, stroke: "#0f172a", strokeWidth: 1.5 },
    },
    {
      tagName: "polygon",
      selector: "netFlag",
      attrs: { points: "10,12 16,3 44,3 44,21 16,21", fill, stroke, strokeWidth: 1.5 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: label,
        fill: "#f8fafc",
        fontSize: 8.5,
        fontWeight: "bold",
        fontFamily: "monospace",
        refX: 29,
        refY: 15,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * IEEE Std 315 Resistor Glyph (Zig-Zag).
 */
export function resistorGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#38bdf8";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  return [
    {
      tagName: "path",
      selector: "body",
      attrs: {
        d: "M 0,15 L 0,22 L -8,26 L 8,32 L -8,38 L 8,44 L -8,50 L 0,54 L 0,60",
        fill: "none",
        stroke,
        strokeWidth,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    },
  ];
}

/**
 * IEEE Std 315 Capacitor Glyph (Parallel Plates).
 */
export function capacitorGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#818cf8";
  const strokeWidth = options?.strokeWidth ?? 2;
  return [
    {
      tagName: "line",
      selector: "leadTop",
      attrs: { x1: 0, y1: 15, x2: 0, y2: 33, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "plateTop",
      attrs: { x1: -12, y1: 33, x2: 12, y2: 33, stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "plateBottom",
      attrs: { x1: -12, y1: 42, x2: 12, y2: 42, stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "leadBottom",
      attrs: { x1: 0, y1: 42, x2: 0, y2: 60, stroke, strokeWidth: 1.8 },
    },
  ];
}

/**
 * IEEE Std 315 Inductor Glyph (Coils).
 */
export function inductorGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#34d399";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  return [
    {
      tagName: "path",
      selector: "body",
      attrs: {
        d: "M 0,15 L 0,22 A 6,6 0 0,1 0,34 A 6,6 0 0,1 0,46 A 6,6 0 0,1 0,56 L 0,60",
        fill: "none",
        stroke,
        strokeWidth,
        strokeLinecap: "round",
      },
    },
  ];
}

/**
 * IEEE Std 315 Diode Glyph (Triangle & Cathode Bar).
 */
export function diodeGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#f43f5e";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  return [
    {
      tagName: "line",
      selector: "leadAnode",
      attrs: { x1: 0, y1: 15, x2: 0, y2: 26, stroke, strokeWidth },
    },
    {
      tagName: "polygon",
      selector: "triangle",
      attrs: { points: "-10,26 10,26 0,44", fill: stroke, stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "bar",
      attrs: { x1: -10, y1: 44, x2: 10, y2: 44, stroke, strokeWidth: 2.2 },
    },
    {
      tagName: "line",
      selector: "leadCathode",
      attrs: { x1: 0, y1: 44, x2: 0, y2: 60, stroke, strokeWidth },
    },
  ];
}

/**
 * IEEE Std 315 Electrical Ground Glyph.
 */
export function groundGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#10b981";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  return [
    {
      tagName: "line",
      selector: "stem",
      attrs: { x1: 0, y1: 0, x2: 0, y2: 12, stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "line1",
      attrs: { x1: -12, y1: 12, x2: 12, y2: 12, stroke, strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "line2",
      attrs: { x1: -8, y1: 17, x2: 8, y2: 17, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "line3",
      attrs: { x1: -4, y1: 22, x2: 4, y2: 22, stroke, strokeWidth: 1.5 },
    },
  ];
}

/**
 * IEEE Std 315 Voltage Source Glyph (Circle with +/- polarities).
 */
export function voltageSourceGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#eab308";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  return [
    {
      tagName: "line",
      selector: "leadTop",
      attrs: { x1: 0, y1: 15, x2: 0, y2: 24, stroke, strokeWidth },
    },
    {
      tagName: "circle",
      selector: "body",
      attrs: { cx: 0, cy: 37.5, r: 13.5, fill: "none", stroke, strokeWidth },
    },
    {
      tagName: "path",
      selector: "plus",
      attrs: { d: "M -4,32 L 4,32 M 0,28 L 0,36", stroke, strokeWidth: 1.5 },
    },
    {
      tagName: "line",
      selector: "minus",
      attrs: { x1: -4, y1: 43, x2: 4, y2: 43, stroke, strokeWidth: 1.5 },
    },
    {
      tagName: "line",
      selector: "leadBottom",
      attrs: { x1: 0, y1: 51, x2: 0, y2: 60, stroke, strokeWidth },
    },
  ];
}

/**
 * IEEE Std 315 Current Source Glyph (Circle with directional arrow).
 */
export function currentSourceGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#facc15";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  return [
    {
      tagName: "line",
      selector: "leadTop",
      attrs: { x1: 0, y1: 15, x2: 0, y2: 24, stroke, strokeWidth },
    },
    {
      tagName: "circle",
      selector: "body",
      attrs: { cx: 0, cy: 37.5, r: 13.5, fill: "none", stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "arrowShaft",
      attrs: { x1: 0, y1: 45, x2: 0, y2: 30, stroke, strokeWidth },
    },
    {
      tagName: "polygon",
      selector: "arrowHead",
      attrs: { points: "0,27 -3.5,33 3.5,33", fill: stroke, stroke, strokeWidth: 1 },
    },
    {
      tagName: "line",
      selector: "leadBottom",
      attrs: { x1: 0, y1: 51, x2: 0, y2: 60, stroke, strokeWidth },
    },
  ];
}

/**
 * IEEE Std 315 BJT NPN Transistor Glyph.
 */
export function bjtGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#fb923c";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  return [
    {
      tagName: "line",
      selector: "baseLead",
      attrs: { x1: -16, y1: 37.5, x2: -6, y2: 37.5, stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "baseBar",
      attrs: { x1: -6, y1: 25, x2: -6, y2: 50, stroke, strokeWidth: 2.2 },
    },
    {
      tagName: "line",
      selector: "collector",
      attrs: { x1: -6, y1: 31, x2: 10, y2: 20, stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "collectorLead",
      attrs: { x1: 10, y1: 20, x2: 10, y2: 15, stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "emitter",
      attrs: { x1: -6, y1: 44, x2: 10, y2: 55, stroke, strokeWidth },
    },
    {
      tagName: "polygon",
      selector: "emitterArrow",
      attrs: { points: "10,55 3,50 6,45", fill: stroke, stroke, strokeWidth: 1 },
    },
    {
      tagName: "line",
      selector: "emitterLead",
      attrs: { x1: 10, y1: 55, x2: 10, y2: 60, stroke, strokeWidth },
    },
  ];
}

/**
 * IEEE Std 315 N-Channel MOSFET Glyph.
 */
export function mosfetGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#a855f7";
  const strokeWidth = options?.strokeWidth ?? 1.8;
  return [
    {
      tagName: "line",
      selector: "gateLead",
      attrs: { x1: -16, y1: 37.5, x2: -8, y2: 37.5, stroke, strokeWidth },
    },
    {
      tagName: "line",
      selector: "gateBar",
      attrs: { x1: -8, y1: 24, x2: -8, y2: 51, stroke, strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "drainChannel",
      attrs: { x1: -4, y1: 24, x2: -4, y2: 30, stroke, strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "bulkChannel",
      attrs: { x1: -4, y1: 34.5, x2: -4, y2: 40.5, stroke, strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "sourceChannel",
      attrs: { x1: -4, y1: 45, x2: -4, y2: 51, stroke, strokeWidth: 2 },
    },
    {
      tagName: "path",
      selector: "drainLead",
      attrs: { d: "M -4,27 L 10,27 L 10,15", fill: "none", stroke, strokeWidth },
    },
    {
      tagName: "path",
      selector: "sourceLead",
      attrs: { d: "M -4,48 L 10,48 L 10,60", fill: "none", stroke, strokeWidth },
    },
  ];
}

/**
 * Serializes X6 markup element(s) into standard SVG elements.
 */
export function markupToSvg(markup: X6Markup | X6Markup[]): string {
  const list = Array.isArray(markup) ? markup : [markup];
  let out = "";
  for (const item of list) {
    const tag = item.tagName;
    let attrs = "";
    if (item.attrs) {
      for (const [k, v] of Object.entries(item.attrs)) {
        if (v !== undefined) {
          const attrName = k.replace(/([A-Z])/g, "-$1").toLowerCase();
          attrs += ` ${attrName}="${String(v)}"`;
        }
      }
    }
    if (item.children && item.children.length > 0) {
      out += `<${tag}${attrs}>${markupToSvg(item.children)}</${tag}>`;
    } else if (item.textContent) {
      out += `<${tag}${attrs}>${item.textContent}</${tag}>`;
    } else {
      out += `<${tag}${attrs} />`;
    }
  }
  return out;
}
