// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Piping and Instrumentation Diagram (P&ID) Vector Schematic Generator for NASA ROCETS.
 *
 * Generates:
 * 1. AntV X6 graph model with propulsion component shapes and port connection routes
 * 2. Standalone SVG P&ID flow schematic with fluid-specific color coding (LOX, LH2, RP-1, Hot Gas)
 */

import {
  buildRocetsDiagram,
  renderRocetsPidSvg as renderSvg,
  type RocetsDiagramEdge,
  type RocetsDiagramGraph,
  type RocetsDiagramNode,
  type RocetsRenderOptions,
} from "@modelscript/diagram/rocets-diagram-builder";
import type { RocetsEngineModel } from "../types.js";

export type AntvNode = RocetsDiagramNode;
export type AntvEdge = RocetsDiagramEdge;

export interface AntvGraphData {
  nodes: AntvNode[];
  edges: AntvEdge[];
  cells?: (AntvNode | AntvEdge)[] | undefined;
  title?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export function buildRocetsDiagramData(model: RocetsEngineModel): AntvGraphData {
  const diagram: RocetsDiagramGraph = buildRocetsDiagram(model);
  return {
    nodes: diagram.nodes,
    edges: diagram.edges,
    cells: diagram.cells,
    title: diagram.title,
    metadata: diagram.metadata,
  };
}

export function renderRocetsPidSvg(model: RocetsEngineModel, options?: RocetsRenderOptions): string {
  return renderSvg(model, options);
}
