// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramBackend, DiagramDispatchDeps } from "../diagramApi.js";
import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramData,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramPalette,
  PropertyFieldConfig,
} from "../diagramProtocol.js";

export function createSpiceDiagramBackend(backends: DiagramDispatchDeps): DiagramBackend {
  const readSpiceSource = async (targetUri: string): Promise<string | null> => {
    const memText =
      (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
      (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
    if (typeof memText === "string") return memText;
    try {
      const fs = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      // ignore fs errors
    }
    return null;
  };

  const formatSpiceDiagramData = (rawDiagram: any, meta?: Record<string, any>): DiagramData => {
    const nodes = rawDiagram.cells.filter((c: any) => c.shape !== "edge");
    const edges = rawDiagram.cells.filter((c: any) => c.shape === "edge");
    return {
      nodes,
      edges,
      coordinateSystem: null,
      diagramBackground: null,
      cells: rawDiagram.cells,
      metadata: { title: rawDiagram.title, ...(meta ?? {}) },
    } as any;
  };

  return {
    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      try {
        const text = await readSpiceSource(params.uri);
        if (!text) return null;
        const { parseSpice, buildSpiceDiagram } = await import("@modelscript/spice");
        const circuit = parseSpice(text);
        const rawDiagram = buildSpiceDiagram(circuit);
        return formatSpiceDiagramData(rawDiagram, {
          componentCount: circuit.components.length,
          directiveCount: circuit.directives.length,
        });
      } catch {
        return null;
      }
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      try {
        const text = await readSpiceSource(params.uri);
        if (!text) return null;
        const { parseSpice, formatSpiceValue } = await import("@modelscript/spice");
        const circuit = parseSpice(text);
        const rawName = params.componentName;
        const cleanName = rawName.startsWith("cmp_") ? rawName.slice(4) : rawName;
        const cmp = circuit.components.find(
          (c) => c.name.toLowerCase() === cleanName.toLowerCase() || c.name.toLowerCase() === rawName.toLowerCase(),
        );
        if (!cmp) return null;

        const parameters: ComponentPropertyData["parameters"] = [
          { name: "Kind", value: cmp.kind, group: "Component Info" },
          { name: "Nodes", value: cmp.nodes.join(", "), group: "Connectivity" },
        ];
        const fields: PropertyFieldConfig[] = [
          { key: "Kind", label: "Kind", kind: "string", defaultValue: cmp.kind },
          { key: "Nodes", label: "Nodes", kind: "string", defaultValue: cmp.nodes.join(", ") },
        ];
        const values: Record<string, any> = {
          Kind: cmp.kind,
          Nodes: cmp.nodes.join(", "),
        };

        if (cmp.value !== undefined) {
          const formatted = formatSpiceValue(cmp.value, cmp.kind);
          parameters.push({
            name: "Value",
            value: formatted,
            description: `Numerical value (${cmp.value})`,
            group: "Electrical",
          });
          fields.push({ key: "Value", label: "Value", kind: "string", defaultValue: formatted });
          values["Value"] = formatted;
        }
        if (cmp.model) {
          parameters.push({
            name: "Model",
            value: cmp.model,
            description: "SPICE .MODEL reference",
            group: "Model",
          });
          fields.push({ key: "Model", label: "Model", kind: "string", defaultValue: cmp.model });
          values["Model"] = cmp.model;
        }
        if (cmp.params) {
          const pEntries: [string, any][] =
            cmp.params instanceof Map ? Array.from(cmp.params.entries()) : Object.entries(cmp.params);
          for (const [k, v] of pEntries) {
            parameters.push({ name: k, value: String(v), description: `Parameter ${k}`, group: "Parameters" });
            fields.push({ key: k, label: k, kind: typeof v === "number" ? "number" : "string", defaultValue: v });
            values[k] = v;
          }
        }

        return {
          classKind: "component",
          className: cmp.kind,
          name: cmp.name,
          description: `SPICE Component ${cmp.name} (${cmp.kind})`,
          parameters,
          schema: {
            title: `SPICE Component: ${cmp.name}`,
            tabs: [
              {
                id: "general",
                label: "Parameters",
                groups: [{ id: "main", label: "Attributes", fields }],
              },
            ],
          },
          values,
        };
      } catch {
        return null;
      }
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      return { seq: params.seq, edits: [], renderHint: "none" };
    },

    async getPalette(): Promise<DiagramPalette> {
      return {
        categories: [
          {
            name: "Passive Components",
            items: [
              { className: "R", label: "Resistor (R)", description: "Two-terminal resistor" },
              { className: "C", label: "Capacitor (C)", description: "Two-terminal capacitor" },
              { className: "L", label: "Inductor (L)", description: "Two-terminal inductor" },
            ],
          },
          {
            name: "Semiconductors",
            items: [
              { className: "D", label: "Diode (D)", description: "PN junction diode" },
              { className: "Q", label: "BJT (Q)", description: "Bipolar junction transistor (NPN/PNP)" },
              { className: "M", label: "MOSFET (M)", description: "Metal-oxide FET (NMOS/PMOS)" },
            ],
          },
          {
            name: "Sources",
            items: [
              { className: "V", label: "Voltage Source (V)", description: "Independent voltage source" },
              { className: "I", label: "Current Source (I)", description: "Independent current source" },
            ],
          },
          {
            name: "Subcircuits & ICs",
            items: [{ className: "X", label: "Subcircuit (X)", description: "Subcircuit instance (.SUBCKT)" }],
          },
        ],
      };
    },
  };
}
