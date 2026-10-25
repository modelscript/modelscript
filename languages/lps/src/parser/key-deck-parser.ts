// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Legacy Keyword Deck Parser for PipelineStudio / TGNET / TLNET (.tgn, .tln, .psg, .psl).
 *
 * Supports keyword tokens for pipeline networks, equipment specifications,
 * gas mixtures, and batch schedules.
 */

import type {
  CompressorControlMode,
  CompressorStation,
  GasComposition,
  InlineValve,
  LpsModel,
  LpsNode,
  LpsNodeType,
  LpsPipe,
  PumpControlMode,
  PumpStation,
  RegulatorValve,
  SimulationControls,
  SimulationType,
} from "../types.js";

function parseNum(token: string | undefined, defaultVal: number): number {
  if (!token) return defaultVal;
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : defaultVal;
}

function parsePressureToken(token: string | undefined, defaultVal: number): number {
  if (!token) return defaultVal;
  const str = token.toLowerCase();
  if (str.endsWith("bar")) return parseFloat(str) * 1e5;
  if (str.endsWith("mpa")) return parseFloat(str) * 1e6;
  if (str.endsWith("kpa")) return parseFloat(str) * 1e3;
  if (str.endsWith("psi")) return parseFloat(str) * 6894.76;
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return defaultVal;
  if (n > 0 && n <= 500) return n * 1e5; // bar
  return n;
}

function parseLengthToken(token: string | undefined, defaultVal: number): number {
  if (!token) return defaultVal;
  const str = token.toLowerCase();
  if (str.endsWith("km")) return parseFloat(str) * 1000;
  if (str.endsWith("mi")) return parseFloat(str) * 1609.344;
  if (str.endsWith("m")) return parseFloat(str);
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : defaultVal;
}

function parseDiameterToken(token: string | undefined, defaultVal: number): number {
  if (!token) return defaultVal;
  const str = token.toLowerCase();
  if (str.endsWith("mm")) return parseFloat(str) / 1000;
  if (str.endsWith("in")) return parseFloat(str) * 0.0254;
  if (str.endsWith("m")) return parseFloat(str);
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return defaultVal;
  if (n >= 10 && n <= 100) return n * 0.0254;
  if (n > 100) return n / 1000;
  return n;
}

