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
