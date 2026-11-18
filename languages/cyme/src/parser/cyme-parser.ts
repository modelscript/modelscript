// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cyme — Parser for CYME .sxst XML & Self-Contained ASCII Formats.
 */

import type { CymeLoad, CymeNetwork, CymeNode, CymeSection, CymeSource } from "../types.js";

function extractTag(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i").exec(block);
  return m ? m[1]!.trim() : undefined;
}

function extractAttr(tagHeader: string, attr: string): string | undefined {
  const m = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i").exec(tagHeader);
  return m ? m[1]!.trim() : undefined;
}

function num(val: string | undefined, fallback = 0): number {
  if (val === undefined || val === "") return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a CYME .sxst XML or ASCII network file into a CymeNetwork.
 */
export function parseCyme(source: string): CymeNetwork {
  const trimmed = source.trim();
  const nodes: CymeNode[] = [];
  const sources: CymeSource[] = [];
  const sections: CymeSection[] = [];
  const loads: CymeLoad[] = [];
  let networkId = "CYME_Feeder";
  let frequencyHz = 60;

  if (trimmed.startsWith("<")) {
    const netIdMatch = /<NetworkID>([^<]+)<\/NetworkID>/i.exec(trimmed);
    if (netIdMatch) networkId = netIdMatch[1]!.trim();

    const freqMatch = /<Frequency>([^<]+)<\/Frequency>/i.exec(trimmed);
    if (freqMatch) frequencyHz = num(freqMatch[1], 60);

    for (const m of trimmed.matchAll(/<Node\b([^>]*)>([\s\S]*?)<\/Node>/gi)) {
      const id = extractTag(m[2]!, "NodeID") ?? extractAttr(m[1]!, "ID") ?? extractAttr(m[1]!, "NodeID");
      if (!id) continue;
      const xRaw = extractTag(m[2]!, "X");
      const yRaw = extractTag(m[2]!, "Y");
      const kvRaw = extractTag(m[2]!, "NominalKV") ?? extractTag(m[2]!, "NominalVoltageKVLL");
      nodes.push({
        nodeId: id,
        x: xRaw !== undefined ? num(xRaw) : undefined,
        y: yRaw !== undefined ? num(yRaw) : undefined,
        nominalKv: kvRaw !== undefined ? num(kvRaw) : undefined,
      });
    }

    for (const m of trimmed.matchAll(/<Source\b([^>]*)>([\s\S]*?)<\/Source>/gi)) {
      const sourceId = extractTag(m[2]!, "SourceID") ?? extractAttr(m[1]!, "ID") ?? "SRC_1";
      const nodeId = extractTag(m[2]!, "NodeID") ?? extractTag(m[2]!, "SourceNodeID") ?? "";
      const nominalKv = num(extractTag(m[2]!, "NominalKV") ?? extractTag(m[2]!, "DesiredVoltageKVLL"), 12.47);
      const operatingKv = num(extractTag(m[2]!, "OperatingKV") ?? extractTag(m[2]!, "DesiredVoltageKVLL"), nominalKv);
      if (nodeId) sources.push({ sourceId, nodeId, nominalKv, operatingKv });
    }

    for (const m of trimmed.matchAll(/<Section\b([^>]*)>([\s\S]*?)<\/Section>/gi)) {
      const sectionId = extractTag(m[2]!, "SectionID") ?? extractAttr(m[1]!, "ID") ?? "";
      const fromNodeId = extractTag(m[2]!, "FromNodeID") ?? "";
      const toNodeId = extractTag(m[2]!, "ToNodeID") ?? "";
      const phase = extractTag(m[2]!, "Phase") ?? "ABC";
      const lengthMeters = num(extractTag(m[2]!, "Length") ?? extractTag(m[2]!, "LengthMeters"), 100);
      const devRaw = (extractTag(m[2]!, "DeviceType") ?? "OverheadLine").toLowerCase();
      let deviceType: CymeSection["deviceType"] = "OverheadLine";
      if (devRaw.includes("cable") || devRaw.includes("underground")) deviceType = "UndergroundCable";
      else if (devRaw.includes("transformer")) deviceType = "Transformer";
      else if (devRaw.includes("switch")) deviceType = "Switch";
      else if (devRaw.includes("fuse")) deviceType = "Fuse";

      sections.push({
        sectionId: sectionId || `SEC_${sections.length + 1}`,
        fromNodeId,
        toNodeId,
        phase,
        lengthMeters,
        deviceType,
        rOhmPerKm: extractTag(m[2]!, "R1") !== undefined ? num(extractTag(m[2]!, "R1")) : undefined,
        xOhmPerKm: extractTag(m[2]!, "X1") !== undefined ? num(extractTag(m[2]!, "X1")) : undefined,
        primaryKv: extractTag(m[2]!, "PrimaryKV") !== undefined ? num(extractTag(m[2]!, "PrimaryKV")) : undefined,
        secondaryKv: extractTag(m[2]!, "SecondaryKV") !== undefined ? num(extractTag(m[2]!, "SecondaryKV")) : undefined,
        ratingKva: extractTag(m[2]!, "RatingKVA") !== undefined ? num(extractTag(m[2]!, "RatingKVA")) : undefined,
      });
    }

    for (const m of trimmed.matchAll(/<SpotLoad\b([^>]*)>([\s\S]*?)<\/SpotLoad>/gi)) {
      const loadId = extractTag(m[2]!, "LoadID") ?? extractAttr(m[1]!, "ID") ?? `LOAD_${loads.length + 1}`;
      const nodeId = extractTag(m[2]!, "NodeID") ?? "";
      const sectionId = extractTag(m[2]!, "SectionID");
      const phase = extractTag(m[2]!, "Phase") ?? "ABC";
      const kw = num(extractTag(m[2]!, "KW") ?? extractTag(m[2]!, "ActivePowerKW"));
      const kvar = num(extractTag(m[2]!, "KVAR") ?? extractTag(m[2]!, "ReactivePowerKVAR"));
      if (nodeId) loads.push({ loadId, sectionId, nodeId, phase, kw, kvar });
    }
  } else {
    // CYME ASCII section format: [NODES], [SOURCES], [SECTIONS], [LOADS]
    let currentSection = "";
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine
        .replace(/\/\/.*$/, "")
        .replace(/;.*$/, "")
        .trim();
      if (!line) continue;
      if (line.startsWith("[") && line.endsWith("]")) {
        currentSection = line.slice(1, -1).toUpperCase();
        continue;
      }
      const cols = line.split(/[,\s]+/).filter(Boolean);
      if (currentSection === "NODES" && cols.length >= 1) {
        nodes.push({
          nodeId: cols[0]!,
          x: cols[1] !== undefined ? num(cols[1]) : undefined,
          y: cols[2] !== undefined ? num(cols[2]) : undefined,
          nominalKv: cols[3] !== undefined ? num(cols[3]) : undefined,
        });
      } else if (currentSection === "SOURCES" && cols.length >= 2) {
        sources.push({
          sourceId: cols[0]!,
          nodeId: cols[1]!,
          nominalKv: num(cols[2], 12.47),
          operatingKv: num(cols[3], num(cols[2], 12.47)),
        });
      } else if (currentSection === "SECTIONS" && cols.length >= 4) {
        sections.push({
          sectionId: cols[0]!,
          fromNodeId: cols[1]!,
          toNodeId: cols[2]!,
          phase: cols[3] ?? "ABC",
          lengthMeters: num(cols[4], 100),
          deviceType: (cols[5] as CymeSection["deviceType"]) ?? "OverheadLine",
          rOhmPerKm: cols[6] !== undefined ? num(cols[6]) : undefined,
          xOhmPerKm: cols[7] !== undefined ? num(cols[7]) : undefined,
        });
      } else if (currentSection === "LOADS" && cols.length >= 4) {
        loads.push({
          loadId: cols[0]!,
          nodeId: cols[1]!,
          phase: cols[2] ?? "ABC",
          kw: num(cols[3]),
          kvar: num(cols[4], 0),
        });
      }
    }
  }

  return {
    networkId,
    frequencyHz,
    nodes,
    nodeById: new Map(nodes.map((n) => [n.nodeId, n])),
    sources,
    sections,
    loads,
  };
}
