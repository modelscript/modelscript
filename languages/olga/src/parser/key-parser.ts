// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Parser for Legacy OLGA Keyword Input Decks (.key / .genkey).
 *
 * Ingests keyword-based directive decks with units, vector tuples,
 * pipeline geometry, boundary nodes, and controllers into typed OlgaModel structures.
 */

import type {
  OlgaController,
  OlgaFlowpath,
  OlgaModel,
  OlgaNode,
  OlgaNodeKind,
  OlgaPig,
  OlgaPipe,
  OlgaSource,
  OlgaValve,
  OlgaWallLayer,
} from "../types.js";

interface DirectiveToken {
  keyword: string;
  params: Record<string, string>;
}

function parseUnitValue(raw: string | undefined, defaultVal: number): number {
  if (!raw) return defaultVal;
  const trimmed = raw.trim();

  // Extract numeric part and optional unit suffix
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z0-9_/^\-°]+)?/.exec(trimmed);
  if (!match) return defaultVal;

  const val = parseFloat(match[1]!);
  if (!Number.isFinite(val)) return defaultVal;

  const unit = (match[2] || "").toLowerCase();
  switch (unit) {
    // Pressure -> Pa
    case "bar":
    case "bara":
    case "barg":
      return val * 1.0e5;
    case "psi":
    case "psia":
      return val * 6894.76;
    case "mpa":
      return val * 1.0e6;
    case "kpa":
      return val * 1.0e3;

    // Length -> meters
    case "m":
    case "meter":
    case "meters":
      return val;
    case "km":
      return val * 1000.0;
    case "mm":
      return val * 1.0e-3;
    case "in":
    case "inch":
      return val * 0.0254;
    case "ft":
      return val * 0.3048;

    // Temperature -> Kelvin
    case "c":
    case "degc":
      return val + 273.15;
    case "f":
    case "degf":
      return ((val - 32) * 5) / 9 + 273.15;
    case "k":
      return val;

    // Mass rate -> kg/s
    case "kg/h":
      return val / 3600.0;
    case "kg/m":
    case "kg/min":
      return val / 60.0;
    case "ton/d":
    case "t/d":
      return (val * 1000.0) / 86400.0;

    // Time -> seconds
    case "s":
    case "sec":
    case "second":
    case "seconds":
      return val;
    case "h":
    case "hr":
    case "hrs":
      return val * 3600.0;
    case "min":
    case "minute":
    case "minutes":
      return val * 60.0;
    case "ms":
      return val * 1.0e-3;
    case "d":
    case "day":
      return val * 86400.0;

    default:
      // If no unit or standard unit, check heuristic for pressure/temp
      if (!unit && val > 0 && val < 1500 && raw.toLowerCase().includes("bar")) {
        return val * 1e5;
      }
      return val;
  }
}

/**
 * Tokenizes line-oriented OLGA keyword directives.
 * Directives can be continued using ampersand (&) or commas at line ends.
 */
function tokenizeDirectives(text: string): DirectiveToken[] {
  const lines = text.split(/\r?\n/);
  const directives: DirectiveToken[] = [];
  let currentBuffer = "";

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf("!");
    const cleanLine = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (cleanLine.length === 0) continue;

    if (cleanLine.endsWith("&") || cleanLine.endsWith(",")) {
      currentBuffer += " " + cleanLine.slice(0, -1).trim();
      continue;
    }

    currentBuffer += " " + cleanLine;
    const full = currentBuffer.trim();
    currentBuffer = "";

    // Parse KEYWORD PARAM1 = VAL1, PARAM2 = VAL2 ...
    const firstSpace = full.search(/[\s=]/);
    if (firstSpace <= 0) continue;

    const keyword = full.slice(0, firstSpace).toUpperCase();
    const rest = full.slice(firstSpace).trim();

    const params: Record<string, string> = {};
    // Regex matching KEY = VALUE where value can be quoted or parenthesized
    const paramRegex = /([A-Za-z0-9_]+)\s*=\s*("[^"]*"|'[^']*'|\([^)]*\)|[^,]+)(?:,|$)/g;
    let match: RegExpExecArray | null;
    while ((match = paramRegex.exec(rest)) !== null) {
      const k = match[1]!.toUpperCase();
      let v = match[2]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      params[k] = v;
    }

    directives.push({ keyword, params });
  }

  return directives;
}

/**
 * Parses an OLGA keyword input deck (.key / .genkey).
 */
