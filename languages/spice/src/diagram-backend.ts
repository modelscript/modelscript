// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  deduplicateAndSort,
  getHostDocumentText,
  type ComponentPropertyData,
  type DiagramApplyEditsParams,
  type DiagramApplyEditsResult,
  type DiagramBackend,
  type DiagramBackendHost,
  type DiagramData,
  type DiagramGetComponentPropertiesParams,
  type DiagramGetDataParams,
  type DiagramPalette,
  type PropertyFieldConfig,
  type DiagramTextEdit as TextEdit,
} from "@modelscript/diagram/protocol";
import { CstDocumentSession, CstSessionCache, CstTransaction, type CstTextEdit } from "@modelscript/dsl/unparser";

interface SpiceLineSpan {
  startOffset: number;
  endOffset: number;
  eolEndOffset: number;
  text: string;
  bodyEndOffset: number;
  commentStartOffset: number;
  tokens: Array<{ text: string; startOffset: number; endOffset: number }>;
}

function indexSpiceLines(source: string): SpiceLineSpan[] {
  const out: SpiceLineSpan[] = [];
  let pos = 0;
  while (pos <= source.length) {
    const nl = source.indexOf("\n", pos);
    const rawEnd = nl === -1 ? source.length : nl;
    const lineEnd = rawEnd > pos && source[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
    const eolEnd = nl === -1 ? source.length : nl + 1;
    const text = source.slice(pos, lineEnd);
    const semiIdx = text.indexOf(";");
    const bodyEndOffset = semiIdx !== -1 ? pos + semiIdx : lineEnd;
    const commentStartOffset = semiIdx !== -1 ? pos + semiIdx : -1;

    const tokens: Array<{ text: string; startOffset: number; endOffset: number }> = [];
    const trimmed = text.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("*") && !trimmed.startsWith(".")) {
      let i = pos;
      while (i < bodyEndOffset) {
        while (i < bodyEndOffset && (source[i] === " " || source[i] === "\t")) i++;
        if (i >= bodyEndOffset) break;
        const tStart = i;
        while (i < bodyEndOffset && source[i] !== " " && source[i] !== "\t") i++;
        tokens.push({ text: source.slice(tStart, i), startOffset: tStart, endOffset: i });
      }
    }

    out.push({
      startOffset: pos,
      endOffset: lineEnd,
      eolEndOffset: eolEnd,
      text,
      bodyEndOffset,
      commentStartOffset,
      tokens,
    });
    if (nl === -1) break;
    pos = nl + 1;
  }
  return out;
}

/**
 * Surgical transaction-backed SPICE diagram edit planner operating directly on a live
 * {@link CstDocumentSession}. Emits exact token-level `CstTextEdit[]` without line-array
 * re-serialization or whole-file diffing; untouched lines and comments stay verbatim.
 */
