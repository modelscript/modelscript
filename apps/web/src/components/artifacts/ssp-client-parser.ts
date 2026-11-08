// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";

export interface SspPortMeta {
  name: string;
  kind: "input" | "output" | "inout" | "parameter";
  type: string;
  unit?: string | undefined;
}

export interface SspParamMeta {
  name: string;
  value: string | number;
  unit?: string | undefined;
}

export interface SspFmuComponentMeta {
  name: string;
  source: string;
  mimeType?: string | undefined;
  fmiType?: string | undefined;
  inputs?: string[] | undefined;
  outputs?: string[] | undefined;
  ports?: SspPortMeta[] | undefined;
  parameters?: SspParamMeta[] | undefined;
}

export interface SspConnectionMeta {
  startElement: string;
  startConnector: string;
  endElement: string;
  endConnector: string;
  type?: string | undefined;
  unit?: string | undefined;
}

export interface SspViewConfigLike {
  systemName?: string | undefined;
  title?: string | undefined;
  sspVersion?: string | undefined;
  fmiVersion?: string | undefined;
  masterAlgorithm?: string | undefined;
  communicationStepMs?: number | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  fmuComponents?: SspFmuComponentMeta[] | undefined;
  connections?: SspConnectionMeta[] | undefined;
}

export interface SspClientModel {
  systemName: string;
  sspVersion: string;
  fmiVersion: string;
  masterAlgorithm: string;
  stepSize: number;
  communicationStepMs: number;
  startTime: number;
  stopTime: number;
  fmus: SspFmuComponentMeta[];
  connections: SspConnectionMeta[];
  parameterSetNames: string[];
}

function getXmlAttr(el: XmlElement, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const attr of el.attributes) {
    if (attr.name.toLowerCase() === target) {
      return attr.value;
    }
  }
  return undefined;
}

function tagBase(name: string): string {
  const idx = name.indexOf(":");
  return (idx >= 0 ? name.slice(idx + 1) : name).toLowerCase();
}

/**
 * Parse `.ssd` XML on the client using CST parser to enrich missing metadata or synthesize an SSP 1.0 schematic SVG.
 */