export function parseKeyDeck(keyText: string): OlgaModel {
  const directives = tokenizeDirectives(keyText);

  let title = "OLGA Keyword Case";
  let author: string | undefined;
  let tableFile: string | undefined;
  let startTime = 0;
  let endTime = 7200;
  let minDt = 0.001;
  let maxDt = 1.0;

  const flowpaths: OlgaFlowpath[] = [];
  const nodes: OlgaNode[] = [];

  let currentFlowpath: OlgaFlowpath | null = null;
  const currentLayers: OlgaWallLayer[] = [];

  for (const dir of directives) {
    const { keyword, params } = dir;

    switch (keyword) {
      case "CASE": {
        if (params["TITLE"]) title = params["TITLE"];
        if (params["AUTHOR"]) author = params["AUTHOR"];
        break;
      }

      case "INTEGRATION": {
        if (params["STARTTIME"]) startTime = parseUnitValue(params["STARTTIME"], startTime);
        if (params["ENDTIME"]) endTime = parseUnitValue(params["ENDTIME"], endTime);
        if (params["MINDT"]) minDt = parseUnitValue(params["MINDT"], minDt);
        if (params["MAXDT"]) maxDt = parseUnitValue(params["MAXDT"], maxDt);
        break;
      }

      case "FILES": {
        if (params["TABLE"]) tableFile = params["TABLE"];
        break;
      }

      case "FLOWPATH": {
        const name = params["NAME"] || `FLOWPATH_${flowpaths.length + 1}`;
        currentFlowpath = {
          name,
          pipes: [],
          valves: [],
          sources: [],
          controllers: [],
        };
        flowpaths.push(currentFlowpath);
        break;
      }

      case "PIPE": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }

        const pipe: OlgaPipe = {
          label: params["LABEL"] || `PIPE_${currentFlowpath.pipes.length + 1}`,
          length: parseUnitValue(params["LENGTH"] ?? params["L"], 1000),
          diameter: parseUnitValue(params["DIAMETER"] ?? params["DIAM"], 0.254),
          elevation: parseUnitValue(params["ELEVATION"] ?? params["ELEV"], 0),
          roughness: parseUnitValue(params["ROUGHNESS"] ?? params["ROUGH"], 4.5e-5),
          discretization: Math.max(2, Math.floor(parseUnitValue(params["NSEGMENT"] ?? params["DISCRETIZATION"], 10))),
        };
        currentFlowpath.pipes.push(pipe);
        break;
      }

      case "VALVE": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }

        const valve: OlgaValve = {
          name: params["NAME"] || params["LABEL"] || `VALVE_${currentFlowpath.valves.length + 1}`,
          position: parseUnitValue(params["ABSPOSITION"] ?? params["POSITION"], 0),
          diameter: parseUnitValue(params["DIAMETER"], 0.2),
          opening: parseUnitValue(params["OPENING"], 1.0),
          cd: parseUnitValue(params["CD"], 0.84),
          timeToOpen: parseUnitValue(params["TIMEOPEN"], 5.0),
          timeToClose: parseUnitValue(params["TIMECLOSE"], 5.0),
        };
        currentFlowpath.valves.push(valve);
        break;
      }

      case "SOURCE":
      case "MASSSOURCE": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }

        const source: OlgaSource = {
          name: params["NAME"] || `SOURCE_${currentFlowpath.sources.length + 1}`,
          position: parseUnitValue(params["ABSPOSITION"] ?? params["POSITION"], 0),
          totalMassRate: parseUnitValue(params["TOTALMASSRATE"] ?? params["MASSRATE"], 30.0),
          gasMassFraction: parseUnitValue(params["GASFRACTION"] ?? params["GASMASSRATE"], 0.2),
          waterCut: parseUnitValue(params["WATERCUT"], 0.05),
          temperature: parseUnitValue(params["TEMPERATURE"], 353.15),
          pressure: params["PRESSURE"] ? parseUnitValue(params["PRESSURE"], 150e5) : undefined,
        };
        currentFlowpath.sources.push(source);
        break;
      }

      case "CONTROLLER": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }

        const ctrl: OlgaController = {
          name: params["NAME"] || `CTRL_${currentFlowpath.controllers.length + 1}`,
          type: (params["TYPE"] || "PID").toUpperCase() as "PID" | "MANUAL" | "ON_OFF",
          setpoint: parseUnitValue(params["SETPOINT"], 50.0),
          gain: parseUnitValue(params["GAIN"], 1.0),
          ti: parseUnitValue(params["TI"], 20.0),
          td: parseUnitValue(params["TD"], 0.0),
          transmitter: params["TRANSMITTER"] || "",
          controlledValve: params["VALVE"] ?? params["CONTROLLEDVALVE"] ?? "",
        };
        currentFlowpath.controllers.push(ctrl);
        break;
      }

      case "PIG": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [], pigs: [] };
          flowpaths.push(currentFlowpath);
        }
        if (!currentFlowpath.pigs) currentFlowpath.pigs = [];

        const pig: OlgaPig = {
          name: params["NAME"] || `PIG_${currentFlowpath.pigs.length + 1}`,
          launchTime: parseUnitValue(params["LAUNCHTIME"] ?? params["LAUNCH_TIME"] ?? params["TIME"], 0.0),
          mass: parseUnitValue(params["MASS"], 100.0),
          diameter: parseUnitValue(params["DIAMETER"] ?? params["DIAM"], 0.3),
          bypassFraction: parseUnitValue(params["BYPASS"] ?? params["BYPASSFRACTION"], 0.0),
          frictionForce: parseUnitValue(params["FRICTION"] ?? params["FRICTIONFORCE"], 2500.0),
        };
        currentFlowpath.pigs.push(pig);
        break;
      }

      case "WALL": {
        const thicknessRaw = params["THICKNESS"] || "0.02";
        const condRaw = params["CONDUCTIVITY"] || "45.0";
        // Parse tuple or scalar
        const tVals = thicknessRaw
          .replace(/[()]/g, "")
          .split(/[\s,]+/)
          .map((v) => parseUnitValue(v, 0.02));
        const cVals = condRaw
          .replace(/[()]/g, "")
          .split(/[\s,]+/)
          .map((v) => parseUnitValue(v, 45.0));

        for (let i = 0; i < tVals.length; i++) {
          currentLayers.push({
            material: params["MATERIAL"] || `LAYER_${i + 1}`,
            thickness: tVals[i]!,
            conductivity: cVals[i] ?? 45.0,
          });
        }
        break;
      }

      case "HEATTRANSFER": {
        if (currentFlowpath) {
          const type = (params["TYPE"] || "WATER").toUpperCase() as "WALL" | "AIR" | "WATER" | "BURIED";
          currentFlowpath.heatTransfer = {
            type,
            ambientTemperature: parseUnitValue(params["TAMB"] ?? params["AMBIENTTEMPERATURE"], 277.15),
            ambientHeatTransferCoeff: parseUnitValue(params["HAMB"] ?? params["AMBIENTHEATTRANSFERCOEFF"], 250.0),
            layers: [...currentLayers],
          };
        }
        break;
      }

      case "NODE": {
        const name = params["NAME"] || `NODE_${nodes.length + 1}`;
        const rawType = (params["TYPE"] || "INTERNAL").toUpperCase();
        const type: OlgaNodeKind = ["TERMINAL", "PRESSURE", "MASS_SOURCE", "INTERNAL", "SEPARATOR"].includes(rawType)
          ? (rawType as OlgaNodeKind)
          : "INTERNAL";

        const flowpathName = params["FLOWPATH"] || (currentFlowpath ? currentFlowpath.name : "FLOWPATH_1");
        const boundaryPos = parseUnitValue(params["FRACTION"] ?? params["BOUNDARYPOSITION"], 0.0);

        const node: OlgaNode = {
          name,
          type,
          flowpath: flowpathName,
          boundaryPosition: boundaryPos,
          pressure: params["PRESSURE"] ? parseUnitValue(params["PRESSURE"], 50e5) : undefined,
          temperature: params["TEMPERATURE"] ? parseUnitValue(params["TEMPERATURE"], 293.15) : undefined,
          massRate:
            (params["TOTALMASSRATE"] ?? params["MASSRATE"])
              ? parseUnitValue(params["TOTALMASSRATE"] ?? params["MASSRATE"], 30.0)
              : undefined,
          gasMassFraction: params["GASFRACTION"] ? parseUnitValue(params["GASFRACTION"], 0.2) : undefined,
          waterCut: params["WATERCUT"] ? parseUnitValue(params["WATERCUT"], 0.05) : undefined,
        };
        nodes.push(node);
        break;
      }
    }
  }

  // Ensure flowpaths have heat transfer if parsed globally
  if (currentLayers.length > 0 && flowpaths.length > 0) {
    for (const fp of flowpaths) {
      if (!fp.heatTransfer) {
        fp.heatTransfer = {
          type: "WATER",
          ambientTemperature: 277.15,
          ambientHeatTransferCoeff: 250.0,
          layers: [...currentLayers],
        };
      }
    }
  }

  return {
    title,
    author,
    tableFile,
    startTime,
    endTime,
    minDt,
    maxDt,
    flowpaths,
    nodes,
  };
}

