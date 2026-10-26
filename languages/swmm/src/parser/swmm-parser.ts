// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — High-Performance Zero-Regex Parser & Serializer for US EPA SWMM 5.x (.inp) Decks.
 */

import type {
  SwmmCrossSection,
  SwmmDeck,
  SwmmFlowUnits,
  SwmmOutfall,
  SwmmRange,
  SwmmRoutingModel,
  SwmmWeir,
} from "../types.js";

interface RawToken {
  text: string;
  startCol: number;
  endCol: number;
}

export function parseSwmm(source: string): SwmmDeck {
  const deck: SwmmDeck = {
    flowUnits: "CFS",
    routingModel: "DYNWAVE",
    options: {},
    junctions: new Map(),
    outfalls: new Map(),
    storage: new Map(),
    conduits: new Map(),
    pumps: new Map(),
    orifices: new Map(),
    weirs: new Map(),
    crossSections: new Map(),
    subcatchments: new Map(),
  };

  const lines = source.split(/\r?\n/);
  let currentSection = "";
  let currentOffset = 0;
  const titleLines: string[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineNum = lineIdx + 1;
    const lineStartOffset = currentOffset;
    currentOffset += rawLine.length + 1; // including newline

    // Strip comments starting with ';'
    let cleanLine = rawLine;
    const commentIdx = rawLine.indexOf(";");
    if (commentIdx !== -1) {
      cleanLine = rawLine.slice(0, commentIdx);
    }

    const trimmed = cleanLine.trim();
    if (trimmed.length === 0) continue;

    // Check for section header [SECTION]
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = trimmed.slice(1, -1).trim().toUpperCase();
      continue;
    }

    // Tokenize line non-regex
    const tokens = tokenizeLine(cleanLine);
    if (tokens.length === 0) continue;

    const makeRange = (startCol: number, endCol: number): SwmmRange => ({
      startLine: lineNum,
      startColumn: startCol,
      endLine: lineNum,
      endColumn: endCol,
      startOffset: lineStartOffset + startCol - 1,
      endOffset: lineStartOffset + endCol - 1,
    });

    const fullLineRange = makeRange(1, rawLine.length + 1);

    switch (currentSection) {
      case "TITLE":
        titleLines.push(trimmed);
        break;

      case "OPTIONS": {
        if (tokens.length >= 2) {
          const key = tokens[0]!.text.toUpperCase();
          const val = tokens[1]!.text;
          deck.options[key] = isNaN(Number(val)) ? val : Number(val);
          if (key === "FLOW_UNITS") {
            deck.flowUnits = val.toUpperCase() as SwmmFlowUnits;
          } else if (key === "FLOW_ROUTING") {
            deck.routingModel = val.toUpperCase() as SwmmRoutingModel;
          }
        }
        break;
      }

      case "JUNCTIONS": {
        // Name Elevation [MaxDepth] [InitDepth] [SurDepth] [Apond]
        if (tokens.length >= 2) {
          const id = tokens[0]!.text.toUpperCase();
          const elev = parseFloat(tokens[1]!.text);
          const maxDepth = tokens.length > 2 ? parseFloat(tokens[2]!.text) : 0.0;
          const initDepth = tokens.length > 3 ? parseFloat(tokens[3]!.text) : 0.0;
          const surDepth = tokens.length > 4 ? parseFloat(tokens[4]!.text) : 0.0;
          const aPond = tokens.length > 5 ? parseFloat(tokens[5]!.text) : 0.0;

          deck.junctions.set(id, {
            id,
            elevation: isNaN(elev) ? 0.0 : elev,
            maxDepth: isNaN(maxDepth) ? 0.0 : maxDepth,
            initDepth: isNaN(initDepth) ? undefined : initDepth,
            surDepth: isNaN(surDepth) ? undefined : surDepth,
            aPond: isNaN(aPond) ? undefined : aPond,
            range: fullLineRange,
          });
        }
        break;
      }

      case "OUTFALLS": {
        // Name Elevation Type [StageData] [Gated]
        if (tokens.length >= 3) {
          const id = tokens[0]!.text.toUpperCase();
          const elev = parseFloat(tokens[1]!.text);
          const typeStr = tokens[2]!.text.toUpperCase();
          const validTypes = ["FREE", "NORMAL", "FIXED", "TIDAL"];
          const type = (validTypes.includes(typeStr) ? typeStr : "FREE") as SwmmOutfall["type"];
          const stage = tokens.length > 3 ? parseFloat(tokens[3]!.text) : undefined;
          const gated = tokens.length > 4 && tokens[4]!.text.toUpperCase() === "YES";

          deck.outfalls.set(id, {
            id,
            elevation: isNaN(elev) ? 0.0 : elev,
            type,
            stage: stage != null && !isNaN(stage) ? stage : undefined,
            gated,
            range: fullLineRange,
          });
        }
        break;
      }

      case "STORAGE": {
        // Name Elev MaxDepth InitDepth Shape ...
        if (tokens.length >= 3) {
          const id = tokens[0]!.text.toUpperCase();
          const elev = parseFloat(tokens[1]!.text);
          const maxDepth = parseFloat(tokens[2]!.text);
          const initDepth = tokens.length > 3 ? parseFloat(tokens[3]!.text) : 0.0;
          const shape = tokens.length > 4 ? tokens[4]!.text.toUpperCase() : "FUNCTIONAL";

          deck.storage.set(id, {
            id,
            elevation: isNaN(elev) ? 0.0 : elev,
            maxDepth: isNaN(maxDepth) ? 0.0 : maxDepth,
            initDepth: isNaN(initDepth) ? undefined : initDepth,
            shape,
            range: fullLineRange,
          });
        }
        break;
      }

      case "CONDUITS": {
        // Name FromNode ToNode Length Roughness [InOffset] [OutOffset] [InitFlow] [MaxFlow]
        if (tokens.length >= 5) {
          const id = tokens[0]!.text.toUpperCase();
          const inletNode = tokens[1]!.text.toUpperCase();
          const outletNode = tokens[2]!.text.toUpperCase();
          const length = parseFloat(tokens[3]!.text);
          const roughness = parseFloat(tokens[4]!.text);
          const inOffset = tokens.length > 5 ? parseFloat(tokens[5]!.text) : 0.0;
          const outOffset = tokens.length > 6 ? parseFloat(tokens[6]!.text) : 0.0;
          const initFlow = tokens.length > 7 ? parseFloat(tokens[7]!.text) : 0.0;
          const maxFlow = tokens.length > 8 ? parseFloat(tokens[8]!.text) : undefined;

          deck.conduits.set(id, {
            id,
            inletNode,
            outletNode,
            length: isNaN(length) ? 0.0 : length,
            roughness: isNaN(roughness) ? 0.013 : roughness,
            inOffset: isNaN(inOffset) ? undefined : inOffset,
            outOffset: isNaN(outOffset) ? undefined : outOffset,
            initFlow: isNaN(initFlow) ? undefined : initFlow,
            maxFlow: maxFlow != null && !isNaN(maxFlow) ? maxFlow : undefined,
            range: fullLineRange,
          });
        }
        break;
      }

      case "PUMPS": {
        // Name FromNode ToNode [PumpCurve] [Status] [Startup] [Shutoff]
        if (tokens.length >= 3) {
          const id = tokens[0]!.text.toUpperCase();
          const inletNode = tokens[1]!.text.toUpperCase();
          const outletNode = tokens[2]!.text.toUpperCase();
          const curve = tokens.length > 3 ? tokens[3]!.text : undefined;
          const status = tokens.length > 4 && tokens[4]!.text.toUpperCase() === "OFF" ? "OFF" : "ON";

          deck.pumps.set(id, {
            id,
            inletNode,
            outletNode,
            pumpCurve: curve,
            initStatus: status,
            range: fullLineRange,
          });
        }
        break;
      }

      case "ORIFICES": {
        // Name FromNode ToNode Type Offset Cd ...
        if (tokens.length >= 6) {
          const id = tokens[0]!.text.toUpperCase();
          const inletNode = tokens[1]!.text.toUpperCase();
          const outletNode = tokens[2]!.text.toUpperCase();
          const type = tokens[3]!.text.toUpperCase() === "BOTTOM" ? "BOTTOM" : "SIDE";
          const offset = parseFloat(tokens[4]!.text);
          const cd = parseFloat(tokens[5]!.text);

          deck.orifices.set(id, {
            id,
            inletNode,
            outletNode,
            type,
            offset: isNaN(offset) ? 0.0 : offset,
            dischargeCoeff: isNaN(cd) ? 0.65 : cd,
            range: fullLineRange,
          });
        }
        break;
      }

      case "WEIRS": {
        // Name FromNode ToNode Type Offset Cd ...
        if (tokens.length >= 6) {
          const id = tokens[0]!.text.toUpperCase();
          const inletNode = tokens[1]!.text.toUpperCase();
          const outletNode = tokens[2]!.text.toUpperCase();
          const typeStr = tokens[3]!.text.toUpperCase();
          const offset = parseFloat(tokens[4]!.text);
          const cd = parseFloat(tokens[5]!.text);

          deck.weirs.set(id, {
            id,
            inletNode,
            outletNode,
            type: typeStr as SwmmWeir["type"],
            offset: isNaN(offset) ? 0.0 : offset,
            dischargeCoeff: isNaN(cd) ? 3.33 : cd,
            range: fullLineRange,
          });
        }
        break;
      }

      case "XSECTIONS": {
        // Link Shape Geom1 [Geom2] [Geom3] [Geom4] [Barrels]
        if (tokens.length >= 3) {
          const linkId = tokens[0]!.text.toUpperCase();
          const shape = tokens[1]!.text.toUpperCase() as SwmmCrossSection["shape"];
          const geom1 = parseFloat(tokens[2]!.text);
          const geom2 = tokens.length > 3 ? parseFloat(tokens[3]!.text) : undefined;
          const geom3 = tokens.length > 4 ? parseFloat(tokens[4]!.text) : undefined;
          const geom4 = tokens.length > 5 ? parseFloat(tokens[5]!.text) : undefined;
          const barrels = tokens.length > 6 ? parseInt(tokens[6]!.text, 10) : 1;

          deck.crossSections.set(linkId, {
            linkId,
            shape,
            geom1: isNaN(geom1) ? 1.0 : geom1,
            geom2: geom2 != null && !isNaN(geom2) ? geom2 : undefined,
            geom3: geom3 != null && !isNaN(geom3) ? geom3 : undefined,
            geom4: geom4 != null && !isNaN(geom4) ? geom4 : undefined,
            barrels: isNaN(barrels) ? 1 : barrels,
            range: fullLineRange,
          });
        }
        break;
      }

      case "SUBCATCHMENTS": {
        // Name RainGage Outlet Area PctImperv Width PctSlope
        if (tokens.length >= 7) {
          const id = tokens[0]!.text.toUpperCase();
          const rainGage = tokens[1]!.text;
          const outlet = tokens[2]!.text.toUpperCase();
          const area = parseFloat(tokens[3]!.text);
          const imperv = parseFloat(tokens[4]!.text);
          const width = parseFloat(tokens[5]!.text);
          const slope = parseFloat(tokens[6]!.text);

          deck.subcatchments.set(id, {
            id,
            rainGage,
            outlet,
            area: isNaN(area) ? 1.0 : area,
            impervPct: isNaN(imperv) ? 50.0 : imperv,
            width: isNaN(width) ? 100.0 : width,
            slopePct: isNaN(slope) ? 1.0 : slope,
            range: fullLineRange,
          });
        }
        break;
      }
    }
  }

  if (titleLines.length > 0) {
    deck.title = titleLines.join(" ");
  }

  deck.range = {
    startLine: 1,
    startColumn: 1,
    endLine: lines.length,
    endColumn: (lines[lines.length - 1]?.length ?? 0) + 1,
    startOffset: 0,
    endOffset: currentOffset,
  };

  return deck;
}