export function parseSsdClientModel(xml: string, viewConfig: SspViewConfigLike): SspClientModel {
  let ssdElement: XmlElement | undefined;
  let sysElement: XmlElement | undefined;
  let expElement: XmlElement | undefined;
  const compElements: XmlElement[] = [];
  const connElements: XmlElement[] = [];
  const bindElements: XmlElement[] = [];

  if (xml) {
    const doc = parseXml(xml);
    const walk = (el: XmlElement) => {
      const b = tagBase(el.name);
      if (b === "systemstructuredescription") ssdElement = el;
      else if (b === "system") sysElement = el;
      else if (b === "defaultexperiment") expElement = el;
      else if (b === "component") compElements.push(el);
      else if (b === "connection") connElements.push(el);
      else if (b === "parameterbinding") bindElements.push(el);

      for (const child of el.children) {
        walk(child);
      }
    };
    if (doc.root) walk(doc.root);
  }

  const systemName =
    viewConfig.systemName ||
    (sysElement && getXmlAttr(sysElement, "name")) ||
    (ssdElement && getXmlAttr(ssdElement, "name")) ||
    viewConfig.title ||
    "SystemStructure.ssd";

  const sspVersion = viewConfig.sspVersion || (ssdElement && getXmlAttr(ssdElement, "version")) || "1.0";
  const fmiVersion = viewConfig.fmiVersion || "3.0 Co-Simulation";
  const masterAlgorithm =
    viewConfig.masterAlgorithm || (expElement && getXmlAttr(expElement, "algorithm")) || "Fixed-Step Gauss-Seidel";
  const stepSize =
    expElement && getXmlAttr(expElement, "stepSize") ? Number(getXmlAttr(expElement, "stepSize")) : 0.002;
  const communicationStepMs = viewConfig.communicationStepMs ?? Number((stepSize * 1000).toFixed(1));
  const startTime =
    viewConfig.startTime ??
    (expElement && getXmlAttr(expElement, "startTime") ? Number(getXmlAttr(expElement, "startTime")) : 0.0);
  const stopTime =
    viewConfig.stopTime ??
    (expElement && getXmlAttr(expElement, "stopTime") ? Number(getXmlAttr(expElement, "stopTime")) : 600.0);

  // Extract inline SSV parameter bindings
  const paramsByComp = new Map<string, SspParamMeta[]>();
  const parameterSetNames: string[] = [];
  for (const bEl of bindElements) {
    const prefix = (getXmlAttr(bEl, "prefix") || "").replace(/\.$/, "");
    for (const child of bEl.children) {
      const cb = tagBase(child.name);
      if (cb === "parameterset") {
        const sName = getXmlAttr(child, "name");
        if (sName) parameterSetNames.push(sName.endsWith(".ssv") ? sName : `${sName}.ssv`);
      }
      if (cb === "parameter" || cb === "parameterset") {
        const paramNodes = cb === "parameter" ? [child] : child.children.filter((c) => tagBase(c.name) === "parameter");
        for (const pEl of paramNodes) {
          const pName = getXmlAttr(pEl, "name") || "param";
          let compKey = prefix;
          let cleanParamName = pName;
          if (!compKey && pName.includes(".")) {
            const dotIdx = pName.indexOf(".");
            compKey = pName.slice(0, dotIdx);
            cleanParamName = pName.slice(dotIdx + 1) || pName;
          }
          for (const valEl of pEl.children) {
            const vb = tagBase(valEl.name);
            if (["real", "integer", "boolean", "string", "enumeration"].includes(vb)) {
              const val = getXmlAttr(valEl, "value") ?? "";
              const unit = getXmlAttr(valEl, "unit");
              if (!paramsByComp.has(compKey)) paramsByComp.set(compKey, []);
              paramsByComp.get(compKey)!.push({ name: cleanParamName, value: val, unit });
            }
          }
        }
      }
    }
  }

  // Extract components from XML or fallback to viewConfig.fmuComponents
  const fmus: SspFmuComponentMeta[] = [];
  if (compElements.length > 0) {
    for (const cEl of compElements) {
      const name = getXmlAttr(cEl, "name") || `FMU_${fmus.length + 1}`;
      const source = getXmlAttr(cEl, "source") || `resources/${name}.fmu`;
      const mimeType = getXmlAttr(cEl, "type") || "application/x-fmu-sharedlibrary";
      const ports: SspPortMeta[] = [];

      const connectorElements: XmlElement[] = [];
      const findConnectors = (node: XmlElement) => {
        for (const child of node.children) {
          if (tagBase(child.name) === "connector") {
            connectorElements.push(child);
          } else {
            findConnectors(child);
          }
        }
      };
      findConnectors(cEl);

      for (const child of connectorElements) {
        const cName = getXmlAttr(child, "name") || "port";
        const rawKind = (getXmlAttr(child, "kind") || "inout").toLowerCase();
        const kind: SspPortMeta["kind"] =
          rawKind === "input" || rawKind === "output" || rawKind === "parameter" ? rawKind : "inout";

        let type = "Real";
        let unit: string | undefined;
        const findType = (node: XmlElement) => {
          for (const typeEl of node.children) {
            const tb = tagBase(typeEl.name);
            if (["real", "integer", "boolean", "string", "enumeration"].includes(tb)) {
              type = typeEl.name.split(":").pop()!;
              unit = getXmlAttr(typeEl, "unit");
              return;
            }
            findType(typeEl);
          }
        };
        findType(child);

        if (!unit) {
          if (cName.endsWith("_W")) unit = "W";
          else if (cName.endsWith("_K")) unit = "K";
        }
        ports.push({ name: cName, kind, type, unit });
      }

      const cfgFmu = viewConfig.fmuComponents?.find((f) => f.name === name);
      const parameters = paramsByComp.get(name) ?? cfgFmu?.parameters ?? [];
      fmus.push({
        name,
        source,
        mimeType,
        fmiType: "FMI 3.0 CS",
        inputs: ports.filter((p) => p.kind === "input").map((p) => p.name),
        outputs: ports.filter((p) => p.kind === "output" || p.kind === "inout").map((p) => p.name),
        ports,
        parameters,
      });
    }
  } else if (Array.isArray(viewConfig.fmuComponents)) {
    for (const fc of viewConfig.fmuComponents) {
      const ports: SspPortMeta[] = fc.ports ?? [
        ...(fc.inputs ?? []).map((n) => ({
          name: n,
          kind: "input" as const,
          type: "Real",
          unit: n.endsWith("_W") ? "W" : n.endsWith("_K") ? "K" : undefined,
        })),
        ...(fc.outputs ?? []).map((n) => ({
          name: n,
          kind: "output" as const,
          type: "Real",
          unit: n.endsWith("_W") ? "W" : n.endsWith("_K") ? "K" : undefined,
        })),
      ];
      fmus.push({
        ...fc,
        mimeType: fc.mimeType || "application/x-fmu-sharedlibrary",
        fmiType: fc.fmiType || "FMI 3.0 CS",
        ports,
        parameters: paramsByComp.get(fc.name) ?? fc.parameters ?? [],
      });
    }
  }

  // Extract connections from XML (ensuring all connections are captured) or fallback to viewConfig
  const connections: SspConnectionMeta[] = [];
  if (connElements.length > 0) {
    for (const em of connElements) {
      const startElement = getXmlAttr(em, "startElement") || "";
      const startConnector = getXmlAttr(em, "startConnector") || "";
      const endElement = getXmlAttr(em, "endElement") || "";
      const endConnector = getXmlAttr(em, "endConnector") || "";
      const srcPort = fmus.find((f) => f.name === startElement)?.ports?.find((p) => p.name === startConnector);
      const tgtPort = fmus.find((f) => f.name === endElement)?.ports?.find((p) => p.name === endConnector);
      const type = srcPort?.type || tgtPort?.type || "Real";
      const unit =
        srcPort?.unit ||
        tgtPort?.unit ||
        (startConnector.endsWith("_W") ? "W" : startConnector.endsWith("_K") ? "K" : undefined);
      connections.push({ startElement, startConnector, endElement, endConnector, type, unit });
    }
  } else if (Array.isArray(viewConfig.connections)) {
    for (const c of viewConfig.connections) {
      const unit =
        c.unit || (c.startConnector.endsWith("_W") ? "W" : c.startConnector.endsWith("_K") ? "K" : undefined);
      connections.push({ ...c, type: c.type || "Real", unit });
    }
  }

  return {
    systemName,
    sspVersion,
    fmiVersion,
    masterAlgorithm,
    stepSize,
    communicationStepMs,
    startTime,
    stopTime,
    fmus,
    connections,
    parameterSetNames:
      parameterSetNames.length > 0
        ? parameterSetNames
        : fmus.filter((f) => (f.parameters?.length ?? 0) > 0).map((f) => `${f.name}_Params.ssv`),
  };
}
