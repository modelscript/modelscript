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
  type DiagramDrillDownParams,
  type DiagramDrillDownResult,
  type DiagramGetComponentPropertiesParams,
  type DiagramGetDataParams,
  type DiagramPalette,
  type PropertyFieldConfig,
  type DiagramTextEdit as TextEdit,
} from "@modelscript/diagram/protocol";
import {
  CstDocumentSession,
  CstSessionCache,
  CstTransaction,
  CstXmlAdapter,
  type CstIncrementalParser,
  type CstTextEdit,
} from "@modelscript/dsl/unparser";
import type { SyntaxNode } from "@modelscript/dsl/utils";
import { getXmlWasmParser } from "@modelscript/dsl/xml";

interface SimulinkBlockLike {
  id?: string;
  name?: string;
  type: string;
  subsystem?: SimulinkSystemLike;
  parameters?: Map<string, unknown> | Record<string, unknown>;
}

interface SimulinkSystemLike {
  name?: string;
  blocks?: SimulinkBlockLike[] | Map<string, SimulinkBlockLike> | Record<string, SimulinkBlockLike>;
}

interface RawDiagramLike {
  title?: string;
  cells: Array<{ shape?: string; [key: string]: unknown }>;
}

function getUnifiedIndexFromDeps(backends: DiagramBackendHost): unknown {
  return (
    backends.getUnifiedIndex?.() ??
    backends.generic?.deps?.getUnifiedIndex?.() ??
    backends.modelica?.deps?.getUnifiedIndex?.()
  );
}

export function createSimulinkXmlCstSession(text: string, uri = "file:///model.slx.xml"): CstDocumentSession {
  let parser: CstIncrementalParser | null = null;
  try {
    parser = getXmlWasmParser() as unknown as CstIncrementalParser | null;
  } catch {
    parser = null;
  }
  return new CstDocumentSession({ uri, text, parser, xmlFallback: true });
}

/**
 * CST-backed Simulink XML diagram edit planner operating directly on a live {@link CstDocumentSession}.
 * Zero regex patching; error-tolerant against malformed sibling `<Block>`/`<Line>` elements.
 */
