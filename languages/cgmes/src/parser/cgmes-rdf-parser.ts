// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Common Grid Model Exchange Standard (CGMES) RDF/XML Parser.
 *
 * Parses IEC 61970 CIM profiles:
 * - Equipment (EQ)
 * - Topology (TP)
 * - Steady State Hypothesis (SSH)
 * - State Variables (SV)
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type { CgmesModel } from "../types.js";

/** Creates a fresh empty CGMES model. */
export function createEmptyCgmesModel(): CgmesModel {
  return {
    substations: new Map(),
    voltageLevels: new Map(),
    busbars: new Map(),
    nodes: new Map(),
    connectivityNodes: new Map(),
    terminals: new Map(),
    lines: new Map(),
    transformers: new Map(),
    transformerEnds: new Map(),
    generators: new Map(),
    loads: new Map(),
    shunts: new Map(),
    svVoltages: new Map(),
    svFlows: new Map(),
    baseVoltages: new Map(),
  };
}

/** Extracts the local tag name without XML namespace prefix. */
function localName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

/** Extracts the ID / mRID from rdf:ID or rdf:about attributes. */
function extractMRid(element: XmlElement): string | undefined {
  for (const attr of element.attributes) {
    const loc = localName(attr.name);
    if (loc === "ID") {
      return attr.value;
    }
    if (loc === "about") {
      let val = attr.value;
      if (val.startsWith("#")) val = val.slice(1);
      else if (val.startsWith("urn:uuid:")) val = val.slice(9);
      else {
        const hashIdx = val.lastIndexOf("#");
        if (hashIdx >= 0) val = val.slice(hashIdx + 1);
      }
      return val;
    }
  }
  return undefined;
}

/** Cleans resource references (e.g. rdf:resource="#_node1" -> "_node1"). */
function cleanResourceRef(val: string): string {
  if (val.startsWith("#")) return val.slice(1);
  if (val.startsWith("urn:uuid:")) return val.slice(9);
  const hashIdx = val.lastIndexOf("#");
  return hashIdx >= 0 ? val.slice(hashIdx + 1) : val;
}

/** Retrieves attribute or child resource reference. */
function getResourceRef(element: XmlElement, propertyName: string): string | undefined {
  const target = propertyName.toLowerCase();
  for (const child of element.children) {
    const name = localName(child.name).toLowerCase();
    if (name === target || name.endsWith("." + target)) {
      for (const attr of child.attributes) {
        if (localName(attr.name).toLowerCase() === "resource") {
          return cleanResourceRef(attr.value);
        }
      }
      const txt = child.text.trim();
      if (txt) return cleanResourceRef(txt);
    }
  }
  return undefined;
}

/** Retrieves child element text as string. */
function getPropertyText(element: XmlElement, propertyName: string): string | undefined {
  const target = propertyName.toLowerCase();
  for (const child of element.children) {
    const name = localName(child.name).toLowerCase();
    if (name === target || name.endsWith("." + target)) {
      return child.text.trim();
    }
  }
  return undefined;
}

/** Retrieves child element text as number. */
function getPropertyFloat(element: XmlElement, propertyName: string, defaultValue = 0): number {
  const text = getPropertyText(element, propertyName);
  if (text === undefined || text === "") return defaultValue;
  const val = Number.parseFloat(text);
  return Number.isFinite(val) ? val : defaultValue;
}

/**
 * Parses an RDF/XML string containing CGMES profile records into a CgmesModel.
 */
