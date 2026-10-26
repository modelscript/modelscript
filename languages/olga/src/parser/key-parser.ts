// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Parser for Legacy OLGA Keyword Input Decks (.key / .genkey).
 *
 * Ingests keyword-based directive decks with units, vector tuples,
 * pipeline geometry, boundary nodes, and controllers into typed OlgaModel structures.
 */

import type {
  IprModelType,
  OlgaAsphalteneConfig,
  OlgaCompressor,
  OlgaController,
  OlgaFlowpath,
  OlgaHeatExchanger,
  OlgaIpr,
  OlgaModel,
  OlgaNode,
  OlgaNodeKind,
  OlgaPig,
  OlgaPipe,
  OlgaPump,
  OlgaSandConfig,
  OlgaSource,
  OlgaValve,
  OlgaWallLayer,
  OlgaWaxConfig,
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

    // Power -> kW
    case "kw":
      return val;
    case "mw":
      return val * 1000.0;
    case "w":
      return val * 1.0e-3;
    case "hp":
      return val * 0.7457;

    // Volumetric flow -> m3/s
    case "m3/s":
      return val;
    case "m3/h":
      return val / 3600.0;
    case "m3/d":
    case "sm3/d":
      return val / 86400.0;
    case "bpd":
      return (val * 0.158987) / 86400.0;

    // Rotational speed -> rpm
    case "rpm":
      return val;

    // Microns -> meters
    case "um":
    case "micron":
    case "microns":
      return val * 1.0e-6;

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
    let pIdx = 0;
    const pLen = rest.length;
    while (pIdx < pLen) {
      while (pIdx < pLen && (rest[pIdx] === " " || rest[pIdx] === "\t" || rest[pIdx] === ",")) pIdx++;
      if (pIdx >= pLen) break;

      // Handle leading quoted positional label/name (e.g. CASE "SubseaTieback", FLOWPATH "TiebackLine", PIPE "P-101")
      if (rest[pIdx] === '"' || rest[pIdx] === "'") {
        const quote = rest[pIdx++];
        const valStart = pIdx;
        while (pIdx < pLen && rest[pIdx] !== quote) pIdx++;
        const strVal = rest.slice(valStart, pIdx);
        if (pIdx < pLen) pIdx++; // skip quote
        params["LABEL"] = strVal;
        params["NAME"] = strVal;
        params["TITLE"] = strVal;
        if (pIdx < pLen && rest[pIdx] === ",") pIdx++;
        continue;
      }

      const keyStart = pIdx;
      while (pIdx < pLen && rest[pIdx] !== "=" && rest[pIdx] !== "," && rest[pIdx] !== " " && rest[pIdx] !== "\t")
        pIdx++;
      const k = rest.slice(keyStart, pIdx).trim().toUpperCase();
      while (pIdx < pLen && (rest[pIdx] === " " || rest[pIdx] === "\t")) pIdx++;
      if (pIdx < pLen && rest[pIdx] === "=") {
        pIdx++; // skip '='
        while (pIdx < pLen && (rest[pIdx] === " " || rest[pIdx] === "\t")) pIdx++;
        let v = "";
        if (pIdx < pLen && (rest[pIdx] === '"' || rest[pIdx] === "'")) {
          const quote = rest[pIdx++];
          const valStart = pIdx;
          while (pIdx < pLen && rest[pIdx] !== quote) pIdx++;
          v = rest.slice(valStart, pIdx);
          if (pIdx < pLen) pIdx++; // skip quote
        } else if (pIdx < pLen && rest[pIdx] === "(") {
          let depth = 1;
          const valStart = pIdx;
          pIdx++;
          while (pIdx < pLen && depth > 0) {
            if (rest[pIdx] === "(") depth++;
            else if (rest[pIdx] === ")") depth--;
            pIdx++;
          }
          v = rest.slice(valStart, pIdx);
        } else {
          const valStart = pIdx;
          while (pIdx < pLen && rest[pIdx] !== ",") pIdx++;
          v = rest.slice(valStart, pIdx).trim();
        }
        if (k) params[k] = v;
      } else if (k) {
        params[k] = "";
      }
      if (pIdx < pLen && rest[pIdx] === ",") pIdx++;
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
  let restartConfig: { file: string; time?: number | undefined } | undefined;
  let outputConfig:
    | { trendInterval?: number | undefined; profileInterval?: number | undefined; variables?: string[] | undefined }
    | undefined;

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

      case "RESTART": {
        const file = params["FILE"] || "restart.rst";
        const time = params["TIME"] ? parseUnitValue(params["TIME"], 0) : undefined;
        restartConfig = { file, time };
        break;
      }

      case "OUTPUT": {
        const trend = params["TREND"] ? parseUnitValue(params["TREND"], 10.0) : undefined;
        const profile = params["PROFILE"] ? parseUnitValue(params["PROFILE"], 60.0) : undefined;
        let variables: string[] | undefined;
        if (params["VARIABLES"]) {
          variables = params["VARIABLES"]
            .replace(/[()]/g, "")
            .split(/[\s,]+/)
            .filter(Boolean);
        }
        outputConfig = { trendInterval: trend, profileInterval: profile, variables };
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
        const metallurgy = params["METALLURGY"] || params["MATERIAL"];
        const cladding = params["CLADDING"];
        if (metallurgy) pipe.metallurgy = metallurgy;
        if (cladding) pipe.cladding = cladding;

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
        if (params["H2S"] !== undefined) source.h2sMoleFraction = parseUnitValue(params["H2S"], 0.0);
        if (params["CO2"] !== undefined) source.co2MoleFraction = parseUnitValue(params["CO2"], 0.0);

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

      case "PUMP": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }
        if (!currentFlowpath.pumps) currentFlowpath.pumps = [];
        const rawType = (params["TYPE"] || "CENTRIFUGAL").toUpperCase();
        const type = rawType === "ESP" || rawType === "MULTIPHASE_TWIN_SCREW" ? rawType : "CENTRIFUGAL";
        const pump: OlgaPump = {
          name: params["NAME"] || `PUMP_${currentFlowpath.pumps.length + 1}`,
          position: parseUnitValue(params["ABSPOSITION"] ?? params["POSITION"], 0),
          type,
          ratedHead: parseUnitValue(params["HEAD"] ?? params["RATEDHEAD"] ?? params["PRESSUREBOOST"], 100.0),
          ratedFlowRate: parseUnitValue(params["FLOWRATE"] ?? params["RATEDFLOWRATE"] ?? params["Q"], 0.05),
          speedRpm: parseUnitValue(params["SPEED"] ?? params["RPM"] ?? params["SPEEDRPM"], 3500.0),
          ratedPowerKw: parseUnitValue(params["POWER"] ?? params["RATEDPOWERKW"], 400.0),
          gasVoidFractionLimit: parseUnitValue(params["GVFLIMIT"] ?? params["GVF"], 0.2),
        };
        currentFlowpath.pumps.push(pump);
        break;
      }

      case "COMPRESSOR": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }
        if (!currentFlowpath.compressors) currentFlowpath.compressors = [];
        const rawType = (params["TYPE"] || "CENTRIFUGAL").toUpperCase();
        const type = rawType === "RECIPROCATING" ? "RECIPROCATING" : "CENTRIFUGAL";
        const compressor: OlgaCompressor = {
          name: params["NAME"] || `COMP_${currentFlowpath.compressors.length + 1}`,
          position: parseUnitValue(params["ABSPOSITION"] ?? params["POSITION"], 0),
          type,
          pressureRatio: parseUnitValue(params["PRESSRATIO"] ?? params["PRESSURERATIO"] ?? params["RATIO"], 2.5),
          polytropicEfficiency: parseUnitValue(
            params["EFFICIENCY"] ?? params["POLYTROPICEFFICIENCY"] ?? params["POLY_EFF"],
            0.78,
          ),
          ratedPowerKw: parseUnitValue(params["POWER"] ?? params["RATEDPOWERKW"], 2500.0),
          antiSurgeMargin: parseUnitValue(params["ANTISURGEMARGIN"] ?? params["SURGEMARGIN"], 0.1),
        };
        currentFlowpath.compressors.push(compressor);
        break;
      }

      case "WELL":
      case "IPR": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }
        const rawType = (params["TYPE"] || "VOGEL").toUpperCase();
        const type: IprModelType = rawType === "LINEAR_PI" || rawType === "FETKOVICH" ? rawType : "VOGEL";
        const ipr: OlgaIpr = {
          type,
          reservoirPressure: parseUnitValue(params["PRES"] ?? params["RESERVOIRPRESSURE"] ?? params["PRESSURE"], 180e5),
          reservoirTemperature: parseUnitValue(
            params["TRES"] ?? params["RESERVOIRTEMPERATURE"] ?? params["TEMPERATURE"],
            353.15,
          ),
          bubblePointPressure: params["PBUBBLE"] ? parseUnitValue(params["PBUBBLE"], 140e5) : undefined,
          productivityIndex: params["PI"] ? parseUnitValue(params["PI"], 5e-7) : undefined,
          maxLiquidRate: params["QMAX"] ? parseUnitValue(params["QMAX"], 45.0) : undefined,
          cFactor: params["CFACTOR"] ? parseUnitValue(params["CFACTOR"], 1e-12) : undefined,
          nExponent: params["NEXPONENT"] ? parseUnitValue(params["NEXPONENT"], 0.85) : undefined,
          gasMassFraction: parseUnitValue(params["GASFRACTION"] ?? params["GASMASSFRACTION"], 0.2),
          waterCut: parseUnitValue(params["WATERCUT"], 0.05),
        };
        currentFlowpath.ipr = ipr;
        break;
      }

      case "WAX": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }
        const waxConfig: OlgaWaxConfig = {
          cloudPointTemp: parseUnitValue(params["CLOUDPOINT"] ?? params["WAT"] ?? params["CLOUDPOINTTEMP"], 310.15),
          molecularDiffusionCoeff: params["DIFFUSION"] ? parseUnitValue(params["DIFFUSION"], 1.5e-9) : undefined,
          waxDensity: params["DENSITY"] ? parseUnitValue(params["DENSITY"], 880.0) : undefined,
        };
        currentFlowpath.waxConfig = waxConfig;
        break;
      }

      case "SAND": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }
        const sandConfig: OlgaSandConfig = {
          sandMassRate: parseUnitValue(params["MASSRATE"] ?? params["SANDMASSRATE"] ?? params["RATE"], 0.05),
          particleDiameter: params["DIAMETER"] ? parseUnitValue(params["DIAMETER"], 150e-6) : undefined,
          sandDensity: params["DENSITY"] ? parseUnitValue(params["DENSITY"], 2650.0) : undefined,
        };
        currentFlowpath.sandConfig = sandConfig;
        break;
      }

      case "ASPHALTENE":
      case "ASPHALTENES": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }
        const sat = parseUnitValue(params["SATURATES"] ?? params["SAT"], 40.0);
        const aro = parseUnitValue(params["AROMATICS"] ?? params["ARO"], 30.0);
        const res = parseUnitValue(params["RESINS"] ?? params["RES"], 20.0);
        const asp = parseUnitValue(params["ASPHALTENES"] ?? params["ASP"], 10.0);
        const asphalteneConfig: OlgaAsphalteneConfig = {
          sara: {
            saturatesPercent: sat,
            aromaticsPercent: aro,
            resinsPercent: res,
            asphaltenesPercent: asp,
          },
          bubblePointPressure:
            (params["BUBBLEPOINT"] ?? params["PB"])
              ? parseUnitValue(params["BUBBLEPOINT"] ?? params["PB"], 120e5)
              : undefined,
          exposureTimeHours:
            (params["EXPOSURETIME"] ?? params["HOURS"])
              ? (() => {
                  const raw = (params["EXPOSURETIME"] ?? params["HOURS"])!.trim();
                  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z]+)?/.exec(raw);
                  if (!m) return 720.0;
                  const v = parseFloat(m[1]!);
                  const u = (m[2] || "").toLowerCase();
                  if (u === "s" || u === "sec" || u === "seconds") return v / 3600.0;
                  if (u === "d" || u === "day" || u === "days") return v * 24.0;
                  return v;
                })()
              : undefined,
          existingDepositThicknessM:
            (params["INITIALTHICKNESS"] ?? params["THICKNESS"])
              ? parseUnitValue(params["INITIALTHICKNESS"] ?? params["THICKNESS"], 0.0)
              : undefined,
        };
        currentFlowpath.asphalteneConfig = asphalteneConfig;
        break;
      }

      case "HEATEXCHANGER":
      case "HEX": {
        if (!currentFlowpath) {
          currentFlowpath = { name: "FLOWPATH_1", pipes: [], valves: [], sources: [], controllers: [] };
          flowpaths.push(currentFlowpath);
        }
        if (!currentFlowpath.heatExchangers) currentFlowpath.heatExchangers = [];
        const rawType = (params["TYPE"] || "SIMPLE").toUpperCase();
        const type = ["SIMPLE", "CROSS_FLOW", "CO_CURRENT", "COUNTER_CURRENT"].includes(rawType)
          ? (rawType as "SIMPLE" | "CROSS_FLOW" | "CO_CURRENT" | "COUNTER_CURRENT")
          : "SIMPLE";
        const hex: OlgaHeatExchanger = {
          name: params["NAME"] || `HEX_${currentFlowpath.heatExchangers.length + 1}`,
          position: parseUnitValue(params["ABSPOSITION"] ?? params["POSITION"], 0),
          type,
          dutyKw:
            (params["DUTY"] ?? params["CAPACITY"])
              ? parseUnitValue(params["DUTY"] ?? params["CAPACITY"], 1000.0)
              : undefined,
          targetTemperature:
            (params["TARGETTEMP"] ?? params["TARGETTEMPERATURE"] ?? params["TOUT"])
              ? parseUnitValue(params["TARGETTEMP"] ?? params["TARGETTEMPERATURE"] ?? params["TOUT"], 313.15)
              : undefined,
          overallUa:
            (params["UA"] ?? params["OVERALLUA"])
              ? parseUnitValue(params["UA"] ?? params["OVERALLUA"], 50000.0)
              : undefined,
          ambientTemperature:
            (params["TAMB"] ?? params["AMBIENTTEMPERATURE"] ?? params["TCOOLANT"])
              ? parseUnitValue(params["TAMB"] ?? params["AMBIENTTEMPERATURE"] ?? params["TCOOLANT"], 288.15)
              : undefined,
        };
        currentFlowpath.heatExchangers.push(hex);
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
        if (params["H2S"] !== undefined) node.h2sMoleFraction = parseUnitValue(params["H2S"], 0.0);
        if (params["CO2"] !== undefined) node.co2MoleFraction = parseUnitValue(params["CO2"], 0.0);

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
    caseName: title,
    author,
    tableFile,
    startTime,
    endTime,
    minDt,
    maxDt,
    flowpaths,
    nodes,
    restartConfig,
    outputConfig,
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

  if (model.restartConfig) {
    const tStr = model.restartConfig.time !== undefined ? `, TIME = ${model.restartConfig.time} s` : "";
    lines.push(`RESTART FILE = "${model.restartConfig.file}"${tStr}`);
  }

  if (model.outputConfig) {
    const outParts: string[] = [];
    if (model.outputConfig.trendInterval !== undefined) outParts.push(`TREND = ${model.outputConfig.trendInterval} s`);
    if (model.outputConfig.profileInterval !== undefined)
      outParts.push(`PROFILE = ${model.outputConfig.profileInterval} s`);
    if (model.outputConfig.variables && model.outputConfig.variables.length > 0) {
      outParts.push(`VARIABLES = (${model.outputConfig.variables.join(", ")})`);
    }
    lines.push(`OUTPUT ${outParts.join(", ")}`);
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
      const metaStr = p.metallurgy ? `, METALLURGY = ${p.metallurgy}` : "";
      const cladStr = p.cladding ? `, CLADDING = ${p.cladding}` : "";
      lines.push(
        `PIPE LABEL = ${p.label}, LENGTH = ${p.length} m, DIAMETER = ${p.diameter} m, ELEVATION = ${p.elevation} m, ROUGHNESS = ${p.roughness} m, NSEGMENT = ${p.discretization}${metaStr}${cladStr}`,
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
      const h2sStr = s.h2sMoleFraction !== undefined ? `, H2S = ${s.h2sMoleFraction}` : "";
      const co2Str = s.co2MoleFraction !== undefined ? `, CO2 = ${s.co2MoleFraction}` : "";
      lines.push(
        `MASSSOURCE NAME = ${s.name}, POSITION = ${s.position} m, TOTALMASSRATE = ${s.totalMassRate} kg/s, GASFRACTION = ${s.gasMassFraction}, WATERCUT = ${s.waterCut}, TEMPERATURE = ${s.temperature} K${pStr}${h2sStr}${co2Str}`,
      );
    }

    // Controllers
    for (const c of fp.controllers) {
      lines.push(
        `CONTROLLER NAME = ${c.name}, TYPE = ${c.type}, SETPOINT = ${c.setpoint}, GAIN = ${c.gain}, TI = ${c.ti} s, TD = ${c.td} s, TRANSMITTER = "${c.transmitter}", VALVE = "${c.controlledValve}"`,
      );
    }

    // Pumps
    if (fp.pumps) {
      for (const p of fp.pumps) {
        lines.push(
          `PUMP NAME = ${p.name}, ABSPOSITION = ${p.position} m, TYPE = ${p.type}, HEAD = ${p.ratedHead} m, FLOWRATE = ${p.ratedFlowRate} m3/s, SPEED = ${p.speedRpm} rpm, POWER = ${p.ratedPowerKw} kW, GVFLIMIT = ${p.gasVoidFractionLimit}`,
        );
      }
    }

    // Compressors
    if (fp.compressors) {
      for (const c of fp.compressors) {
        lines.push(
          `COMPRESSOR NAME = ${c.name}, ABSPOSITION = ${c.position} m, TYPE = ${c.type}, PRESSRATIO = ${c.pressureRatio}, EFFICIENCY = ${c.polytropicEfficiency}, POWER = ${c.ratedPowerKw} kW, ANTISURGEMARGIN = ${c.antiSurgeMargin}`,
        );
      }
    }

    // IPR / Well
    if (fp.ipr) {
      const iprParts: string[] = [
        `WELL NAME = WELL_IPR`,
        `TYPE = ${fp.ipr.type}`,
        `PRES = ${fp.ipr.reservoirPressure / 1e5} bar`,
        `TRES = ${fp.ipr.reservoirTemperature} K`,
        `GASFRACTION = ${fp.ipr.gasMassFraction}`,
        `WATERCUT = ${fp.ipr.waterCut}`,
      ];
      if (fp.ipr.bubblePointPressure !== undefined) iprParts.push(`PBUBBLE = ${fp.ipr.bubblePointPressure / 1e5} bar`);
      if (fp.ipr.productivityIndex !== undefined) iprParts.push(`PI = ${fp.ipr.productivityIndex}`);
      if (fp.ipr.maxLiquidRate !== undefined) iprParts.push(`QMAX = ${fp.ipr.maxLiquidRate} kg/s`);
      if (fp.ipr.cFactor !== undefined) iprParts.push(`CFACTOR = ${fp.ipr.cFactor}`);
      if (fp.ipr.nExponent !== undefined) iprParts.push(`NEXPONENT = ${fp.ipr.nExponent}`);
      lines.push(iprParts.join(", "));
    }

    // Wax
    if (fp.waxConfig) {
      const waxParts: string[] = [`WAX CLOUDPOINT = ${fp.waxConfig.cloudPointTemp} K`];
      if (fp.waxConfig.molecularDiffusionCoeff !== undefined) {
        waxParts.push(`DIFFUSION = ${fp.waxConfig.molecularDiffusionCoeff}`);
      }
      if (fp.waxConfig.waxDensity !== undefined) {
        waxParts.push(`DENSITY = ${fp.waxConfig.waxDensity} kg/m3`);
      }
      lines.push(waxParts.join(", "));
    }

    // Sand
    if (fp.sandConfig) {
      const sandParts: string[] = [`SAND MASSRATE = ${fp.sandConfig.sandMassRate} kg/s`];
      if (fp.sandConfig.particleDiameter !== undefined) {
        sandParts.push(`DIAMETER = ${fp.sandConfig.particleDiameter} m`);
      }
      if (fp.sandConfig.sandDensity !== undefined) {
        sandParts.push(`DENSITY = ${fp.sandConfig.sandDensity} kg/m3`);
      }
      lines.push(sandParts.join(", "));
    }

    // Asphaltene
    if (fp.asphalteneConfig) {
      const a = fp.asphalteneConfig;
      const parts: string[] = [
        `ASPHALTENE SATURATES = ${a.sara.saturatesPercent} %`,
        `AROMATICS = ${a.sara.aromaticsPercent} %`,
        `RESINS = ${a.sara.resinsPercent} %`,
        `ASPHALTENES = ${a.sara.asphaltenesPercent} %`,
      ];
      if (a.bubblePointPressure !== undefined) {
        parts.push(`BUBBLEPOINT = ${a.bubblePointPressure} Pa`);
      }
      if (a.exposureTimeHours !== undefined) {
        parts.push(`EXPOSURETIME = ${a.exposureTimeHours} h`);
      }
      if (a.existingDepositThicknessM !== undefined) {
        parts.push(`INITIALTHICKNESS = ${a.existingDepositThicknessM} m`);
      }
      lines.push(parts.join(", "));
    }

    // Pigs
    if (fp.pigs) {
      for (const p of fp.pigs) {
        lines.push(
          `PIG NAME = ${p.name}, LAUNCHTIME = ${p.launchTime} s, MASS = ${p.mass ?? 100} kg, DIAMETER = ${p.diameter ?? 0.3} m, BYPASS = ${p.bypassFraction ?? 0.0}, FRICTION = ${p.frictionForce ?? 2500} N`,
        );
      }
    }

    // Heat Exchangers
    if (fp.heatExchangers) {
      for (const h of fp.heatExchangers) {
        const parts = [
          `HEATEXCHANGER NAME = ${h.name}`,
          `ABSPOSITION = ${h.position} m`,
          `TYPE = ${h.type || "SIMPLE"}`,
        ];
        if (h.dutyKw !== undefined) parts.push(`DUTY = ${h.dutyKw} kW`);
        if (h.targetTemperature !== undefined) parts.push(`TARGETTEMP = ${h.targetTemperature} K`);
        if (h.overallUa !== undefined) parts.push(`UA = ${h.overallUa} W/K`);
        if (h.ambientTemperature !== undefined) parts.push(`TAMB = ${h.ambientTemperature} K`);
        lines.push(parts.join(", "));
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
    if (n.h2sMoleFraction !== undefined) parts.push(`H2S = ${n.h2sMoleFraction}`);
    if (n.co2MoleFraction !== undefined) parts.push(`CO2 = ${n.co2MoleFraction}`);

    lines.push(parts.join(", "));
  }

  return lines.join("\n") + "\n";
}
