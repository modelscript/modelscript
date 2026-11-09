// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Zero-Regex EPANET INP Parser.
 *
 * Ingests EPANET 2.x hydraulic network decks (.inp) with section streaming,
 * whitespace tokenization, inline comment stripping, and line/col tracking.
 */

import type {
  EpanetControl,
  EpanetFlowUnits,
  EpanetHeadLossModel,
  EpanetNetwork,
  EpanetRange,
  EpanetValveType,
} from "../types.js";

export function parseInp(source: string, filename?: string): EpanetNetwork {
  const lines = source.split(/\r?\n/);

  const net: EpanetNetwork = {
    junctions: [],
    reservoirs: [],
    tanks: [],
    pipes: [],
    pumps: [],
    valves: [],
    curves: [],
    patterns: [],
    controls: [],
    rules: [],
    options: {
      units: "LPS",
      headloss: "H-W",
      specificGravity: 1.0,
      viscosity: 1.0,
      trials: 40,
      accuracy: 0.001,
      flowChange: 0.0,
    },
    filename,
  };

  let currentSection = "";
  let currentOffset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineLen = rawLine.length + 1; // + newline
    const lineNum = lineIdx + 1;

    // Strip comments
    let lineContent = rawLine;
    const semiIdx = lineContent.indexOf(";");
    if (semiIdx !== -1) {
      lineContent = lineContent.slice(0, semiIdx);
    }
    const trimmed = lineContent.trim();

    if (trimmed.length === 0) {
      currentOffset += lineLen;
      continue;
    }

    // Check for Section Header: [SECTION]
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = trimmed.slice(1, -1).trim().toUpperCase();
      currentOffset += lineLen;
      continue;
    }

    // Tokenize fields by whitespace
    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 0) {
      currentOffset += lineLen;
      continue;
    }

    const colNum = rawLine.indexOf(tokens[0]!) + 1;
    const range: EpanetRange = {
      startLine: lineNum,
      startColumn: Math.max(1, colNum),
      endLine: lineNum,
      endColumn: Math.max(1, colNum + tokens[0]!.length),
      startOffset: currentOffset,
      endOffset: currentOffset + rawLine.length,
    };

    switch (currentSection) {
      case "TITLE": {
        if (!net.title) {
          net.title = trimmed;
        } else {
          net.title += ` ${trimmed}`;
        }
        break;
      }

      case "JUNCTIONS": {
        const id = tokens[0]!;
        const elev = parseFloat(tokens[1] ?? "0") || 0;
        const demand = parseFloat(tokens[2] ?? "0") || 0;
        const patternId = tokens[3] && tokens[3] !== ";" ? tokens[3] : undefined;
        net.junctions.push({
          id,
          elevation: elev,
          demand,
          patternId,
          range,
        });
        break;
      }

      case "RESERVOIRS": {
        const id = tokens[0]!;
        const head = parseFloat(tokens[1] ?? "0") || 0;
        const patternId = tokens[2] && tokens[2] !== ";" ? tokens[2] : undefined;
        net.reservoirs.push({
          id,
          totalHead: head,
          patternId,
          range,
        });
        break;
      }

      case "TANKS": {
        const id = tokens[0]!;
        const elev = parseFloat(tokens[1] ?? "0") || 0;
        const initLvl = parseFloat(tokens[2] ?? "0") || 0;
        const minLvl = parseFloat(tokens[3] ?? "0") || 0;
        const maxLvl = parseFloat(tokens[4] ?? "0") || 0;
        const diam = parseFloat(tokens[5] ?? "0") || 0;
        const minVol = parseFloat(tokens[6] ?? "0") || 0;
        const volCurveId = tokens[7] && tokens[7] !== ";" ? tokens[7] : undefined;
        net.tanks.push({
          id,
          elevation: elev,
          initLevel: initLvl,
          minLevel: minLvl,
          maxLevel: maxLvl,
          diameter: diam,
          minVol,
          volCurveId,
          range,
        });
        break;
      }

      case "PIPES": {
        const id = tokens[0]!;
        const n1 = tokens[1] ?? "";
        const n2 = tokens[2] ?? "";
        const len = parseFloat(tokens[3] ?? "0") || 0;
        const diam = parseFloat(tokens[4] ?? "0") || 0;
        const rough = parseFloat(tokens[5] ?? "100") || 100;
        const minorLoss = parseFloat(tokens[6] ?? "0") || 0;
        let status: "OPEN" | "CLOSED" | "CV" = "OPEN";
        const stStr = tokens[7]?.toUpperCase();
        if (stStr === "CLOSED") status = "CLOSED";
        else if (stStr === "CV") status = "CV";

        net.pipes.push({
          id,
          node1: n1,
          node2: n2,
          length: len,
          diameter: diam,
          roughness: rough,
          minorLoss,
          status,
          range,
        });
        break;
      }

      case "PUMPS": {
        const id = tokens[0]!;
        const n1 = tokens[1] ?? "";
        const n2 = tokens[2] ?? "";
        let headCurveId: string | undefined;
        let power: number | undefined;

        // e.g. "HEAD Curve1" or "POWER 50"
        for (let i = 3; i < tokens.length; i++) {
          const t = tokens[i]!.toUpperCase();
          if (t === "HEAD" && i + 1 < tokens.length) {
            headCurveId = tokens[++i];
          } else if (t === "POWER" && i + 1 < tokens.length) {
            power = parseFloat(tokens[++i] ?? "0");
          }
        }

        net.pumps.push({
          id,
          node1: n1,
          node2: n2,
          headCurveId,
          power,
          status: "OPEN",
          range,
        });
        break;
      }

      case "VALVES": {
        const id = tokens[0]!;
        const n1 = tokens[1] ?? "";
        const n2 = tokens[2] ?? "";
        const diam = parseFloat(tokens[3] ?? "0") || 0;
        const type = (tokens[4]?.toUpperCase() ?? "PRV") as EpanetValveType;
        const setting = parseFloat(tokens[5] ?? "0") || 0;
        const minorLoss = parseFloat(tokens[6] ?? "0") || 0;

        net.valves.push({
          id,
          node1: n1,
          node2: n2,
          diameter: diam,
          type,
          setting,
          minorLoss,
          range,
        });
        break;
      }

      case "CURVES": {
        const id = tokens[0]!;
        const x = parseFloat(tokens[1] ?? "0") || 0;
        const y = parseFloat(tokens[2] ?? "0") || 0;

        const existingCurve = net.curves.find((c) => c.id === id);
        if (existingCurve) {
          existingCurve.points.push({ x, y });
        } else {
          net.curves.push({
            id,
            points: [{ x, y }],
            range,
          });
        }
        break;
      }

      case "PATTERNS": {
        const id = tokens[0]!;
        const multipliers: number[] = [];
        for (let i = 1; i < tokens.length; i++) {
          const val = parseFloat(tokens[i]!);
          if (!isNaN(val)) multipliers.push(val);
        }

        const existingPat = net.patterns.find((p) => p.id === id);
        if (existingPat) {
          existingPat.multipliers.push(...multipliers);
        } else {
          net.patterns.push({
            id,
            multipliers,
            range,
          });
        }
        break;
      }

      case "CONTROLS": {
        const linkKeyword = tokens[0]?.toUpperCase();
        if (linkKeyword === "LINK" && tokens.length >= 3) {
          const linkId = tokens[1]!;
          const status = tokens[2]!.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
          let conditionType: EpanetControl["conditionType"] = "NODE_HEAD";
          let nodeId: string | undefined;
          let operator: "ABOVE" | "BELOW" | undefined;
          let value = 0;

          if (tokens[3]?.toUpperCase() === "IF" && tokens[4]?.toUpperCase() === "NODE" && tokens.length >= 8) {
            nodeId = tokens[5]!;
            operator = tokens[6]!.toUpperCase() === "BELOW" ? "BELOW" : "ABOVE";
            value = parseFloat(tokens[7]!) || 0;
            conditionType = "TANK_LEVEL";
          } else if (tokens[3]?.toUpperCase() === "AT" && tokens[4]?.toUpperCase() === "TIME") {
            conditionType = "TIME";
            value = parseFloat(tokens[5]!) || 0;
          }

          net.controls ??= [];
          net.controls.push({
            linkId,
            status,
            conditionType,
            nodeId,
            operator,
            value,
            range,
          });
        }
        break;
      }

      case "RULES": {
        const ruleId = tokens[0] ?? `Rule_${(net.rules?.length ?? 0) + 1}`;
        net.rules ??= [];
        net.rules.push({
          id: ruleId,
          condition: tokens.slice(1).join(" "),
          action: "",
          range,
        });
        break;
      }

      case "TIMES": {
        const key = tokens[0]?.toUpperCase();
        const val = tokens[1];
        if (key === "DURATION" && val) {
          net.options.durationHours = parseFloat(val) || 24;
        } else if (key === "HYDRAULIC" && tokens[1]?.toUpperCase() === "TIMESTEP" && tokens[2]) {
          net.options.hydraulicStepHours = parseFloat(tokens[2]) || 1;
        } else if (key === "PATTERN" && tokens[1]?.toUpperCase() === "TIMESTEP" && tokens[2]) {
          net.options.patternStepHours = parseFloat(tokens[2]) || 1;
        }
        break;
      }

      case "OPTIONS": {
        const key = tokens[0]?.toUpperCase();
        const val = tokens[1];
        if (key === "UNITS" && val) {
          net.options.units = val.toUpperCase() as EpanetFlowUnits;
        } else if (key === "HEADLOSS" && val) {
          net.options.headloss = val.toUpperCase() as EpanetHeadLossModel;
        } else if (key === "ACCURACY" && val) {
          net.options.accuracy = parseFloat(val) || 0.001;
        } else if (key === "TRIALS" && val) {
          net.options.trials = parseInt(val, 10) || 40;
        } else if (key === "DEMAND" && tokens[1]?.toUpperCase() === "MODEL" && tokens[2]) {
          net.options.demandModel = tokens[2].toUpperCase() === "PDD" ? "PDD" : "DDA";
        } else if (key === "MINIMUM" && tokens[1]?.toUpperCase() === "PRESSURE" && tokens[2]) {
          net.options.pddMinPressure = parseFloat(tokens[2]) || 0;
        } else if (key === "REQUIRED" && tokens[1]?.toUpperCase() === "PRESSURE" && tokens[2]) {
          net.options.pddReqPressure = parseFloat(tokens[2]) || 20;
        } else if (key === "PRESSURE" && tokens[1]?.toUpperCase() === "EXPONENT" && tokens[2]) {
          net.options.pddPressureExponent = parseFloat(tokens[2]) || 0.5;
        }
        break;
      }
    }

    currentOffset += lineLen;
  }

  return net;
}
