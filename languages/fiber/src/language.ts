// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript Optical Fiber Outside Plant (OSP) & GIS Language Definition.
 */

import { language } from "@modelscript/dsl";
import { DAEBuilder } from "@modelscript/runtime";
import { findNetworkSrlgSpofs, type SrlgNetwork, type SrlgPath } from "./analysis/srlg-analyzer.js";
import { lowerFiberNetworkToDae } from "./dae/lowering.js";
import { canIndexFiber, indexFiberDocument } from "./indexing.js";
import { parseFiberGis } from "./parser/fiber-gis-parser.js";

export const fiberLanguage = language({
  name: "fiber",
  fileExtensions: [".fiber.geojson", ".osp.json"],
  maturity: "stable",
  indexing: {
    indexFile: indexFiberDocument,
    canIndex: canIndexFiber,
  },
  lsp: {
    fileExtensions: [".fiber.geojson", ".osp.json", ".geojson", ".json"],
  },

  actions: [
    {
      id: "fiber_analyze_srlg",
      title: "Analyze Shared Risk Link Groups (SRLG)",
      description: "Detects physical single points of failure (SPOFs) across shared conduits, ducts, and pole lines.",
      category: "verify",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const net = parseFiberGis(text);
        const srlgNet: SrlgNetwork = {
          nodes: Array.from(net.nodes.values()).map((n) => ({ id: n.id, name: n.name })),
          segments: Array.from(net.cables.values()).map((c) => ({
            segmentId: c.id,
            fromNodeId: c.fromNodeId,
            toNodeId: c.toNodeId,
            cableId: c.id,
            lengthMeters: c.sheathLengthMeters,
            srlgIds: c.conduitId ? [c.conduitId] : [c.id],
          })),
        };
        const paths: SrlgPath[] = srlgNet.segments.map((seg) => ({
          pathId: seg.cableId,
          segmentIds: [seg.segmentId],
          totalLengthMeters: seg.lengthMeters,
          srlgIds: new Set(seg.srlgIds),
        }));
        return findNetworkSrlgSpofs(paths, srlgNet);
      },
    },
    {
      id: "fiber_to_dae",
      title: "Lower Fiber Plant to DAE",
      description:
        "Lowers optical fiber attenuation budgets and NESC Rule 250 catenary sag/tension equations into DAEBuilder.",
      category: "transform",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { error: "No document text provided" };
        const net = parseFiberGis(text);
        const builder = new DAEBuilder(undefined, net.name || "FiberOSP");
        const spans = Array.from(net.cables.values()).map((c) => ({
          id: c.id,
          spanLengthMeters: c.sheathLengthMeters,
          numSplices: net.splices.filter((s) => s.inCableId === c.id || s.outCableId === c.id).length,
        }));
        const summary = lowerFiberNetworkToDae(builder, spans);
        return {
          modelName: net.name || "FiberOSP",
          spanCount: spans.length,
          variableCount: summary.totalVariables,
          equationCount: summary.totalEquations,
        };
      },
    },
  ],
});

export default fiberLanguage;