export function planSimulinkXmlEditsOnSession(
  session: CstDocumentSession,
  actions: ReadonlyArray<DiagramApplyEditsParams["actions"][number]>,
): { edits: CstTextEdit[]; hasStructural: boolean } {
  const text = session.text;
  const root = session.rootNode;
  const tx = new CstTransaction(session);
  let hasStructural = false;

  const stripBlk = (n: string): string => (n.startsWith("block_") ? n.slice(6) : n);

  const findBlockNode = (blockName: string): SyntaxNode | null =>
    root ? CstXmlAdapter.findElementByAttr(root, text, "Name", blockName, "Block") : null;

  const findChildParam = (parent: SyntaxNode, paramName: string): SyntaxNode | null => {
    const want = paramName.toLowerCase();
    for (const ch of CstXmlAdapter.getChildElements(parent)) {
      if ((CstXmlAdapter.getTagName(ch, text) ?? "").toLowerCase() !== "p") continue;
      if ((CstXmlAdapter.getAttribute(ch, "Name", text)?.value ?? "").toLowerCase() === want) {
        return ch;
      }
    }
    return null;
  };

  const upsertBlockParam = (blockName: string, key: string, value: string): void => {
    const blk = findBlockNode(blockName);
    if (!blk) return;
    const pNode = findChildParam(blk, key);
    if (pNode) {
      CstXmlAdapter.setElementText(tx, pNode, value);
    } else {
      CstXmlAdapter.appendChild(tx, blk, `<P Name="${key}">${value}</P>`);
    }
  };

  const sysNodes = root ? CstXmlAdapter.findElements(root, text, (_n, t) => t.toLowerCase() === "system") : [];
  const targetSys = sysNodes[0] ?? null;

  const getLineNodes = (): SyntaxNode[] =>
    root ? CstXmlAdapter.findElements(root, text, (_n, t) => t.toLowerCase() === "line") : [];

  const getLineEndpoint = (lineNode: SyntaxNode, key: "SrcBlock" | "DstBlock"): string => {
    const p = findChildParam(lineNode, key);
    return p ? CstXmlAdapter.getElementText(p, text) : "";
  };

  const appendLine = (src: string, dst: string, srcPort = "1", dstPort = "1"): void => {
    if (!targetSys) return;
    const snippet = [
      `<Line>`,
      `    <P Name="SrcBlock">${src}</P>`,
      `    <P Name="SrcPort">${srcPort}</P>`,
      `    <P Name="DstBlock">${dst}</P>`,
      `    <P Name="DstPort">${dstPort}</P>`,
      `  </Line>`,
    ].join("\n");
    CstXmlAdapter.appendChild(tx, targetSys, snippet);
  };

  for (const action of actions) {
    if (action.type === "move") {
      for (const item of action.items) {
        const name = stripBlk(item.name);
        const x1 = Math.round(item.x);
        const y1 = Math.round(item.y);
        const x2 = Math.round(item.x + (item.width ?? 80));
        const y2 = Math.round(item.y + (item.height ?? 50));
        upsertBlockParam(name, "Position", `[${x1}, ${y1}, ${x2}, ${y2}]`);
      }
    } else if (action.type === "resize") {
      const item = action.item;
      const name = stripBlk(item.name);
      const x1 = Math.round(item.x);
      const y1 = Math.round(item.y);
      const x2 = Math.round(item.x + (item.width ?? 80));
      const y2 = Math.round(item.y + (item.height ?? 50));
      upsertBlockParam(name, "Position", `[${x1}, ${y1}, ${x2}, ${y2}]`);
    } else if (action.type === "updateParameter") {
      upsertBlockParam(stripBlk(action.name), action.parameter, String(action.value));
    } else if (action.type === "updateProperty") {
      upsertBlockParam(stripBlk(action.name), action.key, String(action.value ?? ""));
    } else if (action.type === "updateName") {
      const oldN = stripBlk(action.oldName);
      const newN = stripBlk(action.newName);
      const blk = findBlockNode(oldN);
      if (blk) {
        CstXmlAdapter.setAttribute(tx, blk, "Name", newN);
        for (const lineNode of getLineNodes()) {
          const srcP = findChildParam(lineNode, "SrcBlock");
          if (srcP && CstXmlAdapter.getElementText(srcP, text) === oldN) {
            CstXmlAdapter.setElementText(tx, srcP, newN);
          }
          const dstP = findChildParam(lineNode, "DstBlock");
          if (dstP && CstXmlAdapter.getElementText(dstP, text) === oldN) {
            CstXmlAdapter.setElementText(tx, dstP, newN);
          }
        }
        hasStructural = true;
      }
    } else if (action.type === "deleteComponents") {
      const deleted = new Set<string>();
      for (const rawName of action.names) {
        const name = stripBlk(rawName);
        deleted.add(name);
        const blk = findBlockNode(name);
        if (blk) {
          CstXmlAdapter.deleteElement(tx, blk);
          hasStructural = true;
        }
      }
      if (deleted.size > 0) {
        for (const lineNode of getLineNodes()) {
          if (
            deleted.has(getLineEndpoint(lineNode, "SrcBlock")) ||
            deleted.has(getLineEndpoint(lineNode, "DstBlock"))
          ) {
            CstXmlAdapter.deleteElement(tx, lineNode);
            hasStructural = true;
          }
        }
      }
    } else if (action.type === "connect") {
      const src = stripBlk(action.source);
      const dst = stripBlk(action.target);
      const sp = action.sourcePort?.replace(/\D+/g, "") || "1";
      const dp = action.targetPort?.replace(/\D+/g, "") || "1";
      appendLine(src, dst, sp, dp);
      hasStructural = true;
    } else if (action.type === "disconnect") {
      const src = stripBlk(action.source);
      const dst = stripBlk(action.target);
      for (const lineNode of getLineNodes()) {
        if (getLineEndpoint(lineNode, "SrcBlock") === src && getLineEndpoint(lineNode, "DstBlock") === dst) {
          CstXmlAdapter.deleteElement(tx, lineNode);
          hasStructural = true;
        }
      }
    } else if (action.type === "addComponent") {
      if (targetSys) {
        const rawCls = action.className.trim();
        const blockType = rawCls.includes(":")
          ? rawCls.slice(rawCls.lastIndexOf(":") + 1)
          : rawCls.includes(".")
            ? rawCls.slice(rawCls.lastIndexOf(".") + 1)
            : rawCls;
        const baseName = action.name?.trim() || blockType.replace(/[^A-Za-z0-9_]/g, "_") || "Block";
        let name = baseName;
        let idx = 1;
        while (findBlockNode(name)) {
          name = `${baseName}${idx++}`;
        }
        const x1 = Math.round(action.x);
        const y1 = Math.round(action.y);
        const x2 = x1 + 80;
        const y2 = y1 + 50;
        const snippet = [
          `<Block BlockType="${blockType}" Name="${name}">`,
          `    <P Name="Position">[${x1}, ${y1}, ${x2}, ${y2}]</P>`,
          `  </Block>`,
        ].join("\n");
        CstXmlAdapter.appendChild(tx, targetSys, snippet);
        hasStructural = true;
      }
    } else if (action.type === "reconnect") {
      const oldS = stripBlk(action.oldSource);
      const oldD = stripBlk(action.oldTarget);
      for (const lineNode of getLineNodes()) {
        if (getLineEndpoint(lineNode, "SrcBlock") === oldS && getLineEndpoint(lineNode, "DstBlock") === oldD) {
          CstXmlAdapter.deleteElement(tx, lineNode);
        }
      }
      const newS = stripBlk(action.newSource);
      const newD = stripBlk(action.newTarget);
      const sp = action.newSourcePort?.replace(/\D+/g, "") || "1";
      const dp = action.newTargetPort?.replace(/\D+/g, "") || "1";
      appendLine(newS, newD, sp, dp);
      hasStructural = true;
    }
  }

  return { edits: tx.commit().edits, hasStructural };
}

