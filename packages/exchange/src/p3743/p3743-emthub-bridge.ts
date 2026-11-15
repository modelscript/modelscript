// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Upstream EMTIOP / CIM RDF-XML <-> IEEE P3743 Bridge.
 *
 * Parses CIM RDF-XML network descriptions (e.g. from IEEE P3743 / emthub)
 * using @modelscript/dsl/xml AST into `P3743Package` and exports `P3743Package`
 * buses and corridors back to CIM RDF-XML.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type { P3743Bus, P3743Corridor, P3743Package, P3743VendorModelEncapsulation } from "./types.js";

function localTag(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function rdfId(el: XmlElement): string | undefined {
  for (const attr of el.attributes) {
    const loc = localTag(attr.name).toLowerCase();
    if (loc === "id" || loc === "about") {
      return attr.value.startsWith("#") ? attr.value.slice(1) : attr.value;
    }
  }
  return undefined;
}

function childText(el: XmlElement, propSuffix: string): string | undefined {
  const target = propSuffix.toLowerCase();
  const child = el.children.find((c) => localTag(c.name).toLowerCase().endsWith(target));
  return child?.text?.trim() || undefined;
}

function childResource(el: XmlElement, propSuffix: string): string | undefined {
  const target = propSuffix.toLowerCase();
  const child = el.children.find((c) => localTag(c.name).toLowerCase().endsWith(target));
  if (!child) return undefined;
  const res = child.attributes.find((a) => localTag(a.name).toLowerCase() === "resource")?.value;
  return res?.startsWith("#") ? res.slice(1) : res;
}

function escapeXml(val: string): string {
  return val.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Imports an upstream CIM / EMTIOP RDF-XML document into a `P3743Package`.
 */
export function importCimRdfToP3743(
  xmlText: string,
  options: { caseId?: string; title?: string; nominalFrequencyHz?: 50 | 60; baseKvLL?: number } = {},
): P3743Package {
  const doc = parseXml(xmlText);
  const root = doc.root;
  if (!root) {
    throw new Error("Invalid CIM RDF-XML: missing root element.");
  }

  const buses: P3743Bus[] = [];
  const busIds = new Set<string>();
  const lineSegments: Array<{ id: string; name: string; lengthKm: number }> = [];
  const pecList: Array<{
    id: string;
    name: string;
    ratedS: number;
    ratedU: number;
    payloadUri?: string | undefined;
    sha256?: string | undefined;
  }> = [];
  const terminalsByEquip = new Map<string, string[]>();

  for (const el of root.children) {
    const kind = localTag(el.name);
    const id = rdfId(el);
    if (!id) continue;

    if (kind === "ConnectivityNode" || kind === "TopologicalNode") {
      if (!busIds.has(id)) {
        busIds.add(id);
        const name = childText(el, "IdentifiedObject.name") ?? id;
        const baseKvRaw = childText(el, "BaseVoltage") ?? childText(el, "nominalVoltage");
        const baseKvLL = baseKvRaw ? Number.parseFloat(baseKvRaw) : (options.baseKvLL ?? 345);
        buses.push({
          id,
          name,
          baseKvLL: Number.isFinite(baseKvLL) && baseKvLL > 0 ? baseKvLL : 345,
          phases: ["A", "B", "C"],
        });
      }
    } else if (kind === "ACLineSegment" || kind === "PowerTransformer") {
      const name = childText(el, "IdentifiedObject.name") ?? id;
      const lenRaw = childText(el, "Conductor.length") ?? childText(el, "length");
      const lengthKm = lenRaw
        ? Math.max(0.001, Number.parseFloat(lenRaw) || 10)
        : kind === "PowerTransformer"
          ? 0.01
          : 10;
      lineSegments.push({ id, name, lengthKm });
    } else if (kind === "PowerElectronicsConnection") {
      const name = childText(el, "IdentifiedObject.name") ?? id;
      const ratedS = Number.parseFloat(childText(el, "ratedS") ?? "100") || 100;
      const ratedU = Number.parseFloat(childText(el, "ratedU") ?? String(options.baseKvLL ?? 345)) || 345;
      const payloadUri = childText(el, "payloadUri") ?? `urn:emtiop:ibr:${id}`;
      const sha256 = childText(el, "sha256") ?? "0".repeat(64);
      pecList.push({ id, name, ratedS, ratedU, payloadUri, sha256 });
    } else if (kind === "Terminal") {
      const eq = childResource(el, "Terminal.ConductingEquipment");
      const cn = childResource(el, "Terminal.ConnectivityNode") ?? childResource(el, "Terminal.TopologicalNode");
      if (eq && cn) {
        const list = terminalsByEquip.get(eq) ?? [];
        list.push(cn);
        terminalsByEquip.set(eq, list);
      }
    }
  }

  const corridors: P3743Corridor[] = [];
  for (const seg of lineSegments) {
    const nodes = terminalsByEquip.get(seg.id);
    if (nodes && nodes.length >= 2 && busIds.has(nodes[0]!) && busIds.has(nodes[1]!)) {
      corridors.push({
        id: seg.id,
        fromBusId: nodes[0]!,
        toBusId: nodes[1]!,
        lengthKm: seg.lengthKm,
        soilModel: { kind: "homogeneous", rhoOhmM: 100 },
      });
    }
  }

  const vendorModels: P3743VendorModelEncapsulation[] = [];
  for (const pec of pecList) {
    const nodes = terminalsByEquip.get(pec.id);
    const busId = nodes?.[0] ?? buses[0]?.id;
    if (!busId || !busIds.has(busId)) continue;
    const bus = buses.find((b) => b.id === busId);
    if (bus) bus.isPoi = true;
    vendorModels.push({
      id: pec.id,
      busId,
      payloadKind: "cigre-tb881-wasm",
      modelInfo: {
        modelName: pec.name,
        vendorName: "CIM_EMTIOP",
        firmwareVersion: "1.0.0",
        buildTimestamp: new Date().toISOString(),
        abiVersion: "IEEE_P2800.2_v1",
        numInputs: 10,
        numOutputs: 8,
        numParameters: 0,
        numStates: 0,
        recommendedTimeStepSec: 50e-6,
        minTimeStepSec: 10e-6,
        maxTimeStepSec: 100e-6,
      },
      initParams: {
        nominalFreqHz: options.nominalFrequencyHz ?? 60,
        mbaseMva: pec.ratedS,
        vNominalKv: pec.ratedU,
        controlMode: "voltage_control",
        parameters: {},
      },
      payloadUri: pec.payloadUri,
      sha256: pec.sha256 ?? "0".repeat(64),
    });
  }

  return {
    metadata: {
      schemaVersion: "IEEE-P3743-draft-1.0",
      caseId: options.caseId ?? "CIM-EMTIOP-IMPORT",
      title: options.title ?? "CIM / EMTIOP P3743 Case",
      nominalFrequencyHz: options.nominalFrequencyHz ?? 60,
      baseMva: 100,
      createdAtIso: new Date().toISOString(),
    },
    buses,
    corridors,
    vendorModels,
    boundaryEquivalents: [],
  };
}

/**
 * Exports a `P3743Package`'s buses and corridors to CIM / EMTIOP RDF-XML.
 */
export function exportP3743ToCimRdf(pkg: P3743Package): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#">`,
  ];

  for (const bus of pkg.buses) {
    lines.push(
      `  <cim:ConnectivityNode rdf:ID="${escapeXml(bus.id)}">`,
      `    <cim:IdentifiedObject.name>${escapeXml(bus.name)}</cim:IdentifiedObject.name>`,
      `    <cim:BaseVoltage.nominalVoltage>${bus.baseKvLL}</cim:BaseVoltage.nominalVoltage>`,
      `  </cim:ConnectivityNode>`,
    );
  }

  for (const corridor of pkg.corridors) {
    lines.push(
      `  <cim:ACLineSegment rdf:ID="${escapeXml(corridor.id)}">`,
      `    <cim:IdentifiedObject.name>${escapeXml(corridor.id)}</cim:IdentifiedObject.name>`,
      `    <cim:Conductor.length>${corridor.lengthKm}</cim:Conductor.length>`,
      `  </cim:ACLineSegment>`,
      `  <cim:Terminal rdf:ID="${escapeXml(corridor.id)}_T1">`,
      `    <cim:Terminal.ConductingEquipment rdf:resource="#${escapeXml(corridor.id)}" />`,
      `    <cim:Terminal.ConnectivityNode rdf:resource="#${escapeXml(corridor.fromBusId)}" />`,
      `  </cim:Terminal>`,
      `  <cim:Terminal rdf:ID="${escapeXml(corridor.id)}_T2">`,
      `    <cim:Terminal.ConductingEquipment rdf:resource="#${escapeXml(corridor.id)}" />`,
      `    <cim:Terminal.ConnectivityNode rdf:resource="#${escapeXml(corridor.toBusId)}" />`,
      `  </cim:Terminal>`,
    );
  }

  lines.push(`</rdf:RDF>`);
  return lines.join("\n");
}
