// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for OpenROADM MSA network topology and TIP GNPy JSON files.
 */

import type {
  ModulationFormat,
  OpticalAmplifier,
  OpticalChannel,
  OpticalDegree,
  OpticalNode,
  OpticalNodeType,
  OpticalSpan,
  OpticalSrg,
  OpticalTopology,
} from "../types.js";

export function createEmptyOpticalTopology(name = "OpticalNetwork"): OpticalTopology {
  const nodes = new Map<string, OpticalNode>();
  const spans = new Map<string, OpticalSpan>();
  const channels = new Map<string, OpticalChannel>();

  return {
    name,
    nodes,
    spans,
    channels,
    addNode(node: OpticalNode): void {
      nodes.set(node.id, node);
    },
    addSpan(span: OpticalSpan): void {
      spans.set(span.id, span);
    },
    addChannel(channel: OpticalChannel): void {
      channels.set(channel.id, channel);
    },
    getNode(id: string): OpticalNode | undefined {
      return nodes.get(id);
    },
    getSpan(id: string): OpticalSpan | undefined {
      return spans.get(id);
    },
  };
}

export function parseOpenRoadmTopology(jsonContent: string | Record<string, unknown>): OpticalTopology {
  const data = typeof jsonContent === "string" ? JSON.parse(jsonContent) : jsonContent;
  const topo = createEmptyOpticalTopology(String(data["network-name"] || data["name"] || "OpenRoadmNetwork"));

  // 1. Ingest Nodes
  const rawNodes = (data["nodes"] || data["elements"] || []) as Array<Record<string, unknown>>;
  for (const n of rawNodes) {
    const id = String(n["node-id"] || n["id"] || "");
    if (!id) continue;

    const nodeTypeRaw = String(n["node-type"] || n["type"] || "rdm").toLowerCase();
    let nodeType: OpticalNodeType = "rdm";
    if (nodeTypeRaw.includes("ila") || nodeTypeRaw.includes("amp")) nodeType = "ila";
    else if (nodeTypeRaw.includes("term") || nodeTypeRaw.includes("xpdr")) nodeType = "terminal";
    else if (nodeTypeRaw.includes("fused")) nodeType = "fused";

    const degrees: OpticalDegree[] = [];
    const rawDegrees = (n["degrees"] || []) as Array<Record<string, unknown>>;
    for (const d of rawDegrees) {
      degrees.push({
        degreeNumber: Number(d["degree-number"] || 1),
        maxWavelengths: Number(d["max-wavelengths"] || 96),
        circuitPackName: d["circuit-pack-name"] ? String(d["circuit-pack-name"]) : undefined,
      });
    }

    const srgs: OpticalSrg[] = [];
    const rawSrgs = (n["srgs"] || []) as Array<Record<string, unknown>>;
    for (const s of rawSrgs) {
      srgs.push({
        srgNumber: Number(s["srg-number"] || 1),
        maxAddDropWavelengths: Number(s["max-add-drop"] || 96),
        isColorless: s["colorless"] !== false,
        isDirectionless: s["directionless"] !== false,
        isContentionless: s["contentionless"] === true,
      });
    }

    topo.addNode({
      id,
      name: String(n["name"] || id),
      nodeType,
      degrees,
      srgs,
      ports: [],
      latitude: n["latitude"] !== undefined ? Number(n["latitude"]) : undefined,
      longitude: n["longitude"] !== undefined ? Number(n["longitude"]) : undefined,
    });
  }

  // 2. Ingest Links / Spans
  const rawLinks = (data["links"] || data["spans"] || []) as Array<Record<string, unknown>>;
  for (const l of rawLinks) {
    const id = String(l["link-id"] || l["id"] || "");
    const fromNodeId = String(l["source-node"] || l["from"] || "");
    const toNodeId = String(l["dest-node"] || l["to"] || "");
    if (!id || !fromNodeId || !toNodeId) continue;

    const lengthKm = Number(l["length-km"] || l["length"] || 50.0);
    const fiberTypeRaw = String(l["fiber-type"] || "SSMF").toUpperCase();
    const fiberType = (["SSMF", "NZDSF", "PSCF", "LEAF"].includes(fiberTypeRaw) ? fiberTypeRaw : "SSMF") as
      | "SSMF"
      | "NZDSF"
      | "PSCF"
      | "LEAF";

    const attenuationDbPerKm = Number(l["loss-coef"] || l["attenuation"] || 0.2);
    const dispersion = Number(l["dispersion"] || 16.7);
    const pmd = Number(l["pmd"] || 0.04);
    const gamma = Number(l["gamma"] || 1.3);

    const amplifiers: OpticalAmplifier[] = [];
    const rawAmps = (l["amplifiers"] || []) as Array<Record<string, unknown>>;
    for (const a of rawAmps) {
      amplifiers.push({
        id: String(a["id"] || `amp-${id}`),
        ampType: (a["type"] || "edfa") as "edfa",
        gainDb: Number(a["gain-db"] || a["gain"] || lengthKm * attenuationDbPerKm),
        noiseFigureDb: Number(a["noise-figure-db"] || a["nf"] || 5.5),
        maxOutputPowerDbm: Number(a["max-power-dbm"] || 21.0),
      });
    }

    topo.addSpan({
      id,
      fromNodeId,
      toNodeId,
      lengthKm,
      fiberType,
      attenuationDbPerKm,
      dispersionPsPerNmKm: dispersion,
      pmdPsPerSqrtKm: pmd,
      nonLinearCoeffPerWKm: gamma,
      amplifiers,
      conduitId: l["conduit-id"] ? String(l["conduit-id"]) : undefined,
      srlgIds: Array.isArray(l["srlg"]) ? (l["srlg"] as string[]) : undefined,
    });
  }

  // 3. Ingest Channels / Demands
  const rawChannels = (data["channels"] || data["services"] || []) as Array<Record<string, unknown>>;
  for (const c of rawChannels) {
    const id = String(c["service-name"] || c["id"] || "");
    const sourceNodeId = String(c["source-node"] || c["from"] || "");
    const destinationNodeId = String(c["dest-node"] || c["to"] || "");
    if (!id || !sourceNodeId || !destinationNodeId) continue;

    const modRaw = String(c["modulation"] || "PM-16QAM").toUpperCase();
    const modulation = (
      ["PM-BPSK", "PM-QPSK", "PM-8QAM", "PM-16QAM", "PM-32QAM", "PM-64QAM"].includes(modRaw) ? modRaw : "PM-16QAM"
    ) as ModulationFormat;

    topo.addChannel({
      id,
      sourceNodeId,
      destinationNodeId,
      centerFrequencyThz: Number(c["frequency-thz"] || 193.1),
      baudRateGbaud: Number(c["baud-rate"] || 64),
      modulation,
      launchPowerDbm: Number(c["launch-power-dbm"] || 0.0),
      requiredOsnrDb: Number(c["required-osnr-db"] || 15.0),
      pathSpanIds: Array.isArray(c["path"]) ? (c["path"] as string[]) : [],
    });
  }

  return topo;
}