function tokenizeLine(line: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    const ch = line[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }

    const startCol = i + 1;
    let word = "";
    while (i < len && line[i] !== " " && line[i] !== "\t") {
      word += line[i];
      i++;
    }
    const endCol = i + 1;
    tokens.push({ text: word, startCol, endCol });
  }

  return tokens;
}

export function serializeSwmm(deck: SwmmDeck): string {
  const out: string[] = [];

  if (deck.title) {
    out.push("[TITLE]");
    out.push(`;; ${deck.title}`);
    out.push("");
  }

  out.push("[OPTIONS]");
  out.push(`FLOW_UNITS          ${deck.flowUnits}`);
  out.push(`FLOW_ROUTING        ${deck.routingModel}`);
  for (const [k, v] of Object.entries(deck.options)) {
    if (k !== "FLOW_UNITS" && k !== "FLOW_ROUTING") {
      out.push(`${k.padEnd(20, " ")} ${v}`);
    }
  }
  out.push("");

  if (deck.junctions.size > 0) {
    out.push("[JUNCTIONS]");
    out.push(";;Name           Elevation  MaxDepth   InitDepth  SurDepth   Apond");
    for (const [id, j] of deck.junctions) {
      out.push(
        `${id.padEnd(16, " ")} ${j.elevation.toFixed(2).padEnd(10, " ")} ${j.maxDepth.toFixed(2).padEnd(10, " ")} ${(j.initDepth ?? 0).toFixed(2).padEnd(10, " ")} ${(j.surDepth ?? 0).toFixed(2)}`,
      );
    }
    out.push("");
  }

  if (deck.outfalls.size > 0) {
    out.push("[OUTFALLS]");
    out.push(";;Name           Elevation  Type       Stage Data       Gated");
    for (const [id, o] of deck.outfalls) {
      out.push(
        `${id.padEnd(16, " ")} ${o.elevation.toFixed(2).padEnd(10, " ")} ${o.type.padEnd(10, " ")} ${(o.stage ?? 0).toFixed(2).padEnd(16, " ")} ${o.gated ? "YES" : "NO"}`,
      );
    }
    out.push("");
  }

  if (deck.conduits.size > 0) {
    out.push("[CONDUITS]");
    out.push(";;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset");
    for (const [id, c] of deck.conduits) {
      out.push(
        `${id.padEnd(16, " ")} ${c.inletNode.padEnd(16, " ")} ${c.outletNode.padEnd(16, " ")} ${c.length.toFixed(2).padEnd(10, " ")} ${c.roughness.toFixed(4).padEnd(10, " ")} ${(c.inOffset ?? 0).toFixed(2).padEnd(10, " ")} ${(c.outOffset ?? 0).toFixed(2)}`,
      );
    }
    out.push("");
  }

  if (deck.crossSections.size > 0) {
    out.push("[XSECTIONS]");
    out.push(";;Link           Shape        Geom1      Geom2      Geom3      Geom4      Barrels");
    for (const [id, x] of deck.crossSections) {
      out.push(
        `${id.padEnd(16, " ")} ${x.shape.padEnd(12, " ")} ${x.geom1.toFixed(2).padEnd(10, " ")} ${(x.geom2 ?? 0).toFixed(2).padEnd(10, " ")} 0.00       0.00       ${x.barrels ?? 1}`,
      );
    }
    out.push("");
  }

  return out.join("\n");
}
