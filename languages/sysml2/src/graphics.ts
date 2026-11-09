// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — X6-Compatible Diagram Graphics Configurations.
 *
 * Provides visual node, usage, group, and connector edge stylers for the 9 SysML v2 diagram views:
 * General View, Interconnection View, Action/Activity View, State Transition View,
 * Sequence View, Tree View, Allocation View, Requirement View, and Table/Matrix View.
 */

import type { GraphicsConfig } from "@modelscript/diagram";
import type { X6Markup } from "@modelscript/diagram/builder";

/** Standard SysML block-style node markup: header + separator + label */
export const blockMarkup: X6Markup[] = [
  { tagName: "rect", selector: "body" },
  { tagName: "text", selector: "header" },
  { tagName: "line", selector: "separator" },
  { tagName: "text", selector: "label" },
];

/** Standard SysML block-style node markup with icon */
export const blockMarkupWithIcon: X6Markup[] = [...blockMarkup, { tagName: "image", selector: "icon" }];

/** Minimal node markup for simpler nodes */
export const simpleMarkup: X6Markup[] = [
  { tagName: "rect", selector: "body" },
  { tagName: "text", selector: "label" },
];

/** Minimal node markup with icon */
export const simpleMarkupWithIcon: X6Markup[] = [...simpleMarkup, { tagName: "image", selector: "icon" }];

/** Create a SysML block-style node GraphicsConfig */
export const sysmlNodeGraphics = (opts: {
  stereotype: string;
  fill: string;
  stroke: string;
  iconHref?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  portQuery?: string | undefined;
}): GraphicsConfig => ({
  role: "node",
  node: {
    shape: "rect",
    markup: opts.iconHref ? blockMarkupWithIcon : blockMarkup,
    attrs: {
      body: { fill: opts.fill, stroke: opts.stroke, strokeWidth: 1.5, rx: 6, ry: 6 },
      header: {
        text: `«${opts.stereotype.toLowerCase()}»`,
        fill: opts.stroke,
        fontSize: 10,
        fontStyle: "italic",
        textAnchor: "middle",
        refX: 0.5,
        refY: 14,
      },
      separator: { x1: 0, y1: 24, x2: "100%", y2: 24, stroke: opts.stroke, strokeWidth: 1 },
      label: {
        text: "{{name}}",
        fill: "#0f172a",
        fontSize: 13,
        fontWeight: "bold",
        textAnchor: "middle",
        refX: 0.5,
        refY: 40,
      },
      ...(opts.iconHref
        ? {
            icon: { href: opts.iconHref, width: 16, height: 16, x: 6, y: 4 },
          }
        : {}),
    },
    size: { width: opts.width ?? 180, height: opts.height ?? 60 },
    ports: {
      groups: {
        in: {
          position: "left",
          attrs: {
            portBody: { width: 10, height: 10, x: -5, y: -5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
            rect: { width: 10, height: 10, x: -5, y: -5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
            circle: { r: 5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
          },
          label: { position: { name: "left", args: { y: -10 } } },
        },
        out: {
          position: "right",
          attrs: {
            portBody: { width: 10, height: 10, x: -5, y: -5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
            rect: { width: 10, height: 10, x: -5, y: -5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
            circle: { r: 5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
          },
          label: { position: { name: "right", args: { y: -10 } } },
        },
      },
    },
    portQuery: opts.portQuery,
  },
});

/** Create a SysML usage-style node (lighter fill, dashed border) */
export const sysmlUsageGraphics = (opts: {
  stereotype: string;
  fill: string;
  stroke: string;
  iconHref?: string | undefined;
}): GraphicsConfig => ({
  role: "node",
  node: {
    shape: "rect",
    markup: opts.iconHref ? simpleMarkupWithIcon : simpleMarkup,
    attrs: {
      body: { fill: opts.fill, stroke: opts.stroke, strokeWidth: 1.5, rx: 6, ry: 6, strokeDasharray: "6 3" },
      label: {
        text: "{{name}}",
        fill: "#0f172a",
        fontSize: 13,
        fontWeight: "bold",
        textAnchor: "middle",
        refX: 0.5,
        refY: 0.5,
      },
      ...(opts.iconHref
        ? {
            icon: { href: opts.iconHref, width: 16, height: 16, x: 6, y: 4 },
          }
        : {}),
    },
    size: { width: 140, height: 40 },
  },
});

/** Create a SysML package/group GraphicsConfig */
export const sysmlGroupGraphics = (opts: { fill: string; stroke: string; tabText: string }): GraphicsConfig => ({
  role: "group",
  node: {
    shape: "rect",
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "tab" },
      { tagName: "text", selector: "tabStereotype" },
      { tagName: "text", selector: "tabLabel" },
    ],
    attrs: {
      body: {
        fill: opts.fill,
        stroke: opts.stroke,
        strokeWidth: 1.5,
        rx: 6,
        ry: 6,
        refWidth: "100%",
        refHeight: "100%",
      },
      tab: {
        fill: "#f1f5f9",
        stroke: opts.stroke,
        strokeWidth: 1.5,
        rx: 4,
        ry: 4,
        x: 0,
        y: 0,
        width: 140,
        height: 32,
      },
      tabStereotype: {
        text: `«${opts.tabText}»`,
        fill: opts.stroke,
        fontSize: 9,
        fontStyle: "italic",
        refX: 10,
        refY: 6,
        textAnchor: "start",
        textVerticalAnchor: "top",
      },
      tabLabel: {
        text: "{{name}}",
        fill: "#0f172a",
        fontSize: 11,
        fontWeight: "bold",
        refX: 10,
        refY: 18,
        textAnchor: "start",
        textVerticalAnchor: "top",
      },
    },
    size: { width: 300, height: 200 },
  },
});

/** Create a SysML edge GraphicsConfig */
export const sysmlEdgeGraphics = (opts: {
  label?: string | undefined;
  stroke?: string | undefined;
  strokeDasharray?: string | undefined;
  targetMarker?: string | number | Record<string, unknown> | undefined;
  router?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
  connector?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
}): GraphicsConfig => ({
  role: "edge",
  edge: {
    shape: "edge",
    attrs: {
      line: {
        stroke: opts.stroke ?? "#64748b",
        strokeWidth: 1.5,
        ...(opts.strokeDasharray ? { strokeDasharray: opts.strokeDasharray } : {}),
        targetMarker: opts.targetMarker ?? "classic",
      },
    },
    labels: opts.label
      ? [
          {
            attrs: {
              text: { text: opts.label, fill: "#334155", fontSize: 10, fontWeight: "500" },
              rect: {
                fill: "#ffffff",
                stroke: "#cbd5e1",
                strokeWidth: 1,
                rx: 4,
                ry: 4,
                refWidth: 12,
                refHeight: 6,
                refX: -6,
                refY: -3,
              },
            },
            position: { distance: 0.5, offset: -8 },
          },
        ]
      : undefined,
    router: opts.router ?? "port-orthogonal-astar",
    connector: opts.connector ?? "rounded",
  },
});
