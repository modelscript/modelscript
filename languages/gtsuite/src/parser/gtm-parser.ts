// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  GtComponent,
  GtConnection,
  GtCylinderComponent,
  GtEnvironmentComponent,
  GtInjectorComponent,
  GtIntercoolerComponent,
  GtModel,
  GtPipeComponent,
  GtPlenumComponent,
  GtSimulationSettings,
  GtTableMap,
  GtTurboCompressorComponent,
  GtTurboTurbineComponent,
  GtValveComponent,
} from "../types.js";
import { parseGtTableMap } from "./map-parser.js";

/**
 * Parses GT-SUITE (.gtm, .gtd, .xml, .gtx) text content into a typed GtModel AST.
 * Handles both GT-SUITE XML project exports and concise ASCII engine model decks.
 */
export function parseGtmModel(rawText: string, defaultName = "EngineModel"): GtModel {
  const trimmed = rawText.trim();
  if (
    trimmed.startsWith("<") &&
    (trimmed.includes("<GTModel") || trimmed.includes("<Model") || trimmed.includes("<GTSUITE"))
  ) {
    return parseXmlGtm(trimmed, defaultName);
  }
  return parseAsciiGtm(trimmed, defaultName);
}

/**
 * XML parser for GT-SUITE model project documents.
 */
