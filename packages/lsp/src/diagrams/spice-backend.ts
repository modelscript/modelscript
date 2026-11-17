// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TextEdit } from "vscode-languageserver";
import {
  computeSpiceComponentDropEdits,
  createDropBatchState,
  mergeCoincidentInsertEdits,
} from "../cross-language-drop.js";
import {
  deduplicateAndSort,
  getUnifiedIndexFromDeps,
  type DiagramBackend,
  type DiagramDispatchDeps,
} from "../diagramApi.js";
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
        const posByComp = new Map<string, { x: number; y: number }>();
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith(".")) continue;
          const m = /;\s*@pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i.exec(trimmed);
          if (m) {
            const compName = trimmed.split(/\s+/)[0]?.toLowerCase();
            if (compName) {
              posByComp.set(compName, { x: Number(m[1]), y: Number(m[2]) });
            }
          }
        }
        if (posByComp.size > 0 && Array.isArray(rawDiagram?.cells)) {
          for (const cell of rawDiagram.cells) {
            if (cell.shape === "edge") continue;
            const id = String(cell.id ?? "");
            const clean = (id.startsWith("cmp_") ? id.slice(4) : id).toLowerCase();
            const pos = posByComp.get(clean);
            if (pos) {
              cell.x = pos.x;
              cell.y = pos.y;
            }
          }
        }
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
      try {
        const text = await readSpiceSource(params.uri);
        if (!text) return { seq: params.seq, edits: [], renderHint: "none" };
        const unifiedIndex = getUnifiedIndexFromDeps(backends);
        const batchState = createDropBatchState();
        const addEdits: TextEdit[] = [];
        const lines = text.split(/\r?\n/);
        let hasStructural = false;
        let textMutated = false;

        const stripCmp = (n: string): string => (n.startsWith("cmp_") ? n.slice(4) : n);
        const findCompLineIdx = (compName: string): number => {
          const target = compName.toLowerCase();
          return lines.findIndex((l) => {
            const t = l.trim();
            if (!t || t.startsWith("*") || t.startsWith(".")) return false;
            return t.split(/\s+/)[0]?.toLowerCase() === target;
          });
        };
        const upsertPosOnLine = (line: string, x: number, y: number): string => {
          const tag = `@pos(${Math.round(x)}, ${Math.round(y)})`;
          if (/@pos\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/i.test(line)) {
            return line.replace(/@pos\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/i, tag);
          }
          const semiIdx = line.indexOf(";");
          if (semiIdx !== -1) {
            return `${line.trimEnd()} ${tag}`;
          }
          return `${line.trimEnd()} ; ${tag}`;
        };

        for (const action of params.actions) {
          if (action.type === "addComponent") {
            const edits = computeSpiceComponentDropEdits({
              docText: text,
              rawClassName: action.className,
              instanceName: action.name,
              unifiedIndex,
              batchState,
            });
            addEdits.push(...edits);
            if (edits.length > 0) hasStructural = true;
          } else if (action.type === "move") {
            for (const item of action.items) {
              const idx = findCompLineIdx(stripCmp(item.name));
              if (idx !== -1) {
                lines[idx] = upsertPosOnLine(lines[idx]!, item.x, item.y);
                textMutated = true;
              }
            }
          } else if (action.type === "deleteComponents") {
            const toDelete = new Set(action.names.map((n) => stripCmp(n).toLowerCase()));
            for (let i = lines.length - 1; i >= 0; i--) {
              const t = lines[i]!.trim();
              if (!t || t.startsWith("*") || t.startsWith(".")) continue;
              const name = t.split(/\s+/)[0]?.toLowerCase();
              if (name && toDelete.has(name)) {
                lines.splice(i, 1);
                textMutated = true;
                hasStructural = true;
              }
            }
          } else if (action.type === "updateName") {
            const oldN = stripCmp(action.oldName);
            const newN = stripCmp(action.newName);
            const idx = findCompLineIdx(oldN);
            if (idx !== -1) {
              lines[idx] = lines[idx]!.replace(
                new RegExp(`^(\\s*)${oldN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b)`),
                `$1${newN}$2`,
              );
              textMutated = true;
              hasStructural = true;
            }
          } else if (action.type === "updateParameter" || action.type === "updateProperty") {
            const compName = stripCmp(action.name);
            const key = action.type === "updateParameter" ? action.parameter : action.key;
            const valStr = String(action.value ?? "").trim();
            const idx = findCompLineIdx(compName);
            if (idx !== -1 && valStr) {
              const line = lines[idx]!;
              const semiIdx = line.indexOf(";");
              const body = semiIdx !== -1 ? line.slice(0, semiIdx).trimEnd() : line.trimEnd();
              const comment = semiIdx !== -1 ? ` ${line.slice(semiIdx)}` : "";
              const escKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const paramRe = new RegExp(`(\\b${escKey}\\s*=\\s*)([^\\s;]+)`, "i");
              if (paramRe.test(body)) {
                lines[idx] = body.replace(paramRe, `$1${valStr}`) + comment;
                textMutated = true;
              } else if (key.toLowerCase() === "value" || key.toLowerCase() === "model") {
                const tokens = body.trim().split(/\s+/);
                // Replace the last non-key=val positional token (after component name and nodes)
                let valIdx = tokens.length - 1;
                while (valIdx > 1 && tokens[valIdx]!.includes("=")) valIdx--;
                if (valIdx >= 2) {
                  tokens[valIdx] = valStr;
                  lines[idx] = tokens.join(" ") + comment;
                  textMutated = true;
                }
              } else {
                lines[idx] = `${body} ${key}=${valStr}${comment}`;
                textMutated = true;
              }
            }
          }
        }

        const allEdits: TextEdit[] = [...addEdits];
        if (textMutated) {
          const origLines = text.split(/\r?\n/);
          const lastLine = Math.max(0, origLines.length - 1);
          const lastChar = origLines[lastLine]?.length ?? 0;
          allEdits.push({
            range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: lastChar } },
            newText: lines.join("\n"),
          });
        }

        return {
          seq: params.seq,
          edits: deduplicateAndSort(mergeCoincidentInsertEdits(allEdits)),
          renderHint: hasStructural ? "immediate" : "none",
        };
      } catch {
        return { seq: params.seq, edits: [], renderHint: "none" };
      }
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
