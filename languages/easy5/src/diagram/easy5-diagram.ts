// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildEasy5Diagram,
  renderEasy5SchematicSvg as renderSvg,
  type Easy5DiagramEdge,
  type Easy5DiagramGraph,
  type Easy5DiagramNode,
  type Easy5RenderOptions,
} from "@modelscript/diagram/easy5-diagram-builder";
import type { Easy5Model } from "../types.js";

export type AntvNode = Easy5DiagramNode;
export type AntvEdge = Easy5DiagramEdge;

export interface AntvGraphData {
  nodes: AntvNode[];
  edges: AntvEdge[];
  cells?: (AntvNode | AntvEdge)[] | undefined;
  title?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Builds AntV X6 diagram JSON representation for an EASY5 model.
 */
export function buildEasy5DiagramData(model: Easy5Model): AntvGraphData {
  const diagram: Easy5DiagramGraph = buildEasy5Diagram(model);
  return {
    nodes: diagram.nodes,
    edges: diagram.edges,
    cells: diagram.cells,
    title: diagram.title,
    metadata: diagram.metadata,
  };
}

/**
 * Renders an EASY5 model into an SVG schematic drawing.
 */
export function renderEasy5SchematicSvg(model: Easy5Model, options?: Easy5RenderOptions): string {
  return renderSvg(model, options);
}