/**
 * Serializes an OlgaModel into standard OLGA keyword deck format (.key / .genkey).
 */
export function serializeKeyDeck(model: OlgaModel): string {
  const lines: string[] = [];

  // Header / Case
  lines.push(`CASE TITLE = "${model.title}", AUTHOR = "${model.author || "ModelScript"}"`);
  lines.push(
    `INTEGRATION STARTTIME = ${model.startTime} s, ENDTIME = ${model.endTime} s, MINDT = ${model.minDt} s, MAXDT = ${model.maxDt} s`,
  );

  if (model.tableFile) {
    lines.push(`FILES TABLE = "${model.tableFile}"`);
  }
  lines.push("");

  // Flowpaths
  for (const fp of model.flowpaths) {
    lines.push(`FLOWPATH NAME = ${fp.name}`);

    // Heat transfer
    if (fp.heatTransfer) {
      lines.push(
        `HEATTRANSFER TYPE = ${fp.heatTransfer.type}, TAMB = ${fp.heatTransfer.ambientTemperature} K, HAMB = ${fp.heatTransfer.ambientHeatTransferCoeff} W/m2-C`,
      );
      if (fp.heatTransfer.layers && fp.heatTransfer.layers.length > 0) {
        const tStr = fp.heatTransfer.layers.map((l) => `${l.thickness} m`).join(", ");
        const cStr = fp.heatTransfer.layers.map((l) => `${l.conductivity} W/m-C`).join(", ");
        lines.push(`WALL THICKNESS = (${tStr}), CONDUCTIVITY = (${cStr})`);
      }
    }

    // Pipes
    for (const p of fp.pipes) {
      lines.push(
        `PIPE LABEL = ${p.label}, LENGTH = ${p.length} m, DIAMETER = ${p.diameter} m, ELEVATION = ${p.elevation} m, ROUGHNESS = ${p.roughness} m, NSEGMENT = ${p.discretization}`,
      );
    }

    // Valves
    for (const v of fp.valves) {
      lines.push(
        `VALVE NAME = ${v.name}, POSITION = ${v.position} m, DIAMETER = ${v.diameter} m, OPENING = ${v.opening}, CD = ${v.cd}, TIMEOPEN = ${v.timeToOpen} s, TIMECLOSE = ${v.timeToClose} s`,
      );
    }

    // Sources
    for (const s of fp.sources) {
      const pStr = s.pressure !== undefined ? `, PRESSURE = ${s.pressure / 1e5} bar` : "";
      lines.push(
        `MASSSOURCE NAME = ${s.name}, POSITION = ${s.position} m, TOTALMASSRATE = ${s.totalMassRate} kg/s, GASFRACTION = ${s.gasMassFraction}, WATERCUT = ${s.waterCut}, TEMPERATURE = ${s.temperature} K${pStr}`,
      );
    }

    // Controllers
    for (const c of fp.controllers) {
      lines.push(
        `CONTROLLER NAME = ${c.name}, TYPE = ${c.type}, SETPOINT = ${c.setpoint}, GAIN = ${c.gain}, TI = ${c.ti} s, TD = ${c.td} s, TRANSMITTER = "${c.transmitter}", VALVE = "${c.controlledValve}"`,
      );
    }

    // Pigs
    if (fp.pigs) {
      for (const p of fp.pigs) {
        lines.push(
          `PIG NAME = ${p.name}, LAUNCHTIME = ${p.launchTime} s, MASS = ${p.mass ?? 100} kg, DIAMETER = ${p.diameter ?? 0.3} m, BYPASS = ${p.bypassFraction ?? 0.0}, FRICTION = ${p.frictionForce ?? 2500} N`,
        );
      }
    }
    lines.push("");
  }

  // Nodes
  for (const n of model.nodes) {
    const parts = [
      `NODE NAME = ${n.name}`,
      `TYPE = ${n.type}`,
      `FLOWPATH = ${n.flowpath}`,
      `FRACTION = ${n.boundaryPosition}`,
    ];
    if (n.pressure !== undefined) parts.push(`PRESSURE = ${n.pressure / 1e5} bar`);
    if (n.temperature !== undefined) parts.push(`TEMPERATURE = ${n.temperature} K`);
    if (n.massRate !== undefined) parts.push(`TOTALMASSRATE = ${n.massRate} kg/s`);
    if (n.gasMassFraction !== undefined) parts.push(`GASFRACTION = ${n.gasMassFraction}`);
    if (n.waterCut !== undefined) parts.push(`WATERCUT = ${n.waterCut}`);

    lines.push(parts.join(", "));
  }

  return lines.join("\n") + "\n";
}