export function planSpiceEditsOnSession(
  session: CstDocumentSession,
  actions: ReadonlyArray<DiagramApplyEditsParams["actions"][number]>,
  pinCountLookup?: ReadonlyMap<string, number>,
): { edits: CstTextEdit[]; hasStructural: boolean } {
  const text = session.text;
  const lineSpans = indexSpiceLines(text);
  const tx = new CstTransaction(session);
  let hasStructural = false;

  const stripCmp = (n: string): string => (n.startsWith("comp_") ? n.slice(5) : n.startsWith("cmp_") ? n.slice(4) : n);
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
  const findCompLine = (compName: string): SpiceLineSpan | undefined => {
    const target = compName.toLowerCase();
    return lineSpans.find((l) => l.tokens[0]?.text.toLowerCase() === target);
  };
  const getPinCount = (compName: string, tokens: SpiceLineSpan["tokens"]): number => {
    const known = pinCountLookup?.get(compName.toLowerCase());
    if (known !== undefined && known > 0) return known;
    const prefix = compName[0]?.toUpperCase() ?? "";
    if (prefix === "M") return Math.min(4, Math.max(2, tokens.length - 2));
    if (prefix === "Q") return Math.min(3, Math.max(2, tokens.length - 2));
    return Math.min(2, Math.max(1, tokens.length - 2));
  };

  let allocatedNetNum = 0;
  for (const l of lineSpans) {
    for (let i = 1; i < l.tokens.length; i++) {
      const tok = l.tokens[i]?.text;
      if (!tok) continue;
      const m = /^(\d+)$/.exec(tok) || /^n(\d+)$/i.exec(tok);
      if (m) allocatedNetNum = Math.max(allocatedNetNum, Number(m[1]));
    }
  }
  const allocateNextNet = (): string => `n${++allocatedNetNum}`;

  // Track in-flight pin-net mutations within one batch so reconnect sees updated nets cleanly
  const pinNetOverrides = new Map<string, string>();
  const pinKey = (comp: string, pin: number) => `${comp.toLowerCase()}#${pin}`;

  const getPinToken = (compName: string, pinIdx: number) => {
    const line = findCompLine(compName);
    if (!line) return null;
    const pinCount = getPinCount(compName, line.tokens);
    const clampedPin = Math.max(0, Math.min(pinIdx, Math.max(0, pinCount - 1)));
    const tok = line.tokens[1 + clampedPin];
    if (!tok) return null;
    const current = pinNetOverrides.get(pinKey(compName, clampedPin)) ?? tok.text;
    return { tok, clampedPin, current };
  };

  const setCompPinNet = (compName: string, pinIdx: number, nextNet: string): void => {
    const info = getPinToken(compName, pinIdx);
    if (!info || info.current === nextNet) return;
    pinNetOverrides.set(pinKey(compName, info.clampedPin), nextNet);
    tx.replaceRange(info.tok.startOffset, info.tok.endOffset, nextNet);
  };

  for (const action of actions) {
    if (action.type === "move") {
      for (const item of action.items) {
        const line = findCompLine(stripCmp(item.name));
        if (!line) continue;
        const tag = `@pos(${Math.round(item.x)}, ${Math.round(item.y)})`;
        const existingPos = /@pos\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/i.exec(line.text);
        if (existingPos) {
          tx.replaceRange(
            line.startOffset + existingPos.index,
            line.startOffset + existingPos.index + existingPos[0].length,
            tag,
          );
        } else {
          let trimEnd = line.endOffset;
          while (trimEnd > line.startOffset && (text[trimEnd - 1] === " " || text[trimEnd - 1] === "\t")) trimEnd--;
          tx.replaceRange(trimEnd, line.endOffset, line.commentStartOffset !== -1 ? ` ${tag}` : ` ; ${tag}`);
        }
      }
    } else if (action.type === "deleteComponents") {
      const toDelete = new Set(action.names.map((n) => stripCmp(n).toLowerCase()));
      for (const line of lineSpans) {
        const name = line.tokens[0]?.text.toLowerCase();
        if (name && toDelete.has(name)) {
          tx.deleteRange(line.startOffset, line.eolEndOffset);
          hasStructural = true;
        }
      }
    } else if (action.type === "connect") {
      const src = stripPortRef(action.source);
      const tgt = stripPortRef(action.target);
      const srcPin = parsePinIdx(action.sourcePort, src.pin);
      const tgtPin = parsePinIdx(action.targetPort, tgt.pin);
      const srcInfo = getPinToken(src.comp, srcPin);
      const tgtInfo = getPinToken(tgt.comp, tgtPin);
      if (srcInfo && tgtInfo) {
        const isNamedNet = (n: string) => n !== "0" && !n.startsWith("nc_");
        const sharedNet = isNamedNet(srcInfo.current)
          ? srcInfo.current
          : isNamedNet(tgtInfo.current)
            ? tgtInfo.current
            : allocateNextNet();
        setCompPinNet(src.comp, srcPin, sharedNet);
        setCompPinNet(tgt.comp, tgtPin, sharedNet);
        hasStructural = true;
      }
    } else if (action.type === "disconnect") {
      const src = stripPortRef(action.source);
      const tgt = stripPortRef(action.target);
      const srcPin = parsePinIdx(action.sourcePort, src.pin);
      const tgtPin = parsePinIdx(action.targetPort, tgt.pin);
      const srcInfo = getPinToken(src.comp, srcPin);
      const tgtInfo = getPinToken(tgt.comp, tgtPin);
      if (srcInfo && tgtInfo && srcInfo.current === tgtInfo.current) {
        setCompPinNet(tgt.comp, tgtPin, `nc_${tgt.comp}_${tgtPin + 1}`);
        hasStructural = true;
      }
    } else if (action.type === "reconnect") {
      const oldSrc = stripPortRef(action.oldSource);
      const oldTgt = stripPortRef(action.oldTarget);
      const oldSrcPin = parsePinIdx(action.oldSourcePort, oldSrc.pin);
      const oldTgtPin = parsePinIdx(action.oldTargetPort, oldTgt.pin);
      const oldSrcInfo = getPinToken(oldSrc.comp, oldSrcPin);
      const oldTgtInfo = getPinToken(oldTgt.comp, oldTgtPin);
      if (oldSrcInfo && oldTgtInfo && oldSrcInfo.current === oldTgtInfo.current) {
        setCompPinNet(oldTgt.comp, oldTgtPin, `nc_${oldTgt.comp}_${oldTgtPin + 1}`);
        hasStructural = true;
      }
      const newSrc = stripPortRef(action.newSource);
      const newTgt = stripPortRef(action.newTarget);
      const newSrcPin = parsePinIdx(action.newSourcePort, newSrc.pin);
      const newTgtPin = parsePinIdx(action.newTargetPort, newTgt.pin);
      const newSrcInfo = getPinToken(newSrc.comp, newSrcPin);
      const newTgtInfo = getPinToken(newTgt.comp, newTgtPin);
      if (newSrcInfo && newTgtInfo) {
        const isNamedNet = (n: string) => n !== "0" && !n.startsWith("nc_");
        const sharedNet = isNamedNet(newSrcInfo.current)
          ? newSrcInfo.current
          : isNamedNet(newTgtInfo.current)
            ? newTgtInfo.current
            : allocateNextNet();
        setCompPinNet(newSrc.comp, newSrcPin, sharedNet);
        setCompPinNet(newTgt.comp, newTgtPin, sharedNet);
        hasStructural = true;
      }
    } else if (action.type === "updateName") {
      const oldN = stripCmp(action.oldName);
      const newN = stripCmp(action.newName);
      const line = findCompLine(oldN);
      if (line && line.tokens[0]) {
        tx.replaceRange(line.tokens[0].startOffset, line.tokens[0].endOffset, newN);
        hasStructural = true;
      }
    } else if (action.type === "updateParameter" || action.type === "updateProperty") {
      const compName = stripCmp(action.name);
      const key = action.type === "updateParameter" ? action.parameter : action.key;
      const valStr = String(action.value ?? "").trim();
      const line = findCompLine(compName);
      if (line && valStr) {
        const keyLower = key.toLowerCase();
        const kvTok = line.tokens.find((t) => {
          const eq = t.text.indexOf("=");
          return eq > 0 && t.text.slice(0, eq).toLowerCase() === keyLower;
        });
        if (kvTok) {
          const eq = kvTok.text.indexOf("=");
          tx.replaceRange(kvTok.startOffset + eq + 1, kvTok.endOffset, valStr);
        } else if (keyLower === "value" || keyLower === "model") {
          let valIdx = line.tokens.length - 1;
          while (valIdx > 1 && line.tokens[valIdx]?.text.includes("=")) valIdx--;
          const targetTok = valIdx >= 2 ? line.tokens[valIdx] : undefined;
          if (targetTok) {
            tx.replaceRange(targetTok.startOffset, targetTok.endOffset, valStr);
          }
        } else {
          let insertAt = line.bodyEndOffset;
          while (insertAt > line.startOffset && (text[insertAt - 1] === " " || text[insertAt - 1] === "\t")) {
            insertAt--;
          }
          tx.insertAt(insertAt, ` ${key}=${valStr}`);
        }
      }
    } else if (action.type === "addComponent") {
      const rawCls = action.className.trim();
      const short = (
        rawCls.includes(":")
          ? rawCls.slice(rawCls.lastIndexOf(":") + 1)
          : rawCls.includes(".")
            ? rawCls.slice(rawCls.lastIndexOf(".") + 1)
            : rawCls
      ).toUpperCase();
      const nativeMap: Record<string, { prefix: string; defaultVal: string }> = {
        R: { prefix: "R", defaultVal: "1k" },
        RESISTOR: { prefix: "R", defaultVal: "1k" },
        C: { prefix: "C", defaultVal: "1u" },
        CAPACITOR: { prefix: "C", defaultVal: "1u" },
        L: { prefix: "L", defaultVal: "1m" },
        INDUCTOR: { prefix: "L", defaultVal: "1m" },
        V: { prefix: "V", defaultVal: "DC 5" },
        VOLTAGESOURCE: { prefix: "V", defaultVal: "DC 5" },
        I: { prefix: "I", defaultVal: "DC 1m" },
        CURRENTSOURCE: { prefix: "I", defaultVal: "DC 1m" },
      };
      const spec = nativeMap[short];
      if (spec) {
        let idx = 1;
        let devName = action.name?.trim() || `${spec.prefix}${idx}`;
        if (!action.name?.trim()) {
          while (findCompLine(devName)) {
            idx++;
            devName = `${spec.prefix}${idx}`;
          }
        }
        const posSuffix =
          typeof action.x === "number" &&
          Number.isFinite(action.x) &&
          typeof action.y === "number" &&
          Number.isFinite(action.y)
            ? ` ; @pos(${Math.round(action.x)}, ${Math.round(action.y)})`
            : "";
        const endLine = lineSpans.find((l) => l.tokens[0]?.text.toUpperCase() === ".END");
        const insertOffset = endLine ? endLine.startOffset : text.length;
        const prefixNl = !endLine && text.length > 0 && !text.endsWith("\n") ? "\n" : "";
        tx.insertAt(insertOffset, `${prefixNl}${devName} 0 0 ${spec.defaultVal}${posSuffix}\n`);
        hasStructural = true;
      }
    }
  }

  return { edits: tx.commit().edits, hasStructural };
}