function parseXmlGtm(xmlText: string, defaultName: string): GtModel {
  // Simple robust regex-based XML extraction without heavy dependencies
  const modelNameMatch = xmlText.match(/<(?:\w+:)?(?:GTModel|Model|GTSUITE)\b[^<>]*?\bname=["']([^"']+)["']/i);
  const name = modelNameMatch?.[1] ?? defaultName;

  const simSettings: GtSimulationSettings = {
    durationSeconds: extractXmlAttrNumber(xmlText, "duration", 5.0),
    timeStepSeconds: extractXmlAttrNumber(xmlText, "timeStep", 0.0001),
    engineSpeedRpm: extractXmlAttrNumber(xmlText, "engineSpeed", 3000.0),
    ambientPressurePa: extractXmlAttrNumber(xmlText, "ambientPressure", 101325.0),
    ambientTemperatureK: extractXmlAttrNumber(xmlText, "ambientTemperature", 298.15),
    airFuelRatioLambda: extractXmlAttrNumber(xmlText, "lambda", 1.0),
  };

  const components: GtComponent[] = [];
  const connections: GtConnection[] = [];
  const maps: Record<string, GtTableMap> = {};

  // Extract <Component ...> blocks
  const compRegex = /<Component\s+([^\s<>][^<>]*?)(?:\/>|>([\s\S]*?)<\/Component>)/gi;
  let compMatch: RegExpExecArray | null;

  while ((compMatch = compRegex.exec(xmlText)) !== null) {
    const attrsStr = compMatch[1] ?? "";
    const bodyStr = compMatch[2] ?? "";
    const id = extractAttr(attrsStr, "id") ?? `comp_${components.length + 1}`;
    const kind = (extractAttr(attrsStr, "kind") ?? extractAttr(attrsStr, "type") ?? "pipe").toLowerCase();

    if (kind === "cylinder") {
      const boreM = extractAttrNumber(attrsStr, "bore", 0.0825);
      const strokeM = extractAttrNumber(attrsStr, "stroke", 0.0928);
      const rodM = extractAttrNumber(attrsStr, "rodLength", 0.144);
      const cr = extractAttrNumber(attrsStr, "compressionRatio", 10.0);
      const disp = (Math.PI / 4) * boreM * boreM * strokeM;

      // Extract child combustion block
      const anchor = extractXmlAttrNumber(bodyStr, "anchorAngle", 15.0);
      const duration = extractXmlAttrNumber(bodyStr, "duration", 40.0);
      const exponent = extractXmlAttrNumber(bodyStr, "exponent", 2.0);
      const wallTemp = extractXmlAttrNumber(bodyStr, "wallTemperature", 450.0);

      components.push({
        id,
        kind: "cylinder",
        boreM,
        strokeM,
        connectingRodLengthM: rodM,
        compressionRatio: cr,
        clearanceVolumeM3: disp / (cr - 1),
        displacementM3: disp,
        combustionModel: {
          type: "wiebe",
          anchorAngleDeg: anchor,
          durationDeg: duration,
          wiebeExponentM: exponent,
          wiebeEfficiencyA: 5.0,
        },
        heatTransferModel: {
          type: "woschni",
          wallTemperatureK: wallTemp,
        },
        intakeValveIds: [],
        exhaustValveIds: [],
      } as GtCylinderComponent);
    } else if (kind === "pipe" || kind === "intake_runner" || kind === "exhaust_runner") {
      components.push({
        id,
        kind: kind as GtPipeComponent["kind"],
        diameterM: extractAttrNumber(attrsStr, "diameter", 0.045),
        lengthM: extractAttrNumber(attrsStr, "length", 0.35),
        wallTemperatureK: extractAttrNumber(attrsStr, "wallTemperature", 350.0),
        frictionFactor: extractAttrNumber(attrsStr, "friction", 0.005),
        numCells: extractAttrNumber(attrsStr, "numCells", 10),
      } as GtPipeComponent);
    } else if (kind === "plenum" || kind === "flow_split") {
      components.push({
        id,
        kind: kind as GtPlenumComponent["kind"],
        volumeM3: extractAttrNumber(attrsStr, "volume", 0.004),
        initialPressurePa: extractAttrNumber(attrsStr, "initialPressure", 101325.0),
        initialTemperatureK: extractAttrNumber(attrsStr, "initialTemperature", 300.0),
      } as GtPlenumComponent);
    } else if (kind === "turbo_compressor") {
      components.push({
        id,
        kind: "turbo_compressor",
        pressureRatio: extractAttrNumber(attrsStr, "pressureRatio", 2.0),
        massFlowKgS: extractAttrNumber(attrsStr, "massFlow", 0.15),
        speedRpm: extractAttrNumber(attrsStr, "speedRpm", 120000.0),
        efficiency: extractAttrNumber(attrsStr, "efficiency", 0.76),
      } as GtTurboCompressorComponent);
    } else if (kind === "turbo_turbine") {
      components.push({
        id,
        kind: "turbo_turbine",
        expansionRatio: extractAttrNumber(attrsStr, "expansionRatio", 1.8),
        efficiency: extractAttrNumber(attrsStr, "efficiency", 0.72),
        wastegateFraction: extractAttrNumber(attrsStr, "wastegate", 0.0),
      } as GtTurboTurbineComponent);
    } else if (kind === "intercooler") {
      components.push({
        id,
        kind: "intercooler",
        volumeM3: extractAttrNumber(attrsStr, "volume", 0.005),
        pressureDropCoefficient: extractAttrNumber(attrsStr, "pressureDrop", 0.05),
        effectiveness: extractAttrNumber(attrsStr, "effectiveness", 0.85),
        coolantTemperatureK: extractAttrNumber(attrsStr, "coolantTemp", 300.0),
      } as GtIntercoolerComponent);
    } else if (kind === "environment_inlet" || kind === "environment_outlet") {
      components.push({
        id,
        kind: kind as GtEnvironmentComponent["kind"],
        pressurePa: extractAttrNumber(attrsStr, "pressure", 101325.0),
        temperatureK: extractAttrNumber(attrsStr, "temperature", 298.15),
      } as GtEnvironmentComponent);
    } else if (kind === "valve") {
      components.push({
        id,
        kind: "valve",
        diameterM: extractAttrNumber(attrsStr, "diameter", 0.034),
        maxLiftM: extractAttrNumber(attrsStr, "maxLift", 0.01),
        dischargeCoefficient: extractAttrNumber(attrsStr, "cd", 0.65),
        lashClearanceM: extractAttrNumber(attrsStr, "lash", 0.0002),
        openAngleDeg: extractAttrNumber(attrsStr, "openAngle", 350.0),
        closeAngleDeg: extractAttrNumber(attrsStr, "closeAngle", 580.0),
      } as GtValveComponent);
    }
  }

  // Extract <Connection from="..." to="..." />
  const connRegex = /<Connection\s+([^\s<>][^<>]*?)\/>/gi;
  let connMatch: RegExpExecArray | null;
  while ((connMatch = connRegex.exec(xmlText)) !== null) {
    const attrs = connMatch[1] ?? "";
    const from = extractAttr(attrs, "from") ?? "";
    const to = extractAttr(attrs, "to") ?? "";
    const fromPort = extractAttr(attrs, "fromPort") ?? "out";
    const toPort = extractAttr(attrs, "toPort") ?? "in";
    if (from && to) {
      connections.push({ fromComponent: from, fromPort, toComponent: to, toPort });
    }
  }

  return {
    name,
    attributes: {},
    components,
    connections,
    maps,
    simulationSettings: simSettings,
  };
}

/**
 * Concise ASCII parser for GT-SUITE engine model decks (.gtm, .gtd, .inp).
 */
