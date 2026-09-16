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
