// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — High-Performance XML Parser for PipelineStudio Project Files (.lps, .tgx, .tlx).
 *
 * Ingests network topology, component geometry, machinery maps, gas composition,
 * liquid batch schedules, and simulation controls using @modelscript/dsl/xml.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  BatchInjection,
  BatchSchedule,
  CompressorControlMode,
  CompressorStation,
  CompressorType,
  ElevationPoint,
  GasComposition,
  InlineValve,
  LiquidProduct,
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

function getAttr(el: XmlElement | null | undefined, name: string): string | undefined {
  if (!el) return undefined;
  const lower = name.toLowerCase();
  for (const a of el.attributes) {
    if (a.name.toLowerCase() === lower) {
      return a.value;
    }
  }
  return undefined;
}

function parseNum(val: string | undefined, defaultVal: number): number {
  if (val == null || val.trim() === "") return defaultVal;
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

/** Parses pressures with units (bar, psi, kPa, MPa, Pa). Standard internal unit is Pa. */
function parsePressure(val: string | undefined, defaultVal: number): number {
  if (val == null || val.trim() === "") return defaultVal;
  const str = val.trim().toLowerCase();
  if (str.endsWith("bar")) return parseFloat(str) * 1e5;
  if (str.endsWith("mpa")) return parseFloat(str) * 1e6;
  if (str.endsWith("kpa")) return parseFloat(str) * 1e3;
  if (str.endsWith("psi") || str.endsWith("psig")) return parseFloat(str) * 6894.76;
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return defaultVal;
  // If user supplies small numbers like 50.0 without units, typically indicates bar in pipeline engineering
  if (n > 0 && n <= 500) return n * 1e5;
  return n;
}

/** Parses length in meters, km, miles, or feet. */
function parseLength(val: string | undefined, defaultVal: number): number {
  if (val == null || val.trim() === "") return defaultVal;
  const str = val.trim().toLowerCase();
  if (str.endsWith("km")) return parseFloat(str) * 1000;
  if (str.endsWith("mi") || str.endsWith("miles")) return parseFloat(str) * 1609.344;
  if (str.endsWith("ft") || str.endsWith("feet")) return parseFloat(str) * 0.3048;
  if (str.endsWith("m")) return parseFloat(str);
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : defaultVal;
}

/** Parses pipe diameter in meters, mm, or inches. */
function parseDiameter(val: string | undefined, defaultVal: number): number {
  if (val == null || val.trim() === "") return defaultVal;
  const str = val.trim().toLowerCase();
  if (str.endsWith("mm")) return parseFloat(str) / 1000;
  if (str.endsWith("in") || str.endsWith("inch") || str.endsWith('"')) return parseFloat(str) * 0.0254;
  if (str.endsWith("m")) return parseFloat(str);
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return defaultVal;
  if (n >= 10 && n <= 100) return n * 0.0254; // likely inches
  if (n > 100) return n / 1000; // likely mm
  return n;
}

/** Parses pipe roughness in meters. */
function parseRoughness(val: string | undefined, defaultVal: number): number {
  if (val == null || val.trim() === "") return defaultVal;
  const str = val.trim().toLowerCase();
  if (str.endsWith("mm")) return parseFloat(str) / 1000;
  if (str.endsWith("um") || str.endsWith("µm")) return parseFloat(str) * 1e-6;
  if (str.endsWith("in")) return parseFloat(str) * 0.0254;
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : defaultVal;
}

/** Parses temperature in Kelvin or Celsius. */
function parseTemp(val: string | undefined, defaultVal: number): number {
  if (val == null || val.trim() === "") return defaultVal;
  const str = val.trim().toLowerCase();
  if (str.endsWith("c") || str.endsWith("°c")) return parseFloat(str) + 273.15;
  if (str.endsWith("k")) return parseFloat(str);
  if (str.endsWith("f") || str.endsWith("°f")) return ((parseFloat(str) - 32) * 5) / 9 + 273.15;
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return defaultVal;
  if (n < 150) return n + 273.15; // Celsius
  return n;
}

function findElements(node: XmlElement | null | undefined, tagNames: string[]): XmlElement[] {
  if (!node) return [];
  const result: XmlElement[] = [];
  const lowerTags = tagNames.map((t) => t.toLowerCase());

  function walk(n: XmlElement) {
    if (lowerTags.includes(n.name.toLowerCase())) {
      result.push(n);
    }
    for (const child of n.children) {
      walk(child);
    }
  }

  walk(node);
  return result;
}

export function parseLpsXml(xmlText: string): LpsModel {
  const doc = parseXml(xmlText);

  // Extract root and study metadata
  const root = doc.root;
  const rootTag = root?.name.toLowerCase() ?? "pipelinestudio";
  let simType: SimulationType = "TGNET";
  if (rootTag.includes("tlnet") || rootTag.includes("liquid")) {
    simType = "TLNET";
  } else if (getAttr(root, "simulationType")?.toUpperCase() === "TLNET") {
    simType = "TLNET";
  }

  const headerEl = root ? findElements(root, ["studyheader", "header"])[0] : undefined;
  const modelId =
    getAttr(root, "id") ??
    getAttr(root, "name") ??
    getAttr(headerEl, "id") ??
    getAttr(headerEl, "name") ??
    "pipeline-study";
  const modelTitle =
    getAttr(root, "title") ??
    getAttr(root, "description") ??
    getAttr(headerEl, "title") ??
    getAttr(headerEl, "description") ??
    modelId;

  // 1. Extract Nodes
  const nodes: LpsNode[] = [];
  const nodeElements = findElements(root, ["node", "junction", "supply", "delivery", "storage", "cavern", "manifold"]);
  for (const el of nodeElements) {
    const name = getAttr(el, "name") ?? getAttr(el, "id") ?? `node_${nodes.length + 1}`;
    const rawType = (getAttr(el, "type") ?? el.name).toUpperCase();
    let type: LpsNodeType = "JUNCTION";
    if (rawType.includes("SUPPLY") || rawType.includes("SOURCE") || rawType.includes("WELL")) type = "SUPPLY";
    else if (rawType.includes("DELIVERY") || rawType.includes("SINK") || rawType.includes("CITYGATE"))
      type = "DELIVERY";
    else if (rawType.includes("STORAGE") || rawType.includes("CAVERN")) type = "STORAGE_CAVERN";
    else if (rawType.includes("MANIFOLD")) type = "MANIFOLD";

    const elevation = parseLength(getAttr(el, "elevation"), 0.0);
    const pressure = getAttr(el, "pressure") != null ? parsePressure(getAttr(el, "pressure"), 50e5) : undefined;
    const flowRate = getAttr(el, "flow") != null ? parseNum(getAttr(el, "flow"), 0.0) : undefined;
    const temperature = getAttr(el, "temperature") != null ? parseTemp(getAttr(el, "temperature"), 288.15) : undefined;
    const minDeliveryPressure =
      getAttr(el, "minDeliveryPressure") != null ? parsePressure(getAttr(el, "minDeliveryPressure"), 30e5) : undefined;
    const maxAllowablePressure = getAttr(el, "maop") != null ? parsePressure(getAttr(el, "maop"), 100e5) : undefined;

    const xCoord = getAttr(el, "x");
    const yCoord = getAttr(el, "y");
    const coordinates =
      xCoord != null && yCoord != null
        ? {
            x: parseNum(xCoord, 0),
            y: parseNum(yCoord, 0),
            lat: parseNum(getAttr(el, "lat"), 0),
            lon: parseNum(getAttr(el, "lon"), 0),
          }
        : undefined;

    nodes.push({
      name,
      type,
      elevation,
      pressure,
      flowRate,
      temperature,
      minDeliveryPressure,
      maxAllowablePressure,
      coordinates,
    });
  }

  // 2. Extract Pipes
  const pipes: LpsPipe[] = [];
  const pipeElements = findElements(root, ["pipe", "link", "segment", "line"]);
  for (const el of pipeElements) {
    const name = getAttr(el, "name") ?? getAttr(el, "id") ?? `pipe_${pipes.length + 1}`;
    const fromNode = getAttr(el, "from") ?? getAttr(el, "fromNode") ?? getAttr(el, "inlet") ?? "";
    const toNode = getAttr(el, "to") ?? getAttr(el, "toNode") ?? getAttr(el, "outlet") ?? "";
    const length = parseLength(getAttr(el, "length"), 10000); // 10 km default
    const diameter = parseDiameter(getAttr(el, "diameter"), 0.508); // 20 inch default
    const wallThickness =
      getAttr(el, "wallThickness") != null ? parseDiameter(getAttr(el, "wallThickness"), 0.0127) : undefined;
    const roughness = parseRoughness(getAttr(el, "roughness"), 0.000045); // commercial steel
    const maop = parsePressure(getAttr(el, "maop"), 100e5); // 100 bar default
    const heatTransferCoefficient = parseNum(getAttr(el, "heatTransferCoefficient") ?? getAttr(el, "u"), 2.0);
    const ambientTemperature = parseTemp(getAttr(el, "ambientTemperature") ?? getAttr(el, "t_amb"), 288.15);
    const draPpm = getAttr(el, "dra") != null ? parseNum(getAttr(el, "dra"), 0.0) : undefined;

    // Optional internal elevation points
    const profileElements = findElements(el, ["profile", "point", "elevationPoint"]);
    let elevationProfile: ElevationPoint[] | undefined;
    if (profileElements.length > 0) {
      elevationProfile = profileElements.map((p) => ({
        distance: parseLength(getAttr(p, "distance") ?? getAttr(p, "x"), 0),
        elevation: parseLength(getAttr(p, "elevation") ?? getAttr(p, "z"), 0),
      }));
    }

    pipes.push({
      name,
      fromNode,
      toNode,
      length,
      diameter,
      wallThickness,
      roughness,
      maop,
      heatTransferCoefficient,
      ambientTemperature,
      elevationProfile,
      draPpm,
    });
  }

  // 3. Extract Compressor Stations
  const compressors: CompressorStation[] = [];
  const compElements = findElements(root, ["compressor", "compressorstation"]);
  for (const el of compElements) {
    const name = getAttr(el, "name") ?? getAttr(el, "id") ?? `comp_${compressors.length + 1}`;
    const fromNode = getAttr(el, "from") ?? getAttr(el, "suction") ?? "";
    const toNode = getAttr(el, "to") ?? getAttr(el, "discharge") ?? "";
    const type: CompressorType =
      getAttr(el, "type")?.toUpperCase() === "RECIPROCATING" ? "RECIPROCATING" : "CENTRIFUGAL";
    const maxPower = parseNum(getAttr(el, "maxPower") ?? getAttr(el, "power"), 15e6); // 15 MW default
    const maxSpeed = parseNum(getAttr(el, "speed"), 6000);
    const maxPressureRatio = parseNum(getAttr(el, "maxPressureRatio") ?? getAttr(el, "maxRatio"), 2.2);
    const surgeFlow = parseNum(getAttr(el, "surgeFlow"), 10.0);
    const stonewallFlow = parseNum(getAttr(el, "stonewallFlow"), 150.0);
    const polytropicEfficiency = parseNum(getAttr(el, "efficiency"), 0.82);
    const driverEfficiency = parseNum(getAttr(el, "driverEfficiency"), 0.38);
    const fuelGasFraction = parseNum(getAttr(el, "fuelGasFraction"), 0.005);
    const status =
      getAttr(el, "status")?.toUpperCase() === "STOPPED" || getAttr(el, "status")?.toUpperCase() === "BYPASSED"
        ? (getAttr(el, "status")!.toUpperCase() as any)
        : "RUNNING";
    const controlMode: CompressorControlMode =
      (getAttr(el, "controlMode")?.toUpperCase() as CompressorControlMode) ?? "DISCHARGE_PRESSURE";
    const setpoint = parsePressure(getAttr(el, "setpoint"), 80e5);

    compressors.push({
      name,
      fromNode,
      toNode,
      type,
      maxPower,
      maxSpeed,
      maxPressureRatio,
      surgeFlow,
      stonewallFlow,
      polytropicEfficiency,
      driverEfficiency,
      fuelGasFraction,
      status,
      controlMode,
      setpoint,
    });
  }

  // 4. Extract Pump Stations (TLNET)
  const pumps: PumpStation[] = [];
  const pumpElements = findElements(root, ["pump", "pumpstation"]);
  for (const el of pumpElements) {
    const name = getAttr(el, "name") ?? getAttr(el, "id") ?? `pump_${pumps.length + 1}`;
    const fromNode = getAttr(el, "from") ?? getAttr(el, "suction") ?? "";
    const toNode = getAttr(el, "to") ?? getAttr(el, "discharge") ?? "";
    const maxPower = parseNum(getAttr(el, "power"), 5e6); // 5 MW
    const ratedFlow = parseNum(getAttr(el, "ratedFlow"), 0.5); // m3/s
    const ratedHead = parseNum(getAttr(el, "ratedHead"), 300); // 300 meters head
    const npshRequired = parseNum(getAttr(el, "npshRequired") ?? getAttr(el, "npshr"), 4.5); // 4.5 meters
    const efficiency = parseNum(getAttr(el, "efficiency"), 0.8);
    const status =
      getAttr(el, "status")?.toUpperCase() === "STOPPED" || getAttr(el, "status")?.toUpperCase() === "BYPASSED"
        ? (getAttr(el, "status")!.toUpperCase() as any)
        : "RUNNING";
    const controlMode: PumpControlMode =
      (getAttr(el, "controlMode")?.toUpperCase() as PumpControlMode) ?? "DISCHARGE_PRESSURE";
    const setpoint = parsePressure(getAttr(el, "setpoint"), 60e5);

    pumps.push({
      name,
      fromNode,
      toNode,
      maxPower,
      ratedFlow,
      ratedHead,
      npshRequired,
      efficiency,
      status,
      controlMode,
      setpoint,
    });
  }

  // 5. Extract Regulators
  const regulators: RegulatorValve[] = [];
  const regElements = findElements(root, ["regulator", "regulatorvalve", "prv"]);
  for (const el of regElements) {
    const name = getAttr(el, "name") ?? getAttr(el, "id") ?? `reg_${regulators.length + 1}`;
    const fromNode = getAttr(el, "from") ?? getAttr(el, "inlet") ?? "";
    const toNode = getAttr(el, "to") ?? getAttr(el, "outlet") ?? "";
    const setpointPressure = parsePressure(getAttr(el, "setpoint") ?? getAttr(el, "pressure"), 40e5);
    const maxCapacity = parseNum(getAttr(el, "capacity") ?? getAttr(el, "maxFlow"), 100.0);
    const cv = getAttr(el, "cv") != null ? parseNum(getAttr(el, "cv"), 500) : undefined;
    const allowReverseFlow = getAttr(el, "allowReverseFlow")?.toLowerCase() === "true";
    const preheaterInstalled =
      getAttr(el, "preheater")?.toLowerCase() === "true" || getAttr(el, "preheaterInstalled")?.toLowerCase() === "true";
    const preheaterTargetTemp =
      getAttr(el, "preheaterTargetTemp") != null ? parseTemp(getAttr(el, "preheaterTargetTemp"), 288.15) : undefined;

    regulators.push({
      name,
      fromNode,
      toNode,
      setpointPressure,
      maxCapacity,
      cv,
      allowReverseFlow,
      preheaterInstalled,
      preheaterTargetTemp,
    });
  }

  // 6. Extract Inline Valves
  const valves: InlineValve[] = [];
  const valveElements = findElements(root, ["valve", "inlinevalve", "esdvalve"]);
  for (const el of valveElements) {
    const name = getAttr(el, "name") ?? getAttr(el, "id") ?? `valve_${valves.length + 1}`;
    const fromNode = getAttr(el, "from") ?? "";
    const toNode = getAttr(el, "to") ?? "";
    const opening = parseNum(getAttr(el, "opening"), 1.0);
    const closingTimeSeconds = parseNum(getAttr(el, "closingTime") ?? getAttr(el, "strokeTime"), 15.0);

    valves.push({
      name,
      fromNode,
      toNode,
      opening,
      closingTimeSeconds,
    });
  }

  // 7. Gas Composition (TGNET)
  let gasComposition: GasComposition | undefined;
  const gasElements = findElements(root, ["gascomposition", "gasmixture", "composition"]);
  if (gasElements.length > 0 && gasElements[0]) {
    const g = gasElements[0];
    gasComposition = {
      methane: parseNum(getAttr(g, "ch4") ?? getAttr(g, "methane"), 0.9),
      ethane: parseNum(getAttr(g, "c2h6") ?? getAttr(g, "ethane"), 0.05),
      propane: parseNum(getAttr(g, "c3h8") ?? getAttr(g, "propane"), 0.02),
      nButane: parseNum(getAttr(g, "nc4") ?? getAttr(g, "nbutane"), 0.005),
      iButane: parseNum(getAttr(g, "ic4") ?? getAttr(g, "ibutane"), 0.005),
      pentanes: parseNum(getAttr(g, "c5") ?? getAttr(g, "pentanes"), 0.002),
      hexanePlus: parseNum(getAttr(g, "c6plus") ?? getAttr(g, "hexane"), 0.001),
      nitrogen: parseNum(getAttr(g, "n2") ?? getAttr(g, "nitrogen"), 0.012),
      carbonDioxide: parseNum(getAttr(g, "co2") ?? getAttr(g, "carbondioxide"), 0.005),
      hydrogen: parseNum(getAttr(g, "h2") ?? getAttr(g, "hydrogen"), 0.0),
      waterVapor: parseNum(getAttr(g, "h2o") ?? getAttr(g, "water"), 0.0),
      grossHeatingValue: parseNum(getAttr(g, "ghv"), 38.5), // MJ/m3
      standardDensity: parseNum(getAttr(g, "standardDensity"), 0.78), // kg/m3
    };
  } else if (simType === "TGNET") {
    gasComposition = {
      methane: 0.92,
      ethane: 0.04,
      propane: 0.015,
      nButane: 0.005,
      iButane: 0.005,
      pentanes: 0.002,
      hexanePlus: 0.001,
      nitrogen: 0.008,
      carbonDioxide: 0.004,
      hydrogen: 0.0,
      grossHeatingValue: 38.8,
      standardDensity: 0.77,
    };
  }

  // 8. Batches (TLNET)
  let batches: BatchSchedule | undefined;
  const batchElements = findElements(root, ["batchschedule", "batches"]);
  if (batchElements.length > 0 && batchElements[0]) {
    const products: LiquidProduct[] = [];
    const injections: BatchInjection[] = [];

    const prodEls = findElements(batchElements[0], ["product", "liquid"]);
    for (const p of prodEls) {
      products.push({
        id: getAttr(p, "id") ?? getAttr(p, "name") ?? `prod_${products.length + 1}`,
        name: getAttr(p, "name") ?? getAttr(p, "id") ?? "Product",
        densityAtRef: parseNum(getAttr(p, "density"), 830.0), // kg/m3
        viscosityAtRef: parseNum(getAttr(p, "viscosity"), 0.003), // Pa*s
        bulkModulus: parseNum(getAttr(p, "bulkModulus"), 1.4e9), // Pa
        vaporPressure: parsePressure(getAttr(p, "vaporPressure"), 50e3), // 50 kPa
      });
    }

    const injEls = findElements(batchElements[0], ["injection", "batch"]);
    for (const inj of injEls) {
      injections.push({
        batchId: getAttr(inj, "id") ?? getAttr(inj, "batchId") ?? `b_${injections.length + 1}`,
        productId: getAttr(inj, "productId") ?? getAttr(inj, "product") ?? products[0]?.id ?? "diesel",
        volume: parseNum(getAttr(inj, "volume"), 5000), // 5000 m3
        injectionNode: getAttr(inj, "injectionNode") ?? getAttr(inj, "from") ?? nodes[0]?.name ?? "",
        deliveryNode: getAttr(inj, "deliveryNode") ?? getAttr(inj, "to") ?? nodes[nodes.length - 1]?.name ?? "",
        startTime: parseNum(getAttr(inj, "startTime"), 0),
      });
    }

    batches = { products, injections };
  }

  // 9. Simulation Controls
  const ctrlEls = findElements(root, ["controls", "simulationcontrols", "study"]);
  const c = ctrlEls.length > 0 ? ctrlEls[0] : null;
  const simulationControls: SimulationControls = {
    startTime: parseNum(getAttr(c, "startTime"), 0),
    endTime: parseNum(getAttr(c, "endTime") ?? getAttr(c, "duration"), 86400),
    timeStep: parseNum(getAttr(c, "timeStep") ?? getAttr(c, "dt"), 60),
    steadyStateFirst: getAttr(c, "steadyStateFirst")?.toLowerCase() !== "false",
    equationOfState: (getAttr(c, "eos")?.toUpperCase() as any) ?? "AGA8",
    tolerance: parseNum(getAttr(c, "tolerance"), 1e-4),
  };

  return {
    id: modelId,
    title: modelTitle,
    type: simType,
    nodes,
    pipes,
    compressors,
    pumps,
    regulators,
    valves,
    gasComposition,
    batches,
    simulationControls,
  };
}
