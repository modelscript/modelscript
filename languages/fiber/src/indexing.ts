// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseFiberGis } from "./parser/fiber-gis-parser.js";
import type { FiberOutsidePlantNetwork } from "./types.js";

export function canIndexFiber(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".fiber.geojson") || lower.endsWith(".osp.json")) return true;
  if ((lower.endsWith(".geojson") || lower.endsWith(".json")) && text) {
    return (
      text.includes('"node-type"') ||
      text.includes('"strand-count"') ||
      text.includes('"strandCount"') ||
      text.includes('"sheathLengthMeters"') ||
      text.includes('"splices"')
    );
  }
  return false;
}

/**
 * Declarative multi-file workspace indexer for optical fiber outside plant (OSP) networks.
 */
export function indexFiberDocument(ctx: DslIndexFileContext): void {
  const { text } = ctx;
  try {
    const net = parseFiberGis(text);
    ctx.setParsedModel(net);

    const rootSymId = ctx.addSymbol(
      net.name,
      "package",
      null,
      0,
      text.length,
      {
        nodeCount: net.nodes.size,
        cableCount: net.cables.size,
        spliceCount: net.splices.length,
      },
      {
        ruleName: "fiber_network",
        namePath: net.name,
      },
    );

    for (const node of net.nodes.values()) {
      ctx.addSymbol(
        node.name,
        "class",
        rootSymId,
        0,
        0,
        {
          nodeType: node.nodeType,
          coords: node.coordinates,
        },
        {
          ruleName: "osp_structure",
          namePath: node.name,
          aliases: node.id !== node.name ? [node.id] : undefined,
        },
      );
    }

    for (const cable of net.cables.values()) {
      ctx.addSymbol(
        cable.name,
        "component",
        rootSymId,
        0,
        0,
        {
          strandCount: cable.strandCount,
          lengthMeters: cable.sheathLengthMeters,
        },
        {
          ruleName: "fiber_cable",
          namePath: cable.name,
          aliases: cable.id !== cable.name ? [cable.id] : undefined,
        },
      );
    }
  } catch {
    // Ignore non-Fiber GeoJSON/JSON documents
  }
}

export function getFiberNetwork(workspace: UnifiedWorkspace, uri: string): FiberOutsidePlantNetwork | undefined {
  return workspace.getParsedModel<FiberOutsidePlantNetwork>(uri);
}