export function parseCgmesRdf(xmlSource: string, targetModel?: CgmesModel): CgmesModel {
  const model = targetModel ?? createEmptyCgmesModel();
  const doc = parseXml(xmlSource);
  if (!doc.root) return model;

  // Process root children (the CIM entities)
  const entities = doc.root.children;

  // First pass: collect BaseVoltage entries
  for (const el of entities) {
    const type = localName(el.name);
    if (type === "BaseVoltage") {
      const id = extractMRid(el);
      if (id) {
        const nomU = getPropertyFloat(el, "nominalVoltage", 400.0);
        model.baseVoltages.set(id, nomU);
      }
    }
  }

  // Second pass: parse core entities
  for (const el of entities) {
    const type = localName(el.name);
    const mRID = extractMRid(el);
    if (!mRID) continue;

    const name = getPropertyText(el, "name") ?? mRID;
    const description = getPropertyText(el, "description");

    switch (type) {
      case "Substation": {
        const region = getResourceRef(el, "Region") ?? getPropertyText(el, "Region");
        model.substations.set(mRID, { mRID, name, description, region });
        break;
      }

      case "VoltageLevel": {
        const subId = getResourceRef(el, "Substation");
        const bvRef = getResourceRef(el, "BaseVoltage");
        const baseKv =
          bvRef && model.baseVoltages.has(bvRef)
            ? (model.baseVoltages.get(bvRef) ?? 400.0)
            : getPropertyFloat(el, "nominalVoltage", 400.0);
        const lowVoltageLimit = getPropertyFloat(el, "lowVoltageLimit", baseKv * 0.9);
        const highVoltageLimit = getPropertyFloat(el, "highVoltageLimit", baseKv * 1.1);

        model.voltageLevels.set(mRID, {
          mRID,
          name,
          description,
          substationId: subId,
          baseVoltageKv: baseKv,
          lowVoltageLimit,
          highVoltageLimit,
        });
        break;
      }

      case "BusbarSection": {
        const vlId = getResourceRef(el, "EquipmentContainer") ?? getResourceRef(el, "VoltageLevel");
        model.busbars.set(mRID, { mRID, name, description, voltageLevelId: vlId });
        break;
      }

      case "TopologicalNode": {
        const bvRef = getResourceRef(el, "BaseVoltage");
        const baseKv =
          bvRef && model.baseVoltages.has(bvRef)
            ? (model.baseVoltages.get(bvRef) ?? 400.0)
            : getPropertyFloat(el, "nominalVoltage", 400.0);
        const vlId = getResourceRef(el, "ConnectivityNodeContainer") ?? getResourceRef(el, "VoltageLevel");

        model.nodes.set(mRID, {
          mRID,
          name,
          description,
          baseVoltageKv: baseKv,
          voltageLevelId: vlId,
        });
        break;
      }

      case "ConnectivityNode": {
        const cId = getResourceRef(el, "ConnectivityNodeContainer");
        model.connectivityNodes.set(mRID, { mRID, name, description, containerId: cId });
        break;
      }

      case "Terminal": {
        const existing = model.terminals.get(mRID);
        const ceRef = getResourceRef(el, "ConductingEquipment");
        const ceId = ceRef ?? existing?.conductingEquipmentId ?? "";
        const cnId = getResourceRef(el, "ConnectivityNode") ?? existing?.connectivityNodeId;
        const tnId = getResourceRef(el, "TopologicalNode") ?? existing?.topologicalNodeId;
        const seq = el.children.some((c) => localName(c.name).toLowerCase().endsWith("sequencenumber"))
          ? Math.floor(getPropertyFloat(el, "sequenceNumber", 1))
          : (existing?.sequenceNumber ?? 1);

        model.terminals.set(mRID, {
          mRID,
          name: existing?.name ?? name,
          description: existing?.description ?? description,
          conductingEquipmentId: ceId,
          connectivityNodeId: cnId,
          topologicalNodeId: tnId,
          sequenceNumber: seq,
        });
        break;
      }

      case "ACLineSegment": {
        const r = getPropertyFloat(el, "r", 0.01);
        const x = getPropertyFloat(el, "x", 0.05);
        const bch = getPropertyFloat(el, "bch", 0.0);
        const gch = getPropertyFloat(el, "gch", 0.0);
        const lengthKm = getPropertyFloat(el, "length", 1.0);
        const ratedCurrentA = getPropertyFloat(el, "ratedCurrent", 1000.0);

        model.lines.set(mRID, {
          mRID,
          name,
          description,
          r,
          x,
          bch,
          gch,
          lengthKm,
          ratedCurrentA,
        });
        break;
      }

      case "PowerTransformer": {
        const subId = getResourceRef(el, "EquipmentContainer") ?? getResourceRef(el, "Substation");
        model.transformers.set(mRID, { mRID, name, description, substationId: subId });
        break;
      }

      case "PowerTransformerEnd": {
        const xfId = getResourceRef(el, "PowerTransformer") ?? "";
        const termId = getResourceRef(el, "Terminal") ?? "";
        const endNum = Math.floor(getPropertyFloat(el, "endNumber", 1));
        const r = getPropertyFloat(el, "r", 0.005);
        const x = getPropertyFloat(el, "x", 0.04);
        const b = getPropertyFloat(el, "b", 0.0);
        const g = getPropertyFloat(el, "g", 0.0);
        const ratedUkV = getPropertyFloat(el, "ratedU", 400.0);
        const ratedSMva = getPropertyFloat(el, "ratedS", 100.0);

        model.transformerEnds.set(mRID, {
          mRID,
          name,
          description,
          powerTransformerId: xfId,
          terminalId: termId,
          endNumber: endNum,
          r,
          x,
          b,
          g,
          ratedUkV,
          ratedSMva,
        });
        break;
      }

      case "SynchronousMachine": {
        // May already exist from EQ; SSH updates p/q
        const existing = model.generators.get(mRID);
        const pMw = getPropertyFloat(el, "p", existing?.pMw ?? 0.0);
        const qMvar = getPropertyFloat(el, "q", existing?.qMvar ?? 0.0);
        const minPMw = getPropertyFloat(el, "minP", existing?.minPMw ?? 0.0);
        const maxPMw = getPropertyFloat(el, "maxP", existing?.maxPMw ?? 1000.0);
        const minQMvar = getPropertyFloat(el, "minQ", existing?.minQMvar ?? -500.0);
        const maxQMvar = getPropertyFloat(el, "maxQ", existing?.maxQMvar ?? 500.0);
        const ratedSMva = getPropertyFloat(el, "ratedS", existing?.ratedSMva ?? 100.0);

        model.generators.set(mRID, {
          mRID,
          name: existing?.name ?? name,
          description: existing?.description ?? description,
          pMw,
          qMvar,
          minPMw,
          maxPMw,
          minQMvar,
          maxQMvar,
          ratedSMva,
        });
        break;
      }

      case "EnergyConsumer": {
        const existing = model.loads.get(mRID);
        const pMw = getPropertyFloat(el, "p", existing?.pMw ?? 0.0);
        const qMvar = getPropertyFloat(el, "q", existing?.qMvar ?? 0.0);

        model.loads.set(mRID, {
          mRID,
          name: existing?.name ?? name,
          description: existing?.description ?? description,
          pMw,
          qMvar,
        });
        break;
      }

      case "LinearShuntCompensator": {
        const bPerSection = getPropertyFloat(el, "bPerSection", 0.0);
        const gPerSection = getPropertyFloat(el, "gPerSection", 0.0);
        const sections = Math.floor(getPropertyFloat(el, "sections", 1));

        model.shunts.set(mRID, {
          mRID,
          name,
          description,
          bPerSection,
          gPerSection,
          sections,
        });
        break;
      }

      case "SvVoltage": {
        const tnId = getResourceRef(el, "TopologicalNode") ?? "";
        const vPu = getPropertyFloat(el, "v", 1.0);
        const angleDeg = getPropertyFloat(el, "angle", 0.0);

        model.svVoltages.set(mRID, {
          topologicalNodeId: tnId,
          vPu,
          angleDeg,
        });
        break;
      }

      case "SvPowerFlow": {
        const termId = getResourceRef(el, "Terminal") ?? "";
        const pMw = getPropertyFloat(el, "p", 0.0);
        const qMvar = getPropertyFloat(el, "q", 0.0);

        model.svFlows.set(mRID, {
          terminalId: termId,
          pMw,
          qMvar,
        });
        break;
      }

      default:
        // Other CIM classes are ignored or handled in extensions
        break;
    }
  }

  return model;
}

/** Parses multiple CGMES profile files into a merged model. */
export function parseCgmesFiles(sources: string[]): CgmesModel {
  const model = createEmptyCgmesModel();
  for (const src of sources) {
    parseCgmesRdf(src, model);
  }
  return model;
}
