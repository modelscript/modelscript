// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TextEdit } from "vscode-languageserver";
import {
  computeSpiceComponentDropEdits,
  createDropBatchState,
  mergeCoincidentInsertEdits,
} from "../cross-language-drop.js";
import {
  computeMinimalTextEdit,
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
            const clean = (
              id.startsWith("comp_") ? id.slice(5) : id.startsWith("cmp_") ? id.slice(4) : id
            ).toLowerCase();
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
        const cleanName = rawName.startsWith("comp_")
          ? rawName.slice(5)
          : rawName.startsWith("cmp_")
            ? rawName.slice(4)
            : rawName;
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
        const eol = text.includes("\r\n") ? "\r\n" : "\n";
        const addEdits: TextEdit[] = [];
        const lines = text.split(/\r?\n/);
        let hasStructural = false;
        let textMutated = false;

        const stripCmp = (n: string): string =>
          n.startsWith("comp_") ? n.slice(5) : n.startsWith("cmp_") ? n.slice(4) : n;
        const stripPortRef = (rawRef: string): { comp: string; pin: number } => {
          const parts = rawRef.split(":");
          const comp = stripCmp(parts[0] ?? rawRef);
          const m = /(\d+)/.exec(parts[1] ?? "");
          return { comp, pin: m ? Number(m[1]) : 0 };
        };
        const parsePinIdx = (port?: string, fallbackPin = 0): number => {
          if (!port) return fallbackPin;
          const m = /(\d+)/.exec(port);
          return m ? Number(m[1]) : fallbackPin;
        };
        const findCompLineIdx = (compName: string): number => {
          const target = compName.toLowerCase();
          return lines.findIndex((l) => {
            const t = l.trim();
            if (!t || t.startsWith("*") || t.startsWith(".")) return false;
            return t.split(/\s+/)[0]?.toLowerCase() === target;
          });
        };
        const splitBodyComment = (line: string): { body: string; comment: string } => {
          const semiIdx = line.indexOf(";");
          return {
            body: semiIdx !== -1 ? line.slice(0, semiIdx).trimEnd() : line.trimEnd(),
            comment: semiIdx !== -1 ? ` ${line.slice(semiIdx)}` : "",
          };
        };
        let pinCountByComp: Map<string, number> | null = null;
        const getPinCount = async (compName: string, tokens: string[]): Promise<number> => {
          if (!pinCountByComp) {
            pinCountByComp = new Map();
            try {
              const { parseSpice } = await import("@modelscript/spice");
              const ckt = parseSpice(text);
              for (const cmp of ckt.components) {
                pinCountByComp.set(cmp.name.toLowerCase(), cmp.nodes.length);
              }
            } catch {
              // ignore parse failure; use fallback
            }
          }
          const known = pinCountByComp.get(compName.toLowerCase());
          if (known !== undefined && known > 0) return known;
          const prefix = compName[0]?.toUpperCase() ?? "";
          if (prefix === "M") return Math.min(4, Math.max(2, tokens.length - 2));
          if (prefix === "Q") return Math.min(3, Math.max(2, tokens.length - 2));
          return Math.min(2, Math.max(1, tokens.length - 2));
        };
        const allocateNextNet = (): string => {
          let maxN = 0;
          for (const l of lines) {
            const t = l.trim();
            if (!t || t.startsWith("*") || t.startsWith(".")) continue;
            const { body } = splitBodyComment(t);
            for (const tok of body.split(/\s+/).slice(1)) {
              const m = /^(\d+)$/.exec(tok) || /^n(\d+)$/i.exec(tok);
              if (m) maxN = Math.max(maxN, Number(m[1]));
            }
          }
          return `n${maxN + 1}`;
        };
        const setCompPinNet = async (compName: string, pinIdx: number, nextNet?: string): Promise<string | null> => {
          const idx = findCompLineIdx(compName);
          if (idx === -1) return null;
          const { body, comment } = splitBodyComment(lines[idx]!);
          const tokens = body.trim().split(/\s+/);
          const pinCount = await getPinCount(compName, tokens);
          const clampedPin = Math.max(0, Math.min(pinIdx, Math.max(0, pinCount - 1)));
          const tokIdx = 1 + clampedPin;
          if (tokIdx >= tokens.length) return null;
          const prevNet = tokens[tokIdx]!;
          if (nextNet !== undefined && nextNet !== prevNet) {
            tokens[tokIdx] = nextNet;
            lines[idx] = `${tokens.join(" ")}${comment}`;
            textMutated = true;
          }
          return prevNet;
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
          } else if (action.type === "connect") {
            const src = stripPortRef(action.source);
            const tgt = stripPortRef(action.target);
            const srcPin = parsePinIdx(action.sourcePort, src.pin);
            const tgtPin = parsePinIdx(action.targetPort, tgt.pin);
            const srcNet = await setCompPinNet(src.comp, srcPin);
            const tgtNet = await setCompPinNet(tgt.comp, tgtPin);
            if (srcNet !== null && tgtNet !== null) {
              const isNamedNet = (n: string) => n !== "0" && !n.startsWith("nc_");
              const sharedNet = isNamedNet(srcNet) ? srcNet : isNamedNet(tgtNet) ? tgtNet : allocateNextNet();
              await setCompPinNet(src.comp, srcPin, sharedNet);
              await setCompPinNet(tgt.comp, tgtPin, sharedNet);
              hasStructural = true;
            }
          } else if (action.type === "disconnect") {
            const src = stripPortRef(action.source);
            const tgt = stripPortRef(action.target);
            const srcPin = parsePinIdx(action.sourcePort, src.pin);
            const tgtPin = parsePinIdx(action.targetPort, tgt.pin);
            const srcNet = await setCompPinNet(src.comp, srcPin);
            const tgtNet = await setCompPinNet(tgt.comp, tgtPin);
            if (srcNet !== null && tgtNet !== null && srcNet === tgtNet) {
              await setCompPinNet(tgt.comp, tgtPin, `nc_${tgt.comp}_${tgtPin + 1}`);
              hasStructural = true;
            }
          } else if (action.type === "reconnect") {
            const oldSrc = stripPortRef(action.oldSource);
            const oldTgt = stripPortRef(action.oldTarget);
            const oldSrcPin = parsePinIdx(action.oldSourcePort, oldSrc.pin);
            const oldTgtPin = parsePinIdx(action.oldTargetPort, oldTgt.pin);
            const oldSrcNet = await setCompPinNet(oldSrc.comp, oldSrcPin);
            const oldTgtNet = await setCompPinNet(oldTgt.comp, oldTgtPin);
            if (oldSrcNet !== null && oldTgtNet !== null && oldSrcNet === oldTgtNet) {
              await setCompPinNet(oldTgt.comp, oldTgtPin, `nc_${oldTgt.comp}_${oldTgtPin + 1}`);
              hasStructural = true;
            }
            const newSrc = stripPortRef(action.newSource);
            const newTgt = stripPortRef(action.newTarget);
            const newSrcPin = parsePinIdx(action.newSourcePort, newSrc.pin);
            const newTgtPin = parsePinIdx(action.newTargetPort, newTgt.pin);
            const newSrcNet = await setCompPinNet(newSrc.comp, newSrcPin);
            const newTgtNet = await setCompPinNet(newTgt.comp, newTgtPin);
            if (newSrcNet !== null && newTgtNet !== null) {
              const isNamedNet = (n: string) => n !== "0" && !n.startsWith("nc_");
              const sharedNet = isNamedNet(newSrcNet)
                ? newSrcNet
                : isNamedNet(newTgtNet)
                  ? newTgtNet
                  : allocateNextNet();
              await setCompPinNet(newSrc.comp, newSrcPin, sharedNet);
              await setCompPinNet(newTgt.comp, newTgtPin, sharedNet);
              hasStructural = true;
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
              const { body, comment } = splitBodyComment(lines[idx]!);
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
          const textEdit = computeMinimalTextEdit(text, lines.join(eol));
          if (textEdit) {
            allEdits.push(textEdit);
          }
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
