// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Fast XML Parser for OLGA GUI Project Files (.opi).
 *
 * Implements high-performance XML extraction for pipeline flowpaths,
 * spatial geometry, multiphase boundary conditions, and control loops
 * using @modelscript/dsl/xml.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  OlgaController,
  OlgaFlowpath,
  OlgaHeatTransfer,
  OlgaModel,
  OlgaNode,
  OlgaNodeKind,
  OlgaPig,
  OlgaPipe,
  OlgaSource,
  OlgaValve,
  OlgaWallLayer,
} from "../types.js";

function getAttr(el: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const a of el.attributes) {
    if (a.name.toLowerCase() === lower) {
      return a.value;
    }
  }
  return undefined;
}

function parseNum(val: string | undefined, defaultVal: number): number {
  if (val == null || val === "") return defaultVal;
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

function parsePressure(val: string | undefined, defaultVal: number): number {
  if (val == null || val === "") return defaultVal;
  const clean = val.toLowerCase().trim();
  if (clean.endsWith("bar")) {
    return parseFloat(clean) * 1.0e5;
  }
  const num = parseFloat(clean);
  if (num > 0 && num < 2000) {
    return num * 1.0e5;
  }
  return Number.isFinite(num) ? num : defaultVal;
}

function parseTemp(val: string | undefined, defaultVal: number): number {
  if (val == null || val === "") return defaultVal;
  const clean = val.toLowerCase().trim();
  if (clean.endsWith("c")) {
    return parseFloat(clean) + 273.15;
  }
  const num = parseFloat(clean);
  if (num > -100 && num < 200) {
    return num + 273.15;
  }
  return Number.isFinite(num) ? num : defaultVal;
}

export function parseOpi(xmlText: string): OlgaModel {
  const doc = parseXml(xmlText);
  const root = doc.root;
  if (!root || (root.name !== "Model" && root.name !== "OlgaProject" && root.name !== "olgaproject")) {
    throw new Error(`Expected root tag <Model> or <OlgaProject>, found <${root?.name ?? "null"}>`);
  }

  const title = getAttr(root, "Title") ?? getAttr(root, "Name") ?? "Untitled Olga Case";
  const author = getAttr(root, "Author");
  const tableFile = getAttr(root, "TableFile");

  let startTime = 0;
  let endTime = 7200;
  let minDt = 0.001;
  let maxDt = 1.0;

  const flowpaths: OlgaFlowpath[] = [];
  const nodes: OlgaNode[] = [];

  for (const child of root.children) {
    const name = child.name;

    if (name === "Integration" || name === "INTEGRATION") {
      startTime = parseNum(getAttr(child, "StartTime"), startTime);
      endTime = parseNum(getAttr(child, "EndTime"), endTime);
      minDt = parseNum(getAttr(child, "MinDt"), minDt);
      maxDt = parseNum(getAttr(child, "MaxDt"), maxDt);
    } else if (name === "Flowpath" || name === "FLOWPATH") {
      flowpaths.push(parseFlowpathElement(child));
    } else if (name === "Node" || name === "NODE") {
      nodes.push(parseNodeElement(child));
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

function parseFlowpathElement(el: XmlElement): OlgaFlowpath {
  const name = getAttr(el, "Name") || "FLOWPATH_1";
  const pipes: OlgaPipe[] = [];
  const valves: OlgaValve[] = [];
  const sources: OlgaSource[] = [];
  const controllers: OlgaController[] = [];
  const pigs: OlgaPig[] = [];
  let heatTransfer: OlgaHeatTransfer | undefined;

  for (const child of el.children) {
    const tagName = child.name;

    if (tagName === "Pipe" || tagName === "PIPE") {
      pipes.push({
        label: getAttr(child, "Label") || `PIPE_${pipes.length + 1}`,
        length: parseNum(getAttr(child, "Length"), 1000),
        diameter: parseNum(getAttr(child, "Diameter"), 0.254),
        elevation: parseNum(getAttr(child, "Elevation"), 0),
        roughness: parseNum(getAttr(child, "Roughness"), 4.5e-5),
        discretization: Math.max(2, Math.floor(parseNum(getAttr(child, "Discretization"), 10))),
      });
    } else if (tagName === "Valve" || tagName === "VALVE") {
      valves.push({
        name: getAttr(child, "Name") || `VALVE_${valves.length + 1}`,
        position: parseNum(getAttr(child, "Position") ?? getAttr(child, "AbsolutePosition"), 0),
        diameter: parseNum(getAttr(child, "Diameter"), 0.2),
        opening: parseNum(getAttr(child, "Opening"), 1.0),
        cd: parseNum(getAttr(child, "Cd"), 0.84),
        timeToOpen: parseNum(getAttr(child, "TimeToOpen"), 5.0),
        timeToClose: parseNum(getAttr(child, "TimeToClose"), 5.0),
      });
    } else if (tagName === "Source" || tagName === "SOURCE" || tagName === "MassSource") {
      sources.push({
        name: getAttr(child, "Name") || `SOURCE_${sources.length + 1}`,
        position: parseNum(getAttr(child, "Position"), 0),
        totalMassRate: parseNum(getAttr(child, "TotalMassRate") ?? getAttr(child, "MassRate"), 30.0),
        gasMassFraction: parseNum(getAttr(child, "GasMassFraction"), 0.2),
        waterCut: parseNum(getAttr(child, "WaterCut"), 0.05),
        temperature: parseTemp(getAttr(child, "Temperature"), 353.15),
        pressure: parsePressure(getAttr(child, "Pressure"), 150e5),
      });
    } else if (tagName === "Controller" || tagName === "CONTROLLER") {
      controllers.push({
        name: getAttr(child, "Name") || `CTRL_${controllers.length + 1}`,
        type: (getAttr(child, "Type") || "PID").toUpperCase() as "PID" | "MANUAL" | "ON_OFF",
        setpoint: parseNum(getAttr(child, "SetPoint"), 50.0),
        gain: parseNum(getAttr(child, "Gain"), 1.0),
        ti: parseNum(getAttr(child, "Ti"), 20.0),
        td: parseNum(getAttr(child, "Td"), 0.0),
        transmitter: getAttr(child, "Transmitter") || "",
        controlledValve: getAttr(child, "ControlledValve") ?? getAttr(child, "Valve") ?? "",
      });
    } else if (tagName === "Pig" || tagName === "PIG") {
      pigs.push({
        name: getAttr(child, "Name") || `PIG_${pigs.length + 1}`,
        launchTime: parseNum(getAttr(child, "LaunchTime") ?? getAttr(child, "Time"), 0.0),
        mass: parseNum(getAttr(child, "Mass"), 100.0),
        diameter: parseNum(getAttr(child, "Diameter"), 0.3),
        bypassFraction: parseNum(getAttr(child, "BypassFraction") ?? getAttr(child, "Bypass"), 0.0),
        frictionForce: parseNum(getAttr(child, "FrictionForce") ?? getAttr(child, "Friction"), 2500.0),
      });
    } else if (tagName === "HeatTransfer" || tagName === "HEATTRANSFER") {
      heatTransfer = parseHeatTransferElement(child);
    }
  }

  return {
    name,
    pipes,
    valves,
    sources,
    controllers,
    pigs,
    heatTransfer,
  };
}

function parseHeatTransferElement(el: XmlElement): OlgaHeatTransfer {
  const type = (getAttr(el, "Type") || "WATER").toUpperCase() as "WALL" | "AIR" | "WATER" | "BURIED";
  const ambientTemperature = parseTemp(getAttr(el, "AmbientTemperature"), 277.15);
  const ambientHeatTransferCoeff = parseNum(getAttr(el, "AmbientHeatTransferCoeff"), 250.0);

  const layers: OlgaWallLayer[] = [];
  for (const child of el.children) {
    const tagName = child.name;
    if (tagName === "Layer" || tagName === "LAYER" || tagName === "Wall" || tagName === "WALL") {
      layers.push({
        material: getAttr(child, "Material") || "STEEL",
        thickness: parseNum(getAttr(child, "Thickness"), 0.02),
        conductivity: parseNum(getAttr(child, "Conductivity"), 45.0),
        density: parseNum(getAttr(child, "Density"), 7850),
        heatCapacity: parseNum(getAttr(child, "HeatCapacity"), 480),
      });
    }
  }

  return {
    type,
    ambientTemperature,
    ambientHeatTransferCoeff,
    layers,
  };
}

function parseNodeElement(el: XmlElement): OlgaNode {
  const name = getAttr(el, "Name") || "NODE";
  const rawType = (getAttr(el, "Type") || "INTERNAL").toUpperCase();
  const type: OlgaNodeKind = ["TERMINAL", "PRESSURE", "MASS_SOURCE", "INTERNAL", "SEPARATOR"].includes(rawType)
    ? (rawType as OlgaNodeKind)
    : "INTERNAL";

  const flowpath = getAttr(el, "Flowpath") || "";
  const boundaryPosition = parseNum(getAttr(el, "BoundaryPosition") ?? getAttr(el, "Fraction"), 0.0);

  const pressure = getAttr(el, "Pressure") ? parsePressure(getAttr(el, "Pressure"), 50e5) : undefined;
  const temperature = getAttr(el, "Temperature") ? parseTemp(getAttr(el, "Temperature"), 293.15) : undefined;
  const massRate = getAttr(el, "MassRate") ? parseNum(getAttr(el, "MassRate"), 30.0) : undefined;
  const gasMassFraction = getAttr(el, "GasMassFraction") ? parseNum(getAttr(el, "GasMassFraction"), 0.2) : undefined;
  const waterCut = getAttr(el, "WaterCut") ? parseNum(getAttr(el, "WaterCut"), 0.05) : undefined;

  return {
    name,
    type,
    flowpath,
    boundaryPosition,
    pressure,
    temperature,
    massRate,
    gasMassFraction,
    waterCut,
  };
}

/**
 * Serializes an OlgaModel back to XML .opi format.
 */
export function serializeOpi(model: OlgaModel): string {
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<Model Name="${escapeXml(model.title)}" StartTime="${model.startTime}" EndTime="${model.endTime}" MinDt="${model.minDt}" MaxDt="${model.maxDt}">\n`;
  for (const fp of model.flowpaths) {
    xml += `  <Flowpath Name="${escapeXml(fp.name)}">\n`;
    for (const pipe of fp.pipes) {
      xml += `    <Pipe Name="${escapeXml(pipe.label)}" Length="${pipe.length}" Diameter="${pipe.diameter}" Elevation="${pipe.elevation}" Roughness="${pipe.roughness}" Discretization="${pipe.discretization}" />\n`;
    }
    for (const valve of fp.valves) {
      xml += `    <Valve Name="${escapeXml(valve.name)}" Position="${valve.position}" Diameter="${valve.diameter}" Opening="${valve.opening}" Cd="${valve.cd}" />\n`;
    }
    for (const pig of fp.pigs || []) {
      xml += `    <Pig Name="${escapeXml(pig.name)}" LaunchTime="${pig.launchTime}" Mass="${pig.mass ?? 100}" FrictionForce="${pig.frictionForce ?? 2500}" />\n`;
    }
    xml += `  </Flowpath>\n`;
  }
  for (const node of model.nodes) {
    xml += `  <Node Name="${escapeXml(node.name)}" Type="${node.type}" Flowpath="${escapeXml(node.flowpath)}" Fraction="${node.boundaryPosition}"`;
    if (node.pressure != null) xml += ` Pressure="${node.pressure}"`;
    if (node.temperature != null) xml += ` Temperature="${node.temperature}"`;
    if (node.massRate != null) xml += ` MassRate="${node.massRate}"`;
    xml += ` />\n`;
  }
  xml += `</Model>\n`;
  return xml;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