function getUnifiedIndexFromDeps(backends: DiagramBackendHost): unknown {
  return (
    backends.getUnifiedIndex?.() ??
    backends.generic?.deps?.getUnifiedIndex?.() ??
    backends.modelica?.deps?.getUnifiedIndex?.()
  );
}

export function createSpiceDiagramBackend(backends: DiagramBackendHost): DiagramBackend {
  const sessionCache = new CstSessionCache(16);
  const createDropBatchState = () => backends.crossLanguageDrop?.createDropBatchState?.() ?? {};
  const mergeCoincidentInsertEdits = (edits: TextEdit[]) =>
    backends.crossLanguageDrop?.mergeCoincidentInsertEdits?.(edits) ?? edits;
  const computeSpiceComponentDropEdits = (opts: Record<string, unknown>): TextEdit[] =>
    backends.crossLanguageDrop?.computeSpiceComponentDropEdits?.(opts) ?? [];

  const readSpiceSource = async (targetUri: string): Promise<string | null> => {
    const memText = getHostDocumentText(backends, targetUri);
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

  const formatSpiceDiagramData = (
    rawDiagram: { cells: Array<{ shape?: string }>; title?: string },
    meta?: Record<string, unknown>,
  ): DiagramData => {
    const nodes = rawDiagram.cells.filter((c) => c.shape !== "edge");
    const edges = rawDiagram.cells.filter((c) => c.shape === "edge");
    return {
      nodes,
      edges,
      coordinateSystem: null,
      diagramBackground: null,
      cells: rawDiagram.cells,
      metadata: { title: rawDiagram.title, ...(meta ?? {}) },
    } as unknown as DiagramData;
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
        const values: Record<string, unknown> = {
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
          const pEntries: [string, unknown][] =
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
        if (text === null || text === undefined) return { seq: params.seq, edits: [], renderHint: "none" };
        const unifiedIndex = getUnifiedIndexFromDeps(backends);
        const batchState = createDropBatchState();
        const addEdits: TextEdit[] = [];
        const nonAddActions: DiagramApplyEditsParams["actions"] = [];
        let hasStructural = false;

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
          } else {
            nonAddActions.push(action);
          }
        }

        const allEdits: TextEdit[] = [...addEdits];
        if (nonAddActions.length > 0) {
          let pinCountLookup: Map<string, number> | undefined;
          if (nonAddActions.some((a) => a.type === "connect" || a.type === "disconnect" || a.type === "reconnect")) {
            try {
              const { parseSpice } = await import("@modelscript/spice");
              const ckt = parseSpice(text);
              pinCountLookup = new Map(ckt.components.map((c) => [c.name.toLowerCase(), c.nodes.length]));
            } catch {
              // ignore parse failure; use prefix fallback
            }
          }
          const session = sessionCache.getOrUpdate(
            params.uri,
            text,
            () => new CstDocumentSession({ uri: params.uri, text }),
          );
          const planned = planSpiceEditsOnSession(session, nonAddActions, pinCountLookup);
          allEdits.push(...planned.edits);
          if (planned.hasStructural) hasStructural = true;
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
