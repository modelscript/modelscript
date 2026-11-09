// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageAction } from "@modelscript/dsl/dsl/action-types.js";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";

export interface SysmlActionWorkspaceManager {
  globalSysml2QueryEngine?: { toQueryDB(): QueryDB } | undefined;
  getFileContent?: ((uri: string) => Promise<string> | string) | undefined;
}

export interface SysmlActionContext {
  uri?: string | undefined;
  queryDB?: QueryDB | undefined;
  workspaceManager?: SysmlActionWorkspaceManager | undefined;
}

export const sysml2Actions: LanguageAction[] = [
  {
    id: "open_requirements_matrix",
    title: "Open Requirements Matrix",
    description: "Opens the visual SysML v2 Requirements Verification & Traceability matrix editor.",
    category: "query" as const,
    inputs: {
      partName: { type: "string", description: "Part name to inspect" },
    },
    ui: {
      editorTitle: {
        icon: "$(checklist)",
        group: "navigation@1",
      },
      editorContextMenu: {
        group: "1_run@0",
      },
      explorerContextMenu: {
        group: "modelscript_run@0",
      },
      languageModelTool: {
        name: "sysml2_open_requirements_matrix",
        displayName: "Open SysML v2 Requirements Matrix",
        modelDescription: "Opens the visual SysML v2 Requirements Verification & Traceability matrix editor.",
      },
    },
  },
  {
    id: "extract_topology",
    title: "Extract Part Topology",
    description: "Extracts physical connection and port topology from a SysML v2 part definition.",
    category: "query" as const,
    inputs: {
      name: { type: "string", description: "Fully qualified part name" },
    },
    ui: {
      editorTitle: {
        icon: "$(type-hierarchy)",
        group: "navigation@2",
      },
      editorContextMenu: {
        group: "3_analysis@0",
      },
      languageModelTool: {
        name: "sysml2_extract_topology",
        displayName: "Extract SysML v2 Part Topology",
        modelDescription: "Extracts physical connection and port topology from a SysML v2 part definition.",
      },
    },
  },
  {
    id: "verify_requirements",
    title: "Verify Requirements",
    description: "Evaluates requirement satisfaction matrices and constraint checks across a SysML v2 model.",
    category: "verify" as const,
    inputs: {
      partName: { type: "string", description: "Part name to verify" },
    },
    execute: async (ctx: SysmlActionContext, params: { partName?: string | undefined }) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
      const { checkRequirementConsistency } = await import("./smt-bridge.js");
      return checkRequirementConsistency(queryDB, params?.partName);
    },
    ui: {
      editorTitle: {
        icon: "$(checklist)",
        group: "navigation@1",
      },
      editorContextMenu: {
        group: "1_run@1",
      },
      explorerContextMenu: {
        group: "modelscript_run@1",
      },
      languageModelTool: {
        name: "sysml2_verify_requirements",
        displayName: "Verify SysML v2 Requirements",
        modelDescription: "Evaluates requirement satisfaction matrices and constraint checks across a SysML v2 model.",
      },
    },
  },
  {
    id: "verify_state_machine",
    title: "Verify State Machine Determinism",
    description: "Verifies that state machine transition guards are mutually exclusive and collectively exhaustive.",
    category: "verify" as const,
    inputs: {
      stateName: { type: "string", description: "State or package name to verify" },
    },
    execute: async (ctx: SysmlActionContext, params: { stateName?: string | undefined }) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
      const { verifyAllStateMachineTransitions } = await import("./state-machine-verifier.js");
      return verifyAllStateMachineTransitions(queryDB, params?.stateName);
    },
    ui: {
      editorTitle: {
        icon: "$(debug-rerun)",
        group: "navigation@1",
      },
      editorContextMenu: {
        group: "1_run@2",
      },
      languageModelTool: {
        name: "sysml2_verify_state_machine",
        displayName: "Verify SysML v2 State Machine",
        modelDescription: "Verifies state machine transition determinism and deadlock freedom.",
      },
    },
  },
  {
    id: "verify_contracts",
    title: "Verify Interface Contracts",
    description: "Verifies Assume-Guarantee interface contracts across component connections.",
    category: "verify" as const,
    inputs: {
      connectionName: { type: "string", description: "Connection or package name to verify" },
    },
    execute: async (ctx: SysmlActionContext, params: { connectionName?: string | undefined }) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
      const { verifyAllInterfaceContracts } = await import("./contract-verifier.js");
      return verifyAllInterfaceContracts(queryDB, params?.connectionName);
    },
    ui: {
      editorTitle: {
        icon: "$(check-all)",
        group: "navigation@1",
      },
      editorContextMenu: {
        group: "1_run@3",
      },
      languageModelTool: {
        name: "sysml2_verify_contracts",
        displayName: "Verify SysML v2 Interface Contracts",
        modelDescription: "Verifies Assume-Guarantee interface contracts across component connections.",
      },
    },
  },
  {
    id: "export_smtlib",
    title: "Export to SMT-LIB v2",
    description: "Serializes SysML v2 constraints and requirements into standard .smt2 formal benchmarks.",
    category: "export" as const,
    inputs: {
      scope: { type: "string", description: "Target package or part scope" },
    },
    execute: async (ctx: SysmlActionContext, params: { scope?: string | undefined }) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
      const { exportToSmtLib } = await import("./exporters/smtlib-exporter.js");
      return exportToSmtLib(queryDB, { scopeFilter: params?.scope });
    },
    ui: {
      editorContextMenu: {
        group: "2_transform@1",
      },
      explorerContextMenu: {
        group: "modelscript_convert@1",
      },
      languageModelTool: {
        name: "sysml2_export_smtlib",
        displayName: "Export SysML v2 to SMT-LIB v2",
        modelDescription: "Serializes SysML v2 constraints and requirements to SMT-LIB v2 (.smt2).",
      },
    },
  },
  {
    id: "export_nuxmv",
    title: "Export to nuXmv",
    description: "Serializes SysML v2 state machines into standard nuXmv (.smv) formal transition modules.",
    category: "export" as const,
    inputs: {
      stateMachineName: { type: "string", description: "State machine name" },
    },
    execute: async (ctx: SysmlActionContext, params: { stateMachineName?: string | undefined }) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
      const { exportToNuXmv } = await import("./exporters/nuxmv-exporter.js");
      return exportToNuXmv(queryDB, { stateMachineName: params?.stateMachineName });
    },
    ui: {
      editorContextMenu: {
        group: "2_transform@2",
      },
      explorerContextMenu: {
        group: "modelscript_convert@2",
      },
      languageModelTool: {
        name: "sysml2_export_nuxmv",
        displayName: "Export SysML v2 to nuXmv",
        modelDescription: "Serializes SysML v2 state machines to nuXmv (.smv).",
      },
    },
  },
  {
    id: "synthesize_fault_tree",
    title: "Synthesize Fault Tree (MCS)",
    description:
      "Performs automated safety analysis, synthesizes Minimal Cut Sets (MCS), and builds Fault Tree diagrams.",
    category: "verify" as const,
    inputs: {
      hazardName: { type: "string", description: "Target hazard name or condition" },
      maxOrder: { type: "number", description: "Maximum cut set order to explore", default: 4 },
    },
    execute: async (
      ctx: SysmlActionContext,
      params: { hazardName?: string | undefined; maxOrder?: number | undefined },
    ) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
      const { analyzeSafetyAndFaultTree } = await import("./safety-analyzer.js");
      return analyzeSafetyAndFaultTree(queryDB, {
        maxOrder: params?.maxOrder,
      });
    },
    ui: {
      editorTitle: {
        icon: "$(shield)",
        group: "navigation@2",
      },
      editorContextMenu: {
        group: "3_analysis@1",
      },
      languageModelTool: {
        name: "sysml2_synthesize_fault_tree",
        displayName: "Synthesize SysML v2 Fault Tree",
        modelDescription: "Synthesizes Minimal Cut Sets and fault tree diagrams from failure modes.",
      },
    },
  },
  {
    id: "verify_hybrid_flowpipe",
    title: "Verify Hybrid Flowpipe Reachability",
    description:
      "Computes guaranteed reachability tubes across hybrid continuous/discrete SysML v2 dynamics with guard root-finding and state resets.",
    category: "verify" as const,
    inputs: {
      modelName: { type: "string", description: "Target system model or part name" },
      timeSpan: { type: "string", description: "Time horizon [t0, tEnd]", default: "[0, 5]" },
      dt: { type: "number", description: "Initial step size dt", default: 0.05 },
      order: { type: "number", description: "Taylor model polynomial order", default: 2 },
      adaptive: { type: "boolean", description: "Enable adaptive remainder step control", default: true },
      useQrPreconditioning: {
        type: "boolean",
        description: "Enable Householder QR coordinate rotations",
        default: true,
      },
    },
    execute: async (
      ctx: SysmlActionContext,
      params: {
        modelName?: string | undefined;
        timeSpan?: string | undefined;
        dt?: number | undefined;
        order?: number | undefined;
        adaptive?: boolean | undefined;
        useQrPreconditioning?: boolean | undefined;
      },
    ) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
      const { verifyHybridSysml2Reachability } = await import("./hybrid-flowpipe-bridge.js");
      return verifyHybridSysml2Reachability(queryDB, params);
    },
    ui: {
      editorTitle: {
        icon: "$(graph-line)",
        group: "navigation@2",
      },
      editorContextMenu: {
        group: "1_run@4",
      },
      languageModelTool: {
        name: "sysml2_verify_hybrid_flowpipe",
        displayName: "Verify SysML v2 Hybrid Flowpipe Reachability",
        modelDescription:
          "Performs validated reachability analysis on continuous/discrete hybrid SysML v2 systems using Taylor models and QR preconditioning.",
      },
    },
  },
  {
    id: "hybrid_simulate",
    title: "Hybrid Simulation",
    description: "Flatten and simulate a hybrid SysML v2 / Modelica system.",
    category: "simulate" as const,
    inputs: {
      name: { type: "string", description: "Fully qualified part/class name to simulate" },
      startTime: { type: "number", description: "Simulation start time", default: 0 },
      stopTime: { type: "number", description: "Simulation stop time", default: 10 },
    },
    execute: async (
      ctx: SysmlActionContext,
      params: {
        name?: string | undefined;
        startTime?: number | undefined;
        stopTime?: number | undefined;
        step?: number | undefined;
      },
    ) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      const { SysML2DaeLowerer } = await import("./sysml2-dae-lowerer.js");
      const { simulateArenaAsync } = await import("@modelscript/simulate");

      let sourceText = "";
      if (ctx.uri && ctx.workspaceManager?.getFileContent) {
        sourceText = await ctx.workspaceManager.getFileContent(ctx.uri);
      } else if (params?.name && queryDB) {
        const entry = queryDB
          .allEntries()
          .find((e): e is SymbolEntry & { source?: string | undefined } => e.name === params.name);
        if (entry?.source) sourceText = entry.source;
      }

      const lowered = await SysML2DaeLowerer.lowerAction(
        sourceText || (params?.name ? `action def ${params.name} {}` : "action def Sim {}"),
      );
      const startTime = params?.startTime ?? 0;
      const stopTime = params?.stopTime ?? 10;
      const step = params?.step ?? (stopTime > startTime ? (stopTime - startTime) / 100 : 0.1);
      const simResult = await simulateArenaAsync(lowered.arena, {
        startTime,
        stopTime,
        step,
      });

      return {
        name: lowered.name,
        times: simResult.t,
        states: simResult.states,
        y: simResult.y,
      };
    },
    ui: {
      editorContextMenu: {
        group: "1_run",
      },
      explorerContextMenu: {
        group: "modelscript_run@0",
      },
      languageModelTool: {
        name: "sysml2_hybrid_simulate",
        displayName: "Simulate Hybrid SysML v2 / Modelica System",
        modelDescription: "Flatten and simulate a hybrid SysML v2 / Modelica system.",
      },
    },
  },
  {
    id: "verify_activity_soundness",
    title: "Verify Activity Soundness",
    description:
      "Verifies workflow soundness, deadlock freedom, and definite output assignment in SysML v2 activities.",
    category: "verify" as const,
    inputs: {
      actionName: { type: "string", description: "Target action or activity name" },
    },
    execute: async (ctx: SysmlActionContext, params: { actionName?: string | undefined }) => {
      const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
      if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
      const { checkActivitySoundnessForSymbol } = await import("./activity-soundness.js");
      const actions = queryDB
        .allEntries()
        .filter(
          (e: SymbolEntry) =>
            (e.ruleName === "ActionDefinition" || e.ruleName === "ActionUsage") &&
            (!params?.actionName || e.name === params.actionName),
        );
      return actions.map((act: SymbolEntry) => checkActivitySoundnessForSymbol(queryDB, act));
    },
    ui: {
      editorTitle: {
        icon: "$(check-all)",
        group: "navigation@1",
      },
      editorContextMenu: {
        group: "1_run@5",
      },
      languageModelTool: {
        name: "sysml2_verify_activity_soundness",
        displayName: "Verify SysML v2 Activity Soundness",
        modelDescription:
          "Verifies workflow soundness, deadlock freedom, and definite output assignment in SysML v2 activities.",
      },
    },
  },
];
