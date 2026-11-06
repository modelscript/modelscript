// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applyTabularMutation,
  executeTabularSheet,
  type CompiledTabularPayload,
  type TabularConfig,
  type TabularMutationRequest,
  type TabularMutationResult,
  type TabularRow,
} from "@modelscript/dsl";
import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { parseSsd } from "./ssd-parser.js";

function sspLocalName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function sspMatchName(actual: string, expected: string): boolean {
  return actual === expected || sspLocalName(actual).toLowerCase() === sspLocalName(expected).toLowerCase();
}

function findXmlElement(root: XmlElement | null, predicate: (el: XmlElement) => boolean): XmlElement | null {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findXmlElement(child, predicate);
    if (found) return found;
  }
  return null;
}

/**
 * Extracts SSP Components (`<ssd:Component>`) into a tabular sheet.
 */
export function extractSspComponentRows(xmlContent: string): TabularRow[] {
  const sys = parseSsd(xmlContent);
  return sys.components.map((comp) => ({
    id: comp.name,
    cells: {
      name: comp.name,
      type: comp.type ?? "application/x-fmu-sharedlibrary",
      source: comp.source,
      inputs: comp.connectors
        .filter((c) => c.kind === "input")
        .map((c) => c.name)
        .join(", "),
      outputs: comp.connectors
        .filter((c) => c.kind === "output")
        .map((c) => c.name)
        .join(", "),
      connectorCount: comp.connectors.length,
    },
  }));
}

/**
 * Extracts SSP Connections (`<ssd:Connection>`) into a tabular sheet.
 */
export function extractSspConnectionRows(xmlContent: string): TabularRow[] {
  const sys = parseSsd(xmlContent);
  return sys.connections.map((conn, idx) => ({
    id: `conn-${idx + 1}`,
    cells: {
      id: `conn-${idx + 1}`,
      startElement: conn.startElement || "(System)",
      startConnector: conn.startConnector,
      endElement: conn.endElement || "(System)",
      endConnector: conn.endConnector,
    },
  }));
}

/**
 * Extracts SSP Parameter Bindings (`<ssv:Parameter>`) into a tabular sheet.
 */
export function extractSspParameterRows(xmlContent: string): TabularRow[] {
  const sys = parseSsd(xmlContent);
  const rows: TabularRow[] = [];
  for (const binding of sys.parameterBindings) {
    const scope = binding.prefix || "(System)";
    for (const param of binding.values) {
      const id = binding.prefix ? `${binding.prefix}.${param.name}` : param.name;
      rows.push({
        id,
        cells: {
          scope,
          name: param.name,
          type: param.type,
          value: String(param.value),
          unit: param.unit ?? "",
        },
      });
    }
  }
  return rows;
}

/**
 * Updates an SSP Component `source` or Parameter `value` in the SSD/SSV XML text.
 */
export function updateSspTabularCell(
  xmlContent: string,
  sheetId: string,
  rowId: string,
  columnId: string,
  newValue: string,
): TabularMutationResult {
  const doc = parseXmlSync(xmlContent);
  if (!doc.root) {
    return {
      success: false,
      newText: xmlContent,
      edits: [],
      error: `Could not parse SSP XML document.`,
    };
  }

  if (sheetId === "components" && (columnId === "source" || columnId === "type")) {
    const compEl = findXmlElement(
      doc.root,
      (el) => sspMatchName(el.name, "Component") && el.attributes.some((a) => a.name === "name" && a.value === rowId),
    );
    if (compEl) {
      const attr = compEl.attributes.find((a) => a.name === columnId);
      if (attr) {
        const edit = {
          startOffset: attr.valueStart,
          endOffset: attr.valueEnd,
          newText: newValue,
        };
        const newText = xmlContent.slice(0, attr.valueStart) + newValue + xmlContent.slice(attr.valueEnd);
        return {
          success: true,
          newText,
          edits: [edit],
        };
      }
    }
  }

  if (sheetId === "parameters" && columnId === "value") {
    const paramName = rowId.includes(".") ? rowId.split(".").slice(1).join(".") : rowId;
    const paramEl = findXmlElement(
      doc.root,
      (el) =>
        sspMatchName(el.name, "Parameter") && el.attributes.some((a) => a.name === "name" && a.value === paramName),
    );
    if (paramEl) {
      const typeEl = findXmlElement(paramEl, (el) =>
        ["real", "integer", "boolean", "string", "enumeration"].includes(
          (el.name.includes(":") ? el.name.slice(el.name.indexOf(":") + 1) : el.name).toLowerCase(),
        ),
      );
      if (typeEl) {
        const attr = typeEl.attributes.find((a) => a.name === "value");
        if (attr) {
          const edit = {
            startOffset: attr.valueStart,
            endOffset: attr.valueEnd,
            newText: newValue,
          };
          const newText = xmlContent.slice(0, attr.valueStart) + newValue + xmlContent.slice(attr.valueEnd);
          return {
            success: true,
            newText,
            edits: [edit],
          };
        }
      }
    }
  }

  return {
    success: false,
    newText: xmlContent,
    edits: [],
    error: `Could not update '${columnId}' on '${rowId}' in SSP document.`,
  };
}