export function parseLpsKeyDeck(text: string): LpsModel {
  const lines = text.split("\n");
  let modelId = "pipeline-study";
  let title = "Pipeline Network Study";
  let simType: SimulationType = "TGNET";

  const nodes: LpsNode[] = [];
  const pipes: LpsPipe[] = [];
  const compressors: CompressorStation[] = [];
  const pumps: PumpStation[] = [];
  const regulators: RegulatorValve[] = [];
  const valves: InlineValve[] = [];
  let gasComposition: GasComposition | undefined;
  const simulationControls: SimulationControls = {
    startTime: 0,
    endTime: 86400,
    timeStep: 60,
    steadyStateFirst: true,
    equationOfState: "AGA8",
  };

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("//") || line.startsWith("!")) {
      continue;
    }

    const tokens = line.split(/\s+/);
    const cmd = tokens[0]?.toUpperCase() ?? "";

    // CASE or TITLE
    if (cmd === "CASE" || cmd === "STUDY") {
      modelId = tokens[1] ?? modelId;
      const titleMatch = line.match(/TITLE\s+["']([^"']+)["']/i);
      if (titleMatch?.[1]) title = titleMatch[1];
    } else if (cmd === "SIMULATION") {
      const mode = tokens[1]?.toUpperCase();
      if (mode === "LIQUID" || mode === "TLNET") simType = "TLNET";
      else simType = "TGNET";
    }

    // NODE <name> [TYPE <type>] [ELEVATION <z>] [PRESSURE <p>] [FLOW <q>] [MINP <minp>] [MAOP <maop>]
    else if (cmd === "NODE" || cmd === "JUNCTION" || cmd === "SUPPLY" || cmd === "DELIVERY") {
      const name = tokens[1] ?? `node_${nodes.length + 1}`;
      let type: LpsNodeType = "JUNCTION";
      if (cmd === "SUPPLY") type = "SUPPLY";
      else if (cmd === "DELIVERY") type = "DELIVERY";

      let elevation = 0;
      let pressure: number | undefined;
      let flowRate: number | undefined;
      let minDeliveryPressure: number | undefined;
      let maxAllowablePressure: number | undefined;

      for (let i = 2; i < tokens.length; i += 2) {
        const key = tokens[i]?.toUpperCase();
        const val = tokens[i + 1];
        if (!val) break;
        if (key === "TYPE") {
          const t = val.toUpperCase();
          if (t.includes("SUPPLY")) type = "SUPPLY";
          else if (t.includes("DELIVERY")) type = "DELIVERY";
          else if (t.includes("STORAGE")) type = "STORAGE_CAVERN";
          else if (t.includes("MANIFOLD")) type = "MANIFOLD";
        } else if (key === "ELEVATION" || key === "ELEV") {
          elevation = parseLengthToken(val, 0);
        } else if (key === "PRESSURE" || key === "P") {
          pressure = parsePressureToken(val, 50e5);
        } else if (key === "FLOW" || key === "Q") {
          flowRate = parseNum(val, 0);
        } else if (key === "MINP" || key === "MINDELIVERYPRESSURE") {
          minDeliveryPressure = parsePressureToken(val, 30e5);
        } else if (key === "MAOP") {
          maxAllowablePressure = parsePressureToken(val, 100e5);
        }
      }

      nodes.push({
        name,
        type,
        elevation,
        pressure,
        flowRate,
        minDeliveryPressure,
        maxAllowablePressure,
      });
    }

    // PIPE <name> FROM <from> TO <to> LENGTH <L> DIAMETER <D> [ROUGHNESS <e>] [MAOP <p>]
    else if (cmd === "PIPE" || cmd === "LINK" || cmd === "SEGMENT") {
      const name = tokens[1] ?? `pipe_${pipes.length + 1}`;
      let fromNode = "";
      let toNode = "";
      let length = 10000;
      let diameter = 0.508;
      let roughness = 0.000045;
      let maop = 100e5;
      let heatTransferCoefficient = 2.0;
      let ambientTemperature = 288.15;
      let draPpm: number | undefined;

      for (let i = 2; i < tokens.length; i += 2) {
        const key = tokens[i]?.toUpperCase();
        const val = tokens[i + 1];
        if (!val) break;
        if (key === "FROM" || key === "INLET") fromNode = val;
        else if (key === "TO" || key === "OUTLET") toNode = val;
        else if (key === "LENGTH" || key === "L") length = parseLengthToken(val, length);
        else if (key === "DIAMETER" || key === "D") diameter = parseDiameterToken(val, diameter);
        else if (key === "ROUGHNESS" || key === "E") roughness = parseNum(val, roughness);
        else if (key === "MAOP") maop = parsePressureToken(val, maop);
        else if (key === "U" || key === "HTC") heatTransferCoefficient = parseNum(val, 2.0);
        else if (key === "TAMB") ambientTemperature = parseNum(val, 288.15);
        else if (key === "DRA") draPpm = parseNum(val, 0);
      }

      pipes.push({
        name,
        fromNode,
        toNode,
        length,
        diameter,
        roughness,
        maop,
        heatTransferCoefficient,
        ambientTemperature,
        draPpm,
      });
    }

    // COMPRESSOR <name> FROM <from> TO <to> [POWER <w>] [RATIO <r>] [SETPOINT <sp>] [EFF <eff>]
    else if (cmd === "COMPRESSOR" || cmd === "COMP") {
      const name = tokens[1] ?? `comp_${compressors.length + 1}`;
      let fromNode = "";
      let toNode = "";
      let maxPower = 15e6;
      let maxPressureRatio = 2.2;
      let polytropicEfficiency = 0.82;
      let setpoint = 80e5;
      let controlMode: CompressorControlMode = "DISCHARGE_PRESSURE";

      for (let i = 2; i < tokens.length; i += 2) {
        const key = tokens[i]?.toUpperCase();
        const val = tokens[i + 1];
        if (!val) break;
        if (key === "FROM") fromNode = val;
        else if (key === "TO") toNode = val;
        else if (key === "POWER") maxPower = parseNum(val, 15e6);
        else if (key === "RATIO") maxPressureRatio = parseNum(val, 2.2);
        else if (key === "EFF") polytropicEfficiency = parseNum(val, 0.82);
        else if (key === "SETPOINT" || key === "SP") setpoint = parsePressureToken(val, 80e5);
        else if (key === "MODE") controlMode = val.toUpperCase() as CompressorControlMode;
      }

      compressors.push({
        name,
        fromNode,
        toNode,
        type: "CENTRIFUGAL",
        maxPower,
        maxPressureRatio,
        polytropicEfficiency,
        status: "RUNNING",
        controlMode,
        setpoint,
      });
    }

    // PUMP <name> FROM <from> TO <to> [POWER <w>] [HEAD <h>] [SETPOINT <sp>]
    else if (cmd === "PUMP") {
      const name = tokens[1] ?? `pump_${pumps.length + 1}`;
      let fromNode = "";
      let toNode = "";
      let maxPower = 5e6;
      let ratedHead = 300;
      let ratedFlow = 0.5;
      let npshRequired = 4.5;
      let efficiency = 0.8;
      let setpoint = 60e5;
      let controlMode: PumpControlMode = "DISCHARGE_PRESSURE";

      for (let i = 2; i < tokens.length; i += 2) {
        const key = tokens[i]?.toUpperCase();
        const val = tokens[i + 1];
        if (!val) break;
        if (key === "FROM") fromNode = val;
        else if (key === "TO") toNode = val;
        else if (key === "POWER") maxPower = parseNum(val, 5e6);
        else if (key === "HEAD") ratedHead = parseNum(val, 300);
        else if (key === "FLOW") ratedFlow = parseNum(val, 0.5);
        else if (key === "NPSHR") npshRequired = parseNum(val, 4.5);
        else if (key === "EFF") efficiency = parseNum(val, 0.8);
        else if (key === "SETPOINT") setpoint = parsePressureToken(val, 60e5);
        else if (key === "MODE") controlMode = val.toUpperCase() as PumpControlMode;
      }

      pumps.push({
        name,
        fromNode,
        toNode,
        maxPower,
        ratedFlow,
        ratedHead,
        npshRequired,
        efficiency,
        status: "RUNNING",
        controlMode,
        setpoint,
      });
    }

    // REGULATOR <name> FROM <from> TO <to> SETPOINT <p> [CAPACITY <cap>] [PREHEATER <yes/no>]
    else if (cmd === "REGULATOR" || cmd === "PRV") {
      const name = tokens[1] ?? `reg_${regulators.length + 1}`;
      let fromNode = "";
      let toNode = "";
      let setpointPressure = 40e5;
      let maxCapacity = 100.0;
      let preheaterInstalled = false;

      for (let i = 2; i < tokens.length; i += 2) {
        const key = tokens[i]?.toUpperCase();
        const val = tokens[i + 1];
        if (!val) break;
        if (key === "FROM") fromNode = val;
        else if (key === "TO") toNode = val;
        else if (key === "SETPOINT" || key === "P") setpointPressure = parsePressureToken(val, 40e5);
        else if (key === "CAPACITY" || key === "CAP") maxCapacity = parseNum(val, 100);
        else if (key === "PREHEATER") preheaterInstalled = val.toUpperCase() === "YES" || val.toUpperCase() === "TRUE";
      }

      regulators.push({
        name,
        fromNode,
        toNode,
        setpointPressure,
        maxCapacity,
        preheaterInstalled,
      });
    }

    // VALVE <name> FROM <from> TO <to> [OPENING <0..1>] [CLOSINGTIME <sec>]
    else if (cmd === "VALVE") {
      const name = tokens[1] ?? `valve_${valves.length + 1}`;
      let fromNode = "";
      let toNode = "";
      let opening = 1.0;
      let closingTimeSeconds = 15.0;

      for (let i = 2; i < tokens.length; i += 2) {
        const key = tokens[i]?.toUpperCase();
        const val = tokens[i + 1];
        if (!val) break;
        if (key === "FROM") fromNode = val;
        else if (key === "TO") toNode = val;
        else if (key === "OPENING" || key === "POS") opening = parseNum(val, 1.0);
        else if (key === "CLOSINGTIME" || key === "TIME") closingTimeSeconds = parseNum(val, 15.0);
      }

      valves.push({
        name,
        fromNode,
        toNode,
        opening,
        closingTimeSeconds,
      });
    }

    // COMPOSITION CH4 <val> C2H6 <val> ... H2 <val>
    else if (cmd === "COMPOSITION" || cmd === "GAS") {
      gasComposition = {
        methane: 0.9,
        ethane: 0.05,
        propane: 0.02,
        nButane: 0.005,
        iButane: 0.005,
        pentanes: 0.002,
        hexanePlus: 0.001,
        nitrogen: 0.012,
        carbonDioxide: 0.005,
        hydrogen: 0.0,
      };

      for (let i = 1; i < tokens.length; i += 2) {
        const key = tokens[i]?.toUpperCase();
        const val = tokens[i + 1];
        if (!val) break;
        const fraction = parseNum(val, 0);
        if (key === "CH4" || key === "METHANE") gasComposition.methane = fraction;
        else if (key === "C2H6" || key === "ETHANE") gasComposition.ethane = fraction;
        else if (key === "C3H8" || key === "PROPANE") gasComposition.propane = fraction;
        else if (key === "CO2") gasComposition.carbonDioxide = fraction;
        else if (key === "N2") gasComposition.nitrogen = fraction;
        else if (key === "H2" || key === "HYDROGEN") gasComposition.hydrogen = fraction;
      }
    }

    // INTEGRATION START <t0> END <t1> DT <dt> [EOS <eos>]
    else if (cmd === "INTEGRATION" || cmd === "SIMULATE") {
      for (let i = 1; i < tokens.length; i += 2) {
        const key = tokens[i]?.toUpperCase();
        const val = tokens[i + 1];
        if (!val) break;
        if (key === "START") simulationControls.startTime = parseNum(val, 0);
        else if (key === "END") simulationControls.endTime = parseNum(val, 86400);
        else if (key === "DT") simulationControls.timeStep = parseNum(val, 60);
        else if (key === "EOS") simulationControls.equationOfState = val.toUpperCase() as any;
      }
    }
  }

  return {
    id: modelId,
    title,
    type: simType,
    nodes,
    pipes,
    compressors,
    pumps,
    regulators,
    valves,
    gasComposition,
    simulationControls,
  };
}
