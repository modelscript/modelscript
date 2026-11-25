// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PreprocessContext, PreprocessResult } from "./types.js";

/**
 * Handles fluid, process, subsurface, civil water, nuclear, and systems-biology artifacts:
 * `olga`, `lps`, `epanet`, `aspen`, `swmm`, `relap5`, `eclipse`, `sbml`.
 */
export async function tryPreprocessFluidOrProcess(ctx: PreprocessContext): Promise<PreprocessResult | null> {
  const { viewType, content, baseTitle, inlineCode } = ctx;

  switch (viewType) {
    case "olga": {
      const { parseOlga } = await import("@modelscript/olga");
      const { renderOlgaSchematicSvg } = await import("@modelscript/diagram/olga-diagram-builder");

      const model = parseOlga(content);
      const svg = renderOlgaSchematicSvg(model);
      const allPipes = (model.flowpaths || []).flatMap((fp) => fp.pipes || []);
      const totalLength = allPipes.reduce((acc, p) => acc + (p.length || 0), 0);
      let minElev = Infinity;
      let maxElev = -Infinity;
      for (const p of allPipes) {
        if (typeof p.elevation === "number") {
          minElev = Math.min(minElev, p.elevation);
          maxElev = Math.max(maxElev, p.elevation);
        }
      }
      const elevDelta = Number.isFinite(maxElev - minElev) ? Math.max(0, Math.round(maxElev - minElev)) : 0;

      return {
        svg,
        metadata: {
          networkTitle: model.title || baseTitle,
          flowpathCount: model.flowpaths?.length || 0,
          pipeCount: allPipes.length,
          totalLengthKm: totalLength > 0 ? +(totalLength / 1000).toFixed(1) : 0,
        },
        viewConfigAdditions: {
          code: inlineCode,
          networkTitle: model.title || baseTitle,
          flowpathCount: model.flowpaths?.length || 0,
          pipeCount: allPipes.length,
          totalLengthKm: totalLength > 0 ? +(totalLength / 1000).toFixed(1) : 0,
          elevationDeltaMeters: elevDelta,
          title: model.title || baseTitle,
        },
      };
    }

    case "lps": {
      const { parseLps } = await import("@modelscript/lps");
      const { renderLpsSchematicSvg } = await import("@modelscript/diagram/lps-diagram-builder");

      const model = parseLps(content);
      const svg = renderLpsSchematicSvg(model);

      let minP = Infinity;
      let maxP = -Infinity;
      for (const node of model.nodes) {
        if (typeof node.pressure === "number") {
          minP = Math.min(minP, node.pressure);
          maxP = Math.max(maxP, node.pressure);
        }
      }
      const minPBar = Number.isFinite(minP) ? +(minP > 1000 ? minP / 1e5 : minP).toFixed(1) : undefined;
      const maxPBar = Number.isFinite(maxP) ? +(maxP > 1000 ? maxP / 1e5 : maxP).toFixed(1) : undefined;

      return {
        svg,
        metadata: {
          networkName: model.title || baseTitle,
          pipeCount: model.pipes.length,
          nodeCount: model.nodes.length,
          compressorCount: model.compressors.length,
        },
        viewConfigAdditions: {
          code: inlineCode,
          networkName: model.title || baseTitle,
          totalPipes: model.pipes.length,
          totalNodes: model.nodes.length,
          totalCompressors: model.compressors.length,
          ...(minPBar !== undefined ? { minPressureBar: minPBar } : {}),
          ...(maxPBar !== undefined ? { maxPressureBar: maxPBar } : {}),
          title: model.title || baseTitle,
        },
      };
    }

    case "epanet": {
      const { parseEpanet } = await import("@modelscript/epanet");
      const { renderPolyglotDiagramToSvg } = await import("@modelscript/diagram/svg");
      const net = parseEpanet(content);
      const rawNodes: { id: string; type: string }[] = [
        ...net.reservoirs.map((r) => ({ id: r.id, type: `Reservoir (${r.totalHead} m)` })),
        ...net.tanks.map((t) => ({ id: t.id, type: `Tank (D=${t.diameter} m)` })),
        ...net.junctions.map((j) => ({ id: j.id, type: `Junction (z=${j.elevation} m)` })),
      ];
      const cols = 4;
      const nodes = rawNodes.map((n, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = 60 + col * 210;
        const y = 60 + row * 120;
        return {
          id: n.id,
          type: n.type,
          kind: "component",
          x,
          y,
          width: 155,
          height: 68,
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
          ports: [
            { id: `${n.id}.in`, name: "in", x: x, y: y + 34, direction: "in", domain: "fluid" },
            { id: `${n.id}.out`, name: "out", x: x + 155, y: y + 34, direction: "out", domain: "fluid" },
          ],
          iconSvg: null,
          iconShapes: [],
          iconCoordSystem: null,
        };
      });
      const nodeSet = new Set(nodes.map((n) => n.id));
      const allLinks = [
        ...net.pipes.map((p) => ({ id: p.id, node1: p.node1, node2: p.node2 })),
        ...net.pumps.map((p) => ({ id: p.id, node1: p.node1, node2: p.node2 })),
        ...net.valves.map((v) => ({ id: v.id, node1: v.node1, node2: v.node2 })),
      ];
      const edges = allLinks
        .filter((l) => nodeSet.has(l.node1) && nodeSet.has(l.node2))
        .map((l, idx) => {
          const srcNode = nodes.find((n) => n.id === l.node1)!;
          const dstNode = nodes.find((n) => n.id === l.node2)!;
          return {
            id: `link_${idx}_${l.id}`,
            sourcePort: `${l.node1}.out`,
            targetPort: `${l.node2}.in`,
            points: [
              { x: srcNode.x + 155, y: srcNode.y + 34 },
              { x: dstNode.x, y: dstNode.y + 34 },
            ],
            color: [56, 189, 248] as [number, number, number],
            thickness: 1.8,
            pattern: "Solid",
          };
        });
      const svg =
        nodes.length > 0
          ? renderPolyglotDiagramToSvg(
              {
                nodes,
                edges,
                coordinateSystem: null,
                diagramBackground: null,
              } as unknown as Parameters<typeof renderPolyglotDiagramToSvg>[0],
              { theme: "dark" },
            )
          : undefined;
      return {
        ...(svg ? { svg } : {}),
        metadata: {
          nodeCount: nodes.length,
          connectionCount: edges.length,
          junctionCount: net.junctions.length,
          pipeCount: net.pipes.length,
          dialect: "epanet",
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: net.title || baseTitle,
          dialect: "epanet",
          nodeCount: nodes.length,
          connectionCount: edges.length,
          junctionCount: net.junctions.length,
          reservoirCount: net.reservoirs.length,
          tankCount: net.tanks.length,
          pipeCount: net.pipes.length,
          pumpCount: net.pumps.length,
          valveCount: net.valves.length,
        },
      };
    }

    case "aspen": {
      const { parseAspen } = await import("@modelscript/aspen");
      const { renderAspenSvg } = await import("@modelscript/diagram/aspen-diagram-builder");
      const doc = parseAspen(content);
      return {
        svg: renderAspenSvg(doc),
        metadata: { blockCount: doc.blocks.size, streamCount: doc.streams.size },
        viewConfigAdditions: {
          code: inlineCode,
          title: doc.title || baseTitle,
          blockCount: doc.blocks.size,
          streamCount: doc.streams.size,
        },
      };
    }

    case "swmm": {
      const { parseSwmm } = await import("@modelscript/swmm");
      const { renderSwmmSvg } = await import("@modelscript/diagram/swmm-diagram-builder");
      const model = parseSwmm(content);
      return {
        svg: renderSwmmSvg(model as unknown as Parameters<typeof renderSwmmSvg>[0]),
        metadata: { junctionCount: model.junctions.size, conduitCount: model.conduits.size },
        viewConfigAdditions: {
          code: inlineCode,
          title: model.title || baseTitle,
          junctionCount: model.junctions.size,
          conduitCount: model.conduits.size,
        },
      };
    }

    case "relap5": {
      const { parseRelap5 } = await import("@modelscript/relap5");
      const { renderRelap5Svg } = await import("@modelscript/diagram/relap5-diagram-builder");
      const deck = parseRelap5(content);
      return {
        svg: renderRelap5Svg(deck as unknown as Parameters<typeof renderRelap5Svg>[0]),
        metadata: { volumeCount: deck.volumes.size, junctionCount: deck.junctions.size },
        viewConfigAdditions: {
          code: inlineCode,
          title: deck.title || baseTitle,
          volumeCount: deck.volumes.size,
          junctionCount: deck.junctions.size,
        },
      };
    }

    case "eclipse": {
      const { parseEclipse } = await import("@modelscript/eclipse");
      const { renderEclipseSvg } = await import("@modelscript/diagram/eclipse-diagram-builder");
      const deck = parseEclipse(content);
      return {
        svg: renderEclipseSvg(deck as unknown as Parameters<typeof renderEclipseSvg>[0]),
        metadata: { wellCount: deck.wells.size, nz: deck.dimensions?.nz },
        viewConfigAdditions: {
          code: inlineCode,
          title: deck.title || baseTitle,
          wellCount: deck.wells.size,
          ...(deck.dimensions?.nz !== undefined ? { nz: deck.dimensions.nz } : {}),
        },
      };
    }

    case "sbml": {
      const { parseSbml } = await import("@modelscript/sbml");
      const { renderSbmlSvg } = await import("@modelscript/diagram/sbml-diagram-builder");
      const doc = parseSbml(content);
      return {
        svg: renderSbmlSvg(doc.model),
        metadata: { speciesCount: doc.model.species.size, reactionCount: doc.model.reactions.size },
        viewConfigAdditions: {
          code: inlineCode,
          title: doc.model.name || doc.model.id || baseTitle,
          speciesCount: doc.model.species.size,
          reactionCount: doc.model.reactions.size,
        },
      };
    }

    default:
      return null;
  }
}
