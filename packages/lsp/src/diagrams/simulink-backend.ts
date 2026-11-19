// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TextEdit } from "vscode-languageserver";
import {
  computeSimulinkComponentDropEdits,
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
  DiagramDrillDownParams,
  DiagramDrillDownResult,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramPalette,
  PropertyFieldConfig,
} from "../diagramProtocol.js";

export function createSimulinkDiagramBackend(backends: DiagramDispatchDeps): DiagramBackend {
  const readSimulinkSource = async (targetUri: string): Promise<string | Buffer | null> => {
    const memText =
      (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
      (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
    if (typeof memText === "string") return memText;
    try {
      const fs = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
      if (fs.existsSync(filePath)) {
        if (filePath.endsWith(".slx")) {
          return fs.readFileSync(filePath);
        }
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      // ignore fs errors
    }
    return null;
  };

  const getSystemBlocks = (sys: any): any[] => {
    if (!sys || !sys.blocks) return [];
    if (Array.isArray(sys.blocks)) return sys.blocks;
    if (sys.blocks instanceof Map) return Array.from(sys.blocks.values());
    if (typeof sys.blocks === "object") return Object.values(sys.blocks);
    return [];
  };

  const formatSimulinkDiagramData = (rawDiagram: any, meta?: Record<string, any>): DiagramData => {
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
        const raw = await readSimulinkSource(params.uri);
        if (!raw) return null;
        const { parseSimulink, buildSimulinkDiagram } = await import("@modelscript/simulink");
        const model = parseSimulink(raw, params.uri);
        let targetSystem: any = model.rootSystem;
        if (params.className && model.rootSystem) {
          const findSubsystem = (sys: any, name: string): any => {
            const blks = getSystemBlocks(sys);
            for (const b of blks) {
              if (b.name === name && b.subsystem) return b.subsystem;
              if (b.subsystem) {
                const sub = findSubsystem(b.subsystem, name);
                if (sub) return sub;
              }
            }
            return null;
          };
          const found = findSubsystem(model.rootSystem, params.className);
          if (found) targetSystem = found;
        }
        const rawDiagram = buildSimulinkDiagram(targetSystem);
        return formatSimulinkDiagramData(rawDiagram, { solver: model.solver, version: model.version });
      } catch {
        return null;
      }
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      try {
        const raw = await readSimulinkSource(params.uri);
        if (!raw) return null;
        const { parseSimulink } = await import("@modelscript/simulink");
        const model = parseSimulink(raw, params.uri);

        const findBlock = (sys: any, name: string): any => {
          const blks = getSystemBlocks(sys);
          for (const b of blks) {
            const bId = b.name || b.id;
            if (bId === name || `block_${bId}` === name) return b;
            if (b.subsystem) {
              const sub = findBlock(b.subsystem, name);
              if (sub) return sub;
            }
          }
          return null;
        };

        const blk = findBlock(model.rootSystem, params.componentName);
        if (!blk) return null;

        const parameters: ComponentPropertyData["parameters"] = [
          { name: "BlockType", value: blk.type, group: "Configuration" },
        ];
        const fields: PropertyFieldConfig[] = [
          { key: "BlockType", label: "Block Type", kind: "string", defaultValue: blk.type },
        ];
        const values: Record<string, any> = {
          BlockType: blk.type,
        };

        if (blk.parameters) {
          const pEntries: [string, any][] =
            blk.parameters instanceof Map ? Array.from(blk.parameters.entries()) : Object.entries(blk.parameters);
          for (const [k, v] of pEntries) {
            const strVal = String(v);
            parameters.push({
              name: k,
              value: strVal,
              description: `Simulink parameter '${k}'`,
              group: "Parameters",
            });
            fields.push({
              key: k,
              label: k,
              kind: typeof v === "number" ? "number" : "string",
              defaultValue: v,
            });
            values[k] = v;
          }
        }

        return {
          classKind: blk.subsystem ? "subsystem" : "block",
          className: blk.type,
          name: blk.name || blk.id || "Block",
          description: `Simulink ${blk.type} Block (${blk.name || blk.id})`,
          parameters,
          schema: {
            title: `Block: ${blk.name || blk.id}`,
            tabs: [
              {
                id: "general",
                label: "Parameters",
                groups: [{ id: "main", label: "Block Configuration", fields }],
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
        const raw = await readSimulinkSource(params.uri);
        if (typeof raw !== "string") {
          return { seq: params.seq, edits: [], renderHint: "none" };
        }
        // Never touch binary .slx archives
        if (raw.startsWith("PK")) {
          return { seq: params.seq, edits: [], renderHint: "none" };
        }
        // Legacy curly-brace .mdl files support native curly-brace `addComponent` drops,
        // but must not have XML `<P>`/`<Line>` tags injected by XML-mutating actions.
        const isCurlyMdl = !raw.includes("<Block") && !raw.includes("<System") && /^\s*Model\s*\{/m.test(raw);
        const unifiedIndex = getUnifiedIndexFromDeps(backends);
        const batchState = createDropBatchState();
        const addEdits: TextEdit[] = [];
        let workingText = raw;
        let hasStructural = false;

        const stripBlk = (n: string): string => (n.startsWith("block_") ? n.slice(6) : n);
        const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const findBlockRange = (text: string, blockName: string): { start: number; end: number } | null => {
          const openRe = new RegExp(`<Block\\b[^>]*\\bName=["']${escRe(blockName)}["'][^>]*>`, "i");
          const m = openRe.exec(text);
          if (!m) return null;
          if (m[0].endsWith("/>")) return { start: m.index, end: m.index + m[0].length };
          const closeIdx = text.indexOf("</Block>", m.index + m[0].length);
          if (closeIdx === -1) return null;
          return { start: m.index, end: closeIdx + "</Block>".length };
        };
        const upsertBlockParam = (text: string, blockName: string, key: string, value: string): string => {
          const range = findBlockRange(text, blockName);
          if (!range) return text;
          const blockXml = text.slice(range.start, range.end);
          const pRe = new RegExp(`(<P\\b[^>]*\\bName=["']${escRe(key)}["'][^>]*>)([\\s\\S]*?)(</P>)`, "i");
          let nextBlock: string;
          if (pRe.test(blockXml)) {
            nextBlock = blockXml.replace(pRe, `$1${value}$3`);
          } else {
            const closeTag = "</Block>";
            const idx = blockXml.lastIndexOf(closeTag);
            if (idx === -1) return text;
            nextBlock = `${blockXml.slice(0, idx)}  <P Name="${key}">${value}</P>\n${blockXml.slice(idx)}`;
          }
          return text.slice(0, range.start) + nextBlock + text.slice(range.end);
        };
        const insertLineXml = (text: string, src: string, dst: string, srcPort = "1", dstPort = "1"): string => {
          const lineXml = `  <Line>\n    <P Name="SrcBlock">${src}</P>\n    <P Name="SrcPort">${srcPort}</P>\n    <P Name="DstBlock">${dst}</P>\n    <P Name="DstPort">${dstPort}</P>\n  </Line>\n`;
          const sysClose = text.lastIndexOf("</System>");
          if (sysClose === -1) return text;
          return text.slice(0, sysClose) + lineXml + text.slice(sysClose);
        };
        const removeLinesXml = (text: string, matchFn: (lineXml: string) => boolean): string =>
          text.replace(/^[ \t]*<Line\b[\s\S]*?<\/Line>[ \t]*\r?\n?/gim, (m) => (matchFn(m) ? "" : m));

        for (const action of params.actions) {
          if (action.type === "addComponent") {
            const edits = computeSimulinkComponentDropEdits({
              docText: raw,
              rawClassName: action.className,
              x: action.x,
              y: action.y,
              instanceName: action.name,
              section: action.section,
              unifiedIndex,
              batchState,
            });
            addEdits.push(...edits);
            if (edits.length > 0) hasStructural = true;
          } else if (isCurlyMdl) {
            continue;
          } else if (action.type === "move") {
            for (const item of action.items) {
              const name = stripBlk(item.name);
              const x1 = Math.round(item.x);
              const y1 = Math.round(item.y);
              const x2 = Math.round(item.x + (item.width ?? 80));
              const y2 = Math.round(item.y + (item.height ?? 50));
              workingText = upsertBlockParam(workingText, name, "Position", `[${x1}, ${y1}, ${x2}, ${y2}]`);
            }
          } else if (action.type === "resize") {
            const item = action.item;
            const name = stripBlk(item.name);
            const x1 = Math.round(item.x);
            const y1 = Math.round(item.y);
            const x2 = Math.round(item.x + (item.width ?? 80));
            const y2 = Math.round(item.y + (item.height ?? 50));
            workingText = upsertBlockParam(workingText, name, "Position", `[${x1}, ${y1}, ${x2}, ${y2}]`);
          } else if (action.type === "updateParameter") {
            workingText = upsertBlockParam(workingText, stripBlk(action.name), action.parameter, String(action.value));
          } else if (action.type === "updateProperty") {
            workingText = upsertBlockParam(workingText, stripBlk(action.name), action.key, String(action.value ?? ""));
          } else if (action.type === "updateName") {
            const oldN = stripBlk(action.oldName);
            const newN = stripBlk(action.newName);
            const range = findBlockRange(workingText, oldN);
            if (range) {
              const blockXml = workingText.slice(range.start, range.end);
              const renamedBlock = blockXml.replace(
                new RegExp(`(\\bName=["'])${escRe(oldN)}(["'])`, "i"),
                `$1${newN}$2`,
              );
              workingText = workingText.slice(0, range.start) + renamedBlock + workingText.slice(range.end);
              workingText = workingText.replace(
                new RegExp(`(<P\\b[^>]*\\bName=["'](?:SrcBlock|DstBlock)["'][^>]*>)${escRe(oldN)}(</P>)`, "gi"),
                `$1${newN}$2`,
              );
              hasStructural = true;
            }
          } else if (action.type === "deleteComponents") {
            for (const rawName of action.names) {
              const name = stripBlk(rawName);
              const range = findBlockRange(workingText, name);
              if (range) {
                let start = range.start;
                while (start > 0 && (workingText[start - 1] === " " || workingText[start - 1] === "\t")) start--;
                let end = range.end;
                if (workingText[end] === "\r") end++;
                if (workingText[end] === "\n") end++;
                workingText = workingText.slice(0, start) + workingText.slice(end);
                hasStructural = true;
              }
              const blkRe = new RegExp(`<P\\b[^>]*\\bName=["'](?:SrcBlock|DstBlock)["'][^>]*>${escRe(name)}</P>`, "i");
              workingText = removeLinesXml(workingText, (lineXml) => blkRe.test(lineXml));
            }
          } else if (action.type === "connect") {
            const src = stripBlk(action.source);
            const dst = stripBlk(action.target);
            const sp = action.sourcePort?.replace(/\D+/g, "") || "1";
            const dp = action.targetPort?.replace(/\D+/g, "") || "1";
            workingText = insertLineXml(workingText, src, dst, sp, dp);
            hasStructural = true;
          } else if (action.type === "disconnect") {
            const src = stripBlk(action.source);
            const dst = stripBlk(action.target);
            const sRe = new RegExp(`<P\\b[^>]*\\bName=["']SrcBlock["'][^>]*>${escRe(src)}</P>`, "i");
            const dRe = new RegExp(`<P\\b[^>]*\\bName=["']DstBlock["'][^>]*>${escRe(dst)}</P>`, "i");
            workingText = removeLinesXml(workingText, (lineXml) => sRe.test(lineXml) && dRe.test(lineXml));
            hasStructural = true;
          } else if (action.type === "reconnect") {
            const oldS = stripBlk(action.oldSource);
            const oldD = stripBlk(action.oldTarget);
            const sRe = new RegExp(`<P\\b[^>]*\\bName=["']SrcBlock["'][^>]*>${escRe(oldS)}</P>`, "i");
            const dRe = new RegExp(`<P\\b[^>]*\\bName=["']DstBlock["'][^>]*>${escRe(oldD)}</P>`, "i");
            workingText = removeLinesXml(workingText, (lineXml) => sRe.test(lineXml) && dRe.test(lineXml));
            const newS = stripBlk(action.newSource);
            const newD = stripBlk(action.newTarget);
            const sp = action.newSourcePort?.replace(/\D+/g, "") || "1";
            const dp = action.newTargetPort?.replace(/\D+/g, "") || "1";
            workingText = insertLineXml(workingText, newS, newD, sp, dp);
            hasStructural = true;
          }
        }

        const allEdits: TextEdit[] = [...addEdits];
        const textEdit = computeMinimalTextEdit(raw, workingText);
        if (textEdit) {
          allEdits.push(textEdit);
        }

        const renderHint: "none" | "immediate" | "debounced" = hasStructural ? "immediate" : "none";
        return {
          seq: params.seq,
          edits: deduplicateAndSort(mergeCoincidentInsertEdits(allEdits)),
          renderHint,
        };
      } catch {
        return { seq: params.seq, edits: [], renderHint: "none" };
      }
    },

    async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
      try {
        const raw = await readSimulinkSource(params.uri);
        if (!raw) return null;
        const { parseSimulink, buildSimulinkDiagram } = await import("@modelscript/simulink");
        const model = parseSimulink(raw, params.uri);
        const targetName = params.className || params.componentName || params.nodeId || "";
        const cleanName = targetName.startsWith("block_") ? targetName.slice(6) : targetName;

        const findSubsystem = (sys: any, name: string): { sys: any; path: string[] } | null => {
          const blks = getSystemBlocks(sys);
          for (const b of blks) {
            const bId = b.name || b.id;
            if ((bId === name || b.name === name) && b.subsystem) {
              return { sys: b.subsystem, path: [model.rootSystem.name || "Root", b.name] };
            }
            if (b.subsystem) {
              const res = findSubsystem(b.subsystem, name);
              if (res) return { sys: res.sys, path: [model.rootSystem.name || "Root", b.name, ...res.path.slice(1)] };
            }
          }
          return null;
        };

        const found = findSubsystem(model.rootSystem, cleanName);
        if (!found) return null;
        const rawDiagram = buildSimulinkDiagram(found.sys);
        return {
          data: formatSimulinkDiagramData(rawDiagram),
          breadcrumbs: found.path.map((p) => ({ id: p, label: p, uri: params.uri })),
          targetUri: params.uri,
          targetClassName: cleanName,
        };
      } catch {
        return null;
      }
    },

    async getPalette(): Promise<DiagramPalette> {
      return {
        categories: [
          {
            name: "Math Operations",
            items: [
              { className: "Gain", label: "Gain", description: "Multiply input by constant factor" },
              { className: "Sum", label: "Sum", description: "Add or subtract signals" },
              { className: "Product", label: "Product", description: "Multiply or divide signals" },
              { className: "Abs", label: "Abs", description: "Absolute value" },
              {
                className: "MathFunction",
                label: "Math Function",
                description: "Mathematical functions (exp, log, sqrt)",
              },
            ],
          },
          {
            name: "Continuous",
            items: [
              { className: "Integrator", label: "Integrator", description: "Continuous-time integration 1/s" },
              { className: "Derivative", label: "Derivative", description: "Continuous-time derivative du/dt" },
              {
                className: "TransferFcn",
                label: "Transfer Fcn",
                description: "Linear continuous transfer function num(s)/den(s)",
              },
              {
                className: "StateSpace",
                label: "State-Space",
                description: "Linear state-space system dx/dt = Ax + Bu",
              },
            ],
          },
          {
            name: "Discrete",
            items: [
              { className: "UnitDelay", label: "Unit Delay", description: "Delay signal by 1 sample z^-1" },
              {
                className: "DiscreteIntegrator",
                label: "Discrete-Time Integrator",
                description: "Discrete integration",
              },
            ],
          },
          {
            name: "Sources",
            items: [
              { className: "Constant", label: "Constant", description: "Generate constant value" },
              { className: "Step", label: "Step", description: "Step signal output" },
              { className: "Sine", label: "Sine Wave", description: "Sinusoidal signal generator" },
              { className: "Inport", label: "Inport", description: "Subsystem signal input port" },
            ],
          },
          {
            name: "Sinks",
            items: [
              { className: "Scope", label: "Scope", description: "Display signal in time domain" },
              { className: "Outport", label: "Outport", description: "Subsystem signal output port" },
              { className: "Terminator", label: "Terminator", description: "Terminate unconnected signal" },
            ],
          },
        ],
      };
    },
  };
}
