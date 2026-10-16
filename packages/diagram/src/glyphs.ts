// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared Vector Glyphs & Engineering Shape Library for AntV X6 rendering.
// Provides reusable DOM-free SVG markup definitions for UML, SysML, and engineering diagrams.

import type { X6Markup } from "./polyglot-diagram-builder.js";

export interface GlyphOptions {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  width?: number;
  height?: number;
  label?: string;
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
  orientation?: "horizontal" | "vertical";
  length?: number;
  thickness?: number;
  fill?: string;
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
export function pseudostateInitialGlyph(options?: { r?: number; fill?: string }): X6Markup[] {
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
  outerR?: number;
  innerR?: number;
  stroke?: string;
  fill?: string;
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
export function pseudostateHistoryGlyph(options?: { deep?: boolean; r?: number }): X6Markup[] {
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
  direction?: "in" | "out" | "inout";
  conjugated?: boolean;
  size?: number;
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
  width?: number;
  height?: number;
  color?: string;
  label?: string;
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
export function toggleSwitchGlyph(options?: { width?: number; height?: number; label?: string }): X6Markup[] {
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
export function sliderTrackGlyph(options?: { width?: number; height?: number; label?: string }): X6Markup[] {
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
  width?: number;
  height?: number;
  label?: string;
  unit?: string;
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
 * IEEE Standard 2-Winding Transformer Glyph (Overlapping Circles).
 */
export function transformerGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#90caf9";
  const strokeWidth = options?.strokeWidth ?? 2;
  const fill = options?.fill ?? "none";

  return [
    // Primary Winding Circle
    {
      tagName: "circle",
      selector: "primaryWinding",
      attrs: {
        cx: 24,
        cy: 30,
        r: 16,
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
        cx: 44,
        cy: 30,
        r: 16,
        fill,
        stroke,
        strokeWidth,
      },
    },
    // Primary Lead
    {
      tagName: "line",
      selector: "primaryLead",
      attrs: {
        x1: 8,
        y1: 30,
        x2: 0,
        y2: 30,
        stroke,
        strokeWidth,
      },
    },
    // Secondary Lead
    {
      tagName: "line",
      selector: "secondaryLead",
      attrs: {
        x1: 60,
        y1: 30,
        x2: 68,
        y2: 30,
        stroke,
        strokeWidth,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "#e2e8f0",
        fontSize: 9,
        fontWeight: "bold",
        refX: 34,
        refY: 56,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * Synchronous Generator / AC Source Glyph (Circle with Sine Wave).
 */
export function generatorGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#ffd54f";
  const strokeWidth = options?.strokeWidth ?? 2;
  const fill = options?.fill ?? "rgba(255, 213, 79, 0.08)";

  return [
    // Outer Circle
    {
      tagName: "circle",
      selector: "genCircle",
      attrs: {
        cx: 30,
        cy: 30,
        r: 24,
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
        d: "M 18,30 Q 24,20 30,30 Q 36,40 42,30",
        fill: "none",
        stroke,
        strokeWidth: 2,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "#fef08a",
        fontSize: 9,
        fontWeight: "bold",
        refX: 30,
        refY: 64,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * Inverter-Based Resource (IBR) Glyph (Split AC/DC Box).
 */
export function inverterIbrGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#69f0ae";
  const strokeWidth = options?.strokeWidth ?? 2;
  const fill = options?.fill ?? "rgba(105, 240, 174, 0.08)";

  return [
    // Outer Box
    {
      tagName: "rect",
      selector: "ibrBox",
      attrs: {
        x: 4,
        y: 4,
        width: 52,
        height: 52,
        rx: 4,
        ry: 4,
        fill,
        stroke,
        strokeWidth,
      },
    },
    // Diagonal Divider
    {
      tagName: "line",
      selector: "ibrDivider",
      attrs: {
        x1: 4,
        y1: 56,
        x2: 56,
        y2: 4,
        stroke,
        strokeWidth: 1.5,
      },
    },
    // DC Symbol = (Top-Left)
    {
      tagName: "line",
      selector: "dcLine1",
      attrs: { x1: 14, y1: 18, x2: 26, y2: 18, stroke, strokeWidth: 1.5 },
    },
    {
      tagName: "line",
      selector: "dcLine2",
      attrs: { x1: 14, y1: 22, x2: 26, y2: 22, stroke, strokeWidth: 1.5, strokeDasharray: "2,2" },
    },
    // AC Symbol ~ (Bottom-Right)
    {
      tagName: "path",
      selector: "acSine",
      attrs: {
        d: "M 32,42 Q 38,36 42,42 Q 46,48 50,42",
        fill: "none",
        stroke,
        strokeWidth: 1.5,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "#a7f3d0",
        fontSize: 9,
        fontWeight: "bold",
        refX: 30,
        refY: 66,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * High-Voltage Busbar Glyph.
 */
export function busbarGlyph(options?: { length?: number; voltageBaseKv?: number; label?: string }): X6Markup[] {
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
 * IEEE/IEC Circuit Breaker Glyph (Switch Box with Interrupt Cross).
 */
export function breakerGlyph(options?: GlyphOptions & { isOpen?: boolean }): X6Markup[] {
  const isOpen = options?.isOpen ?? false;
  const stroke = options?.stroke ?? (isOpen ? "#fbbf24" : "#f87171");
  const fill = options?.fill ?? (isOpen ? "rgba(251, 191, 36, 0.1)" : "rgba(248, 113, 113, 0.14)");

  return [
    {
      tagName: "rect",
      selector: "brkBox",
      attrs: { x: 6, y: 10, width: 36, height: 24, rx: 3, ry: 3, fill, stroke, strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "brkLeadL",
      attrs: { x1: 0, y1: 22, x2: 6, y2: 22, stroke: "#81d4fa", strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "brkLeadR",
      attrs: { x1: 42, y1: 22, x2: 48, y2: 22, stroke: "#81d4fa", strokeWidth: 2 },
    },
    {
      tagName: "line",
      selector: "brkCross1",
      attrs: { x1: 16, y1: 15, x2: 32, y2: 29, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "brkCross2",
      attrs: { x1: 16, y1: 29, x2: 32, y2: 15, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: stroke,
        fontSize: 8.5,
        fontWeight: "bold",
        refX: 24,
        refY: 44,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * IEEE/IEC ZnO Metal-Oxide Varistor (MOV) Surge Arrester Glyph.
 */
export function surgeArresterGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#c084fc";
  const fill = options?.fill ?? "rgba(192, 132, 252, 0.12)";

  return [
    {
      tagName: "line",
      selector: "arrLeadTop",
      attrs: { x1: 20, y1: 0, x2: 20, y2: 10, stroke: "#81d4fa", strokeWidth: 2 },
    },
    {
      tagName: "rect",
      selector: "arrBody",
      attrs: { x: 11, y: 10, width: 18, height: 26, rx: 2, ry: 2, fill, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "polyline",
      selector: "arrNonlinearBar",
      attrs: { points: "7,28 14,28 26,16 33,16", fill: "none", stroke, strokeWidth: 1.6 },
    },
    {
      tagName: "line",
      selector: "arrLeadGnd",
      attrs: { x1: 20, y1: 36, x2: 20, y2: 44, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "gnd1",
      attrs: { x1: 10, y1: 44, x2: 30, y2: 44, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "gnd2",
      attrs: { x1: 14, y1: 48, x2: 26, y2: 48, stroke, strokeWidth: 1.5 },
    },
    {
      tagName: "line",
      selector: "gnd3",
      attrs: { x1: 17, y1: 52, x2: 23, y2: 52, stroke, strokeWidth: 1.2 },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "#d8b4fe",
        fontSize: 8.5,
        fontWeight: "bold",
        refX: 20,
        refY: 62,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * Short-Circuit Fault Strike (Lightning Bolt) Glyph.
 */
export function faultGlyph(options?: GlyphOptions): X6Markup[] {
  const stroke = options?.stroke ?? "#ef4444";
  const fill = options?.fill ?? "rgba(239, 68, 68, 0.2)";

  return [
    {
      tagName: "polygon",
      selector: "faultBolt",
      attrs: {
        points: "22,2 10,22 20,22 14,42 32,18 21,18",
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
        fill: "#fca5a5",
        fontSize: 8.5,
        fontWeight: "bold",
        refX: 20,
        refY: 52,
        textAnchor: "middle",
      },
    },
  ];
}

/**
 * HVDC / Power-Electronics Converter Bridge (VSC / LCC / MMC) Glyph.
 */
export function converterBridgeGlyph(options?: GlyphOptions & { badge?: string }): X6Markup[] {
  const stroke = options?.stroke ?? "#2dd4bf";
  const fill = options?.fill ?? "rgba(45, 212, 191, 0.1)";
  const badge = options?.badge ?? "MMC";

  return [
    {
      tagName: "rect",
      selector: "convBox",
      attrs: { x: 4, y: 4, width: 64, height: 52, rx: 5, ry: 5, fill, stroke, strokeWidth: 2 },
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
        fill: "#f8fafc",
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
        fill: "#99f6e4",
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
 * Transmission Line / Underground Cable Segment Glyph.
 */
export function transmissionLineGlyph(options?: GlyphOptions & { isCable?: boolean }): X6Markup[] {
  const isCable = options?.isCable ?? false;
  const stroke = options?.stroke ?? (isCable ? "#f472b6" : "#38bdf8");
  const fill = options?.fill ?? "rgba(56, 189, 248, 0.08)";

  return [
    {
      tagName: "rect",
      selector: "tlineBox",
      attrs: { x: 4, y: 12, width: 72, height: 24, rx: 12, ry: 12, fill, stroke, strokeWidth: 1.8 },
    },
    {
      tagName: "line",
      selector: "tlineCore",
      attrs: {
        x1: 0,
        y1: 24,
        x2: 80,
        y2: 24,
        stroke,
        strokeWidth: 2,
        strokeDasharray: isCable ? "4,2" : undefined,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        text: options?.label ?? "",
        fill: "#bae6fd",
        fontSize: 8.5,
        fontWeight: "bold",
        refX: 40,
        refY: 46,
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
    kind?: "pi" | "lag" | "sum" | "gain" | "limit" | "compar" | "const";
    label?: string;
  },
): X6Markup[] {
  const kind = options?.kind ?? "pi";
  const stroke = options?.stroke ?? "#a855f7";
  const fill = options?.fill ?? "rgba(168, 85, 247, 0.12)";
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
          fill: "#f3e8ff",
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
          fill: "#cbd5e1",
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
          fill: "#f3e8ff",
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
          fill: "#d8b4fe",
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
      attrs: { d: curvePath, fill: "none", stroke: "#d8b4fe", strokeWidth: 1.5 },
    },
    {
      tagName: "text",
      selector: "csmfBadge",
      attrs: {
        text: kind === "pi" ? "PI" : kind === "lag" ? "1/(1+sT)" : kind === "const" ? "CONST" : kind.toUpperCase(),
        fill: "#f3e8ff",
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
        fill: "#d8b4fe",
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
    kind?: "pgb" | "multimeter" | "voltmeter" | "ammeter";
    label?: string;
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
    label?: string;
    isElectrical?: boolean;
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