function parseAsciiGtm(text: string, defaultName: string): GtModel {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("//"));

  let name = defaultName;
  const simSettings: GtSimulationSettings = {
    durationSeconds: 5.0,
    timeStepSeconds: 0.0001,
    engineSpeedRpm: 3000.0,
    ambientPressurePa: 101325.0,
    ambientTemperatureK: 298.15,
    airFuelRatioLambda: 1.0,
  };

  const components: GtComponent[] = [];
  const connections: GtConnection[] = [];
  const maps: Record<string, GtTableMap> = {};

  let currentSection = "HEADER";
  let mapBlockLines: string[] = [];
  let mapBlockId = "";

  for (const line of lines) {
    // Check section transitions
    if (line.toUpperCase().startsWith("COMPONENTS:") || line.toUpperCase() === "COMPONENTS") {
      currentSection = "COMPONENTS";
      continue;
    }
    if (line.toUpperCase().startsWith("CONNECTIONS:") || line.toUpperCase() === "CONNECTIONS") {
      currentSection = "CONNECTIONS";
      continue;
    }
    if (line.toUpperCase().startsWith("MAP:") || line.toUpperCase().startsWith("TABLE:")) {
      currentSection = "MAP";
      mapBlockId = line.split(":")[1]?.trim() ?? "map1";
      mapBlockLines = [];
      continue;
    }
    if (currentSection === "MAP" && (line.toUpperCase().startsWith("ENDMAP") || line.toUpperCase().startsWith("END"))) {
      maps[mapBlockId] = parseGtTableMap(mapBlockLines.join("\n"), mapBlockId);
      currentSection = "COMPONENTS";
      continue;
    }

    if (currentSection === "MAP") {
      mapBlockLines.push(line);
      continue;
    }

    if (currentSection === "HEADER") {
      if (line.toUpperCase().startsWith("MODEL:") || line.toUpperCase().startsWith("NAME:")) {
        name = line.split(":")[1]?.trim() ?? name;
      } else if (line.toUpperCase().startsWith("SPEED:")) {
        simSettings.engineSpeedRpm = Number(line.split(":")[1]?.trim()) || 3000.0;
      } else if (line.toUpperCase().startsWith("DURATION:")) {
        simSettings.durationSeconds = Number(line.split(":")[1]?.trim()) || 5.0;
      } else if (line.toUpperCase().startsWith("LAMBDA:")) {
        simSettings.airFuelRatioLambda = Number(line.split(":")[1]?.trim()) || 1.0;
      }
      continue;
    }

    if (currentSection === "COMPONENTS") {
      // Format: ID = KIND (ATTR1 = VAL1, ATTR2 = VAL2, ...)
      const eqIdx = line.indexOf("=");
      if (eqIdx < 0) continue;
      const id = line.substring(0, eqIdx).trim();
      const rest = line.substring(eqIdx + 1).trim();

      const openParen = rest.indexOf("(");
      const kind = (openParen >= 0 ? rest.substring(0, openParen) : rest).trim().toLowerCase();
      const attrStr = openParen >= 0 && rest.endsWith(")") ? rest.substring(openParen + 1, rest.length - 1) : "";

      const kv = parseKvPairs(attrStr);

      if (kind === "cylinder") {
        const bore = kv["bore"] ?? kv["b"] ?? 0.0825;
        const stroke = kv["stroke"] ?? kv["s"] ?? 0.0928;
        const rod = kv["rod"] ?? kv["l_rod"] ?? 0.144;
        const cr = kv["cr"] ?? kv["compression_ratio"] ?? 10.0;
        const disp = (Math.PI / 4) * bore * bore * stroke;

        components.push({
          id,
          kind: "cylinder",
          boreM: bore,
          strokeM: stroke,
          connectingRodLengthM: rod,
          compressionRatio: cr,
          clearanceVolumeM3: disp / (cr - 1),
          displacementM3: disp,
          combustionModel: {
            type: (kv["combustion"] as any) ?? "wiebe",
            anchorAngleDeg: kv["anchor"] ?? kv["soi"] ?? 15.0,
            durationDeg: kv["duration"] ?? kv["burn_duration"] ?? 45.0,
            wiebeExponentM: kv["m"] ?? 2.0,
            wiebeEfficiencyA: kv["a"] ?? 5.0,
          },
          heatTransferModel: {
            type: "woschni",
            wallTemperatureK: kv["t_wall"] ?? 450.0,
          },
          intakeValveIds: [],
          exhaustValveIds: [],
        } as GtCylinderComponent);
      } else if (kind === "pipe" || kind === "intake_runner" || kind === "exhaust_runner") {
        components.push({
          id,
          kind: kind as GtPipeComponent["kind"],
          diameterM: kv["d"] ?? kv["diameter"] ?? 0.045,
          lengthM: kv["l"] ?? kv["length"] ?? 0.35,
          wallTemperatureK: kv["t_wall"] ?? kv["t"] ?? 350.0,
          frictionFactor: kv["f"] ?? 0.005,
          numCells: kv["cells"] ?? 10,
        } as GtPipeComponent);
      } else if (kind === "plenum" || kind === "flow_split") {
        components.push({
          id,
          kind: kind as GtPlenumComponent["kind"],
          volumeM3: kv["vol"] ?? kv["volume"] ?? 0.004,
          initialPressurePa: kv["p"] ?? kv["pressure"] ?? 101325.0,
          initialTemperatureK: kv["t"] ?? kv["temperature"] ?? 300.0,
        } as GtPlenumComponent);
      } else if (kind === "turbo_compressor") {
        components.push({
          id,
          kind: "turbo_compressor",
          pressureRatio: kv["pr"] ?? kv["pressure_ratio"] ?? 2.0,
          massFlowKgS: kv["mass_flow"] ?? kv["mdot"] ?? 0.15,
          speedRpm: kv["speed"] ?? 120000.0,
          efficiency: kv["eff"] ?? 0.76,
        } as GtTurboCompressorComponent);
      } else if (kind === "turbo_turbine") {
        components.push({
          id,
          kind: "turbo_turbine",
          expansionRatio: kv["er"] ?? kv["expansion_ratio"] ?? 1.8,
          efficiency: kv["eff"] ?? 0.72,
          wastegateFraction: kv["wastegate"] ?? 0.0,
        } as GtTurboTurbineComponent);
      } else if (kind === "intercooler") {
        components.push({
          id,
          kind: "intercooler",
          volumeM3: kv["vol"] ?? 0.005,
          pressureDropCoefficient: kv["dp"] ?? 0.05,
          effectiveness: kv["eff"] ?? 0.85,
          coolantTemperatureK: kv["t_cool"] ?? 300.0,
        } as GtIntercoolerComponent);
      } else if (kind === "environment_inlet" || kind === "environment_outlet") {
        components.push({
          id,
          kind: kind as GtEnvironmentComponent["kind"],
          pressurePa: kv["p"] ?? 101325.0,
          temperatureK: kv["t"] ?? 298.15,
        } as GtEnvironmentComponent);
      } else if (kind === "valve") {
        components.push({
          id,
          kind: "valve",
          diameterM: kv["d"] ?? 0.034,
          maxLiftM: kv["lift"] ?? 0.01,
          dischargeCoefficient: kv["cd"] ?? 0.65,
          lashClearanceM: kv["lash"] ?? 0.0002,
          openAngleDeg: kv["open"] ?? 350.0,
          closeAngleDeg: kv["close"] ?? 580.0,
        } as GtValveComponent);
      } else if (kind === "injector") {
        components.push({
          id,
          kind: "injector",
          fuelType: "Gasoline",
          massPerStrokeKg: kv["mass"] ?? 0.00003,
          startOfInjectionDeg: kv["soi"] ?? -30.0,
          durationOfInjectionDeg: kv["doi"] ?? 25.0,
        } as GtInjectorComponent);
      }
      continue;
    }

    if (currentSection === "CONNECTIONS") {
      // Format: FROM.port -> TO.port
      const parts = line.split(/->|=>|TO/i).map((s) => s.trim());
      if (parts.length === 2) {
        const fromStr = parts[0]!;
        const toStr = parts[1]!;
        const [fromComp, fromPort = "out"] = fromStr.split(".");
        const [toComp, toPort = "in"] = toStr.split(".");
        if (fromComp && toComp) {
          connections.push({
            fromComponent: fromComp,
            fromPort,
            toComponent: toComp,
            toPort,
          });
        }
      }
    }
  }

  return {
    name,
    attributes: {},
    components,
    connections,
    maps,
    simulationSettings: simSettings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseKvPairs(str: string): Record<string, number> {
  const res: Record<string, number> = {};
  if (!str) return res;
  const items = str.split(/[,;]/);
  for (const item of items) {
    const [k, v] = item.split("=").map((s) => s.trim().toLowerCase());
    if (k && v !== undefined) {
      const num = Number(v);
      if (!Number.isNaN(num)) {
        res[k] = num;
      }
    }
  }
  return res;
}

function extractAttr(attrsStr: string, attrName: string): string | undefined {
  const match = attrsStr.match(new RegExp(`${attrName}=["']([^"']+)["']`, "i"));
  return match?.[1];
}

function extractAttrNumber(attrsStr: string, attrName: string, defaultVal: number): number {
  const val = extractAttr(attrsStr, attrName);
  if (val === undefined) return defaultVal;
  const num = Number(val);
  return Number.isNaN(num) ? defaultVal : num;
}

function extractXmlAttrNumber(xmlStr: string, attrName: string, defaultVal: number): number {
  const match = xmlStr.match(new RegExp(`${attrName}=["']([^"']+)["']`, "i"));
  if (!match?.[1]) return defaultVal;
  const num = Number(match[1]);
  return Number.isNaN(num) ? defaultVal : num;
}
