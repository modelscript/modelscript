// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for GeoJSON Outside Plant (OSP) fiber cadastre and network datasets.
 */

import type {
  FiberCableSpan,
  FiberNodeType,
  FiberOutsidePlantNetwork,
  FiberSplice,
  FiberStructureNode,
  StrandTraceHop,
} from "../types.js";

export function createEmptyFiberNetwork(name = "OutsidePlantNetwork"): FiberOutsidePlantNetwork {
  const nodes = new Map<string, FiberStructureNode>();
  const cables = new Map<string, FiberCableSpan>();
  const splices: FiberSplice[] = [];

  return {
    name,
    nodes,
    cables,
    splices,

    addNode(node: FiberStructureNode): void {
      nodes.set(node.id, node);
    },
    addCable(cable: FiberCableSpan): void {
      cables.set(cable.id, cable);
    },
    addSplice(splice: FiberSplice): void {
      splices.push(splice);
    },
    getNode(id: string): FiberStructureNode | undefined {
      return nodes.get(id);
    },
    getCable(id: string): FiberCableSpan | undefined {
      return cables.get(id);
    },

    traceStrand(startCableId: string, startStrand: number): StrandTraceHop[] {
      const hops: StrandTraceHop[] = [];
      const visited = new Set<string>();
      const visitedSplices = new Set<string>();

      let currentCableId = startCableId;
      let currentStrand = startStrand;

      while (currentCableId) {
        const key = `${currentCableId}:${currentStrand}`;
        if (visited.has(key)) break; // Prevent cycle
        visited.add(key);

        const cable = cables.get(currentCableId);
        if (!cable) break;

        const effectiveOpticalLength = (cable.sheathLengthMeters + cable.slackLengthMeters) * cable.helixFactor;
        const opticalLoss = (effectiveOpticalLength / 1000) * 0.2; // 0.20 dB/km default attenuation

        hops.push({
          cableId: currentCableId,
          strandNumber: currentStrand,
          lengthMeters: effectiveOpticalLength,
          lossDb: opticalLoss,
        });

        // Find outgoing splice matching (currentCable, currentStrand)
        const forwardSplice = splices.find(
          (s) => !visitedSplices.has(s.id) && s.inCableId === currentCableId && s.inStrandNumber === currentStrand,
        );

        if (forwardSplice) {
          visitedSplices.add(forwardSplice.id);
          currentCableId = forwardSplice.outCableId;
          currentStrand = forwardSplice.outStrandNumber;
          hops.push({
            cableId: `Splice_${forwardSplice.closureId}`,
            strandNumber: currentStrand,
            lengthMeters: 0,
            lossDb: forwardSplice.estimatedLossDb,
          });
        } else {
          // Check bidirectional reverse splice
          const reverseSplice = splices.find(
            (s) => !visitedSplices.has(s.id) && s.outCableId === currentCableId && s.outStrandNumber === currentStrand,
          );
          if (reverseSplice) {
            visitedSplices.add(reverseSplice.id);
            currentCableId = reverseSplice.inCableId;
            currentStrand = reverseSplice.inStrandNumber;
            hops.push({
              cableId: `Splice_${reverseSplice.closureId}`,
              strandNumber: currentStrand,
              lengthMeters: 0,
              lossDb: reverseSplice.estimatedLossDb,
            });
          } else {
            break; // No further splice found
          }
        }
      }

      return hops;
    },
  };
}

export function parseFiberGis(geojsonContent: string | Record<string, unknown>): FiberOutsidePlantNetwork {
  const data = typeof geojsonContent === "string" ? JSON.parse(geojsonContent) : geojsonContent;
  const net = createEmptyFiberNetwork(String(data["name"] || "FiberOutsidePlant"));

  const features = (data["features"] || []) as Array<Record<string, unknown>>;

  for (const f of features) {
    const props = (f["properties"] || {}) as Record<string, unknown>;
    const geom = (f["geometry"] || {}) as Record<string, unknown>;
    const geomType = String(geom["type"] || "");

    if (geomType === "Point") {
      const coords = geom["coordinates"] as [number, number];
      const id = String(props["id"] || props["name"] || `node-${net.nodes.size + 1}`);
      const rawType = String(props["node-type"] || props["type"] || "manhole").toLowerCase();

      let nodeType: FiberNodeType = "manhole";
      if (rawType.includes("co") || rawType.includes("office") || rawType.includes("central"))
        nodeType = "central-office";
      else if (rawType.includes("pole")) nodeType = "pole";
      else if (
        rawType.includes("closure") ||
        rawType.includes("splice") ||
        rawType.includes("fosc") ||
        rawType.includes("fst")
      )
        nodeType = "splice-closure";
      else if (rawType.includes("hand")) nodeType = "handhole";
      else if (rawType.includes("pedestal")) nodeType = "pedestal";
      else if (rawType.includes("premise") || rawType.includes("ont") || rawType.includes("cust"))
        nodeType = "customer-premise";

      net.addNode({
        id,
        name: String(props["name"] || id),
        nodeType,
        coordinates: coords,
        elevationMeters: props["elevation"] !== undefined ? Number(props["elevation"]) : undefined,
      });
    } else if (geomType === "LineString") {
      const coords = (geom["coordinates"] || []) as Array<[number, number]>;
      const id = String(props["id"] || props["name"] || `cable-${net.cables.size + 1}`);
      const fromNodeId = String(props["from"] || props["source"] || "");
      const toNodeId = String(props["to"] || props["target"] || "");

      net.addCable({
        id,
        name: String(props["name"] || id),
        fromNodeId,
        toNodeId,
        strandCount: Number(props["strand-count"] || props["strands"] || 72),
        fibersPerTube: Number(props["fibers-per-tube"] || 12),
        fiberType: String(props["fiber-type"] || "G.652.D"),
        sheathLengthMeters: Number(props["sheath-length-m"] || props["length"] || 1000),
        slackLengthMeters: Number(props["slack-length-m"] || props["slack"] || 30),
        helixFactor: Number(props["helix-factor"] || 1.03),
        pathCoordinates: coords,
        conduitId: props["conduit-id"] ? String(props["conduit-id"]) : undefined,
      });
    }
  }

  // Parse splices if explicitly declared
  const rawSplices = (data["splices"] || []) as Array<Record<string, unknown>>;
  for (let i = 0; i < rawSplices.length; i++) {
    const s = rawSplices[i]!;
    net.addSplice({
      id: String(s["id"] || `splice-${i + 1}`),
      closureId: String(s["closure-id"] || s["closure"] || ""),
      trayNumber: Number(s["tray-number"] || s["tray"] || 1),
      inCableId: String(s["in-cable"] || s["in"] || ""),
      inStrandNumber: Number(s["in-strand"] || 1),
      outCableId: String(s["out-cable"] || s["out"] || ""),
      outStrandNumber: Number(s["out-strand"] || 1),
      spliceType: (s["type"] || "fusion") as "fusion",
      estimatedLossDb: Number(s["loss-db"] || s["loss"] || 0.05),
    });
  }

  return net;
}