export function planSimulinkXmlEdits(
  text: string,
  actions: ReadonlyArray<DiagramApplyEditsParams["actions"][number]>,
  uri = "file:///model.slx.xml",
): { edits: CstTextEdit[]; hasStructural: boolean } {
  const session = createSimulinkXmlCstSession(text, uri);
  try {
    return planSimulinkXmlEditsOnSession(session, actions);
  } finally {
    session.dispose();
  }
}

export function createSimulinkDiagramBackend(backends: DiagramBackendHost): DiagramBackend {
  const sessionCache = new CstSessionCache(16);
  const createDropBatchState = () => backends.crossLanguageDrop?.createDropBatchState?.() ?? {};
  const mergeCoincidentInsertEdits = (edits: TextEdit[]) =>
    backends.crossLanguageDrop?.mergeCoincidentInsertEdits?.(edits) ?? edits;
  const computeSimulinkComponentDropEdits = (opts: unknown): TextEdit[] =>
    backends.crossLanguageDrop?.computeSimulinkComponentDropEdits?.(opts) ?? [];

  const readSimulinkSource = async (targetUri: string): Promise<string | Buffer | null> => {
    const memText = getHostDocumentText(backends, targetUri);
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

  const getSystemBlocks = (sys: SimulinkSystemLike | null | undefined): SimulinkBlockLike[] => {
    if (!sys || !sys.blocks) return [];
    if (Array.isArray(sys.blocks)) return sys.blocks;
    if (sys.blocks instanceof Map) return Array.from(sys.blocks.values());
    if (typeof sys.blocks === "object") return Object.values(sys.blocks);
    return [];
  };

  const formatSimulinkDiagramData = (rawDiagram: RawDiagramLike, meta?: Record<string, unknown>): DiagramData => {
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
        const raw = await readSimulinkSource(params.uri);
        if (!raw) return null;
        const { parseSimulink, buildSimulinkDiagram } = await import("@modelscript/simulink");
        const model = parseSimulink(raw, params.uri);
        let targetSystem: SimulinkSystemLike = model.rootSystem as unknown as SimulinkSystemLike;
        if (params.className && model.rootSystem) {
          const findSubsystem = (sys: SimulinkSystemLike, name: string): SimulinkSystemLike | null => {
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
          const found = findSubsystem(targetSystem, params.className);
          if (found) targetSystem = found;
        }
        const rawDiagram = buildSimulinkDiagram(targetSystem as unknown as Parameters<typeof buildSimulinkDiagram>[0]);
        return formatSimulinkDiagramData(rawDiagram as unknown as RawDiagramLike, {
          solver: model.solver,
          version: model.version,
        });
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

        const findBlock = (sys: SimulinkSystemLike, name: string): SimulinkBlockLike | null => {
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

        const blk = findBlock(model.rootSystem as unknown as SimulinkSystemLike, params.componentName);
        if (!blk) return null;

        const parameters: ComponentPropertyData["parameters"] = [
          { name: "BlockType", value: blk.type, group: "Configuration" },
        ];
        const fields: PropertyFieldConfig[] = [
          { key: "BlockType", label: "Block Type", kind: "string", defaultValue: blk.type },
        ];
        const values: Record<string, unknown> = {
          BlockType: blk.type,
        };

        if (blk.parameters) {
          const pEntries: [string, unknown][] =
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
        const xmlActions: DiagramApplyEditsParams["actions"] = [];
        let hasStructural = false;

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
          } else if (!isCurlyMdl) {
            xmlActions.push(action);
          }
        }

        const allEdits: TextEdit[] = [...addEdits];
        if (xmlActions.length > 0) {
          const session = sessionCache.getOrUpdate(params.uri, raw, () => createSimulinkXmlCstSession(raw, params.uri));
          const planned = planSimulinkXmlEditsOnSession(session, xmlActions);
          allEdits.push(...planned.edits);
          if (planned.hasStructural) hasStructural = true;
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

        const findSubsystem = (
          sys: SimulinkSystemLike,
          name: string,
        ): { sys: SimulinkSystemLike; path: string[] } | null => {
          const blks = getSystemBlocks(sys);
          for (const b of blks) {
            const bId = b.name || b.id;
            if ((bId === name || b.name === name) && b.subsystem) {
              return { sys: b.subsystem, path: [model.rootSystem.name || "Root", b.name ?? bId ?? name] };
            }
            if (b.subsystem) {
              const res = findSubsystem(b.subsystem, name);
              if (res)
                return {
                  sys: res.sys,
                  path: [model.rootSystem.name || "Root", b.name ?? bId ?? name, ...res.path.slice(1)],
                };
            }
          }
          return null;
        };

        const found = findSubsystem(model.rootSystem as unknown as SimulinkSystemLike, cleanName);
        if (!found) return null;
        const rawDiagram = buildSimulinkDiagram(found.sys as unknown as Parameters<typeof buildSimulinkDiagram>[0]);
        return {
          data: formatSimulinkDiagramData(rawDiagram as unknown as RawDiagramLike),
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
