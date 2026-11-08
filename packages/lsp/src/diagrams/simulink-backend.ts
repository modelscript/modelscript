// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramBackend, DiagramDispatchDeps } from "../diagramApi.js";
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
      return { seq: params.seq, edits: [], renderHint: "none" };
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