/**
 * Declarative & Bidirectional Tabular Configuration for SSP (`.ssp`, `.ssd`, `.ssv`).
 */
export const sspTabularConfig: TabularConfig = {
  defaultSheet: "components",
  enableCsvExport: true,
  enableMultiColumnSort: true,
  enableQuickFilter: true,
  sheets: {
    components: {
      id: "components",
      title: "FMU Components",
      description: "SSP SystemStructure.ssd FMU component instances and I/O port summary",
      icon: "package",
      kind: "flat",
      sourceRule: "Root",
      columns: [
        { id: "name", header: "Component", type: "string", width: 150, pinned: "left", mono: true },
        { id: "source", header: "FMU Resource Path", type: "string", width: 240, editable: true, mono: true },
        { id: "type", header: "MIME Type", type: "string", width: 220, editable: true, mono: true },
        { id: "inputs", header: "Input Ports", type: "reference", width: 180, mono: true },
        { id: "outputs", header: "Output Ports", type: "reference", width: 180, mono: true },
        { id: "connectorCount", header: "Ports", type: "number", width: 80, align: "right", mono: true },
      ],
      extractRows: extractSspComponentRows,
      mutations: {
        updateCell: (docText, rowId, columnId, newValue) =>
          updateSspTabularCell(docText, "components", rowId, columnId, String(newValue ?? "")),
      },
    },
    connections: {
      id: "connections",
      title: "Signal Connections",
      description: "Inter-FMU signal routing across SystemStructure.ssd connectors",
      icon: "link",
      kind: "flat",
      sourceRule: "Root",
      columns: [
        { id: "id", header: "ID", type: "string", width: 90, pinned: "left", mono: true },
        { id: "startElement", header: "Source Component", type: "reference", width: 160, mono: true },
        { id: "startConnector", header: "Source Port", type: "string", width: 150, mono: true },
        { id: "endElement", header: "Target Component", type: "reference", width: 160, mono: true },
        { id: "endConnector", header: "Target Port", type: "string", width: 150, mono: true },
      ],
      extractRows: extractSspConnectionRows,
    },
    parameters: {
      id: "parameters",
      title: "Parameter Bindings (.ssv)",
      description: "Editable SSV parameter values and physical units bound to FMU components",
      icon: "sliders",
      kind: "flat",
      sourceRule: "Root",
      columns: [
        { id: "scope", header: "Component Scope", type: "reference", width: 150, pinned: "left", mono: true },
        { id: "name", header: "Parameter Name", type: "string", width: 180, mono: true },
        { id: "type", header: "Type", type: "badge", width: 100, mono: true },
        { id: "value", header: "Value", type: "string", width: 140, editable: true, mono: true },
        { id: "unit", header: "Unit", type: "string", width: 90, mono: true },
      ],
      extractRows: extractSspParameterRows,
      mutations: {
        updateCell: (docText, rowId, columnId, newValue) =>
          updateSspTabularCell(docText, "parameters", rowId, columnId, String(newValue ?? "")),
      },
    },
  },
};

export function executeSspTabular(xmlContent: string, sheetId?: string): CompiledTabularPayload {
  return executeTabularSheet(sspTabularConfig, xmlContent, sheetId);
}

export function applySspTabularMutation(xmlContent: string, mutation: TabularMutationRequest): TabularMutationResult {
  return applyTabularMutation(sspTabularConfig, xmlContent, mutation);
}
