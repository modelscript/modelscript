// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Language Definition & Polyglot TGG Rules.
 *
 * Registers SPICE (.cir, .sp, .net, .lib) file extensions, simulation actions
 * (.OP, .TRAN, .AC), Modelica and ECAD export actions, and Triple Graph
 * Grammar (TGG) rules linking SPICE electrical components with Modelica physical models.
 */

import { language } from "@modelscript/dsl";
import { registerBuiltInSpiceLibrarySync } from "./catalog/library-package-adapter.js";
import { spiceNetlistGrammar } from "./grammar/spice-grammar.js";
import { canIndexSpiceFile, indexSpiceFile } from "./indexing.js";
import { lintSpiceCircuit } from "./lints/rules.js";
import { parseSpice } from "./parser/spice-parser.js";
import { spiceToNetlistGraph } from "./projections/ecad.js";
import { spiceToModelica } from "./projections/modelica.js";
import { solveAc } from "./solvers/ac.js";
import { solveOp } from "./solvers/op.js";
import { solveTran } from "./solvers/tran.js";
import { spicePolyglotConfig } from "./tgg/index.js";

export const spiceLanguage = language({
  name: "spice",
  fileExtensions: [".cir", ".sp", ".net", ".lib"],
  maturity: "stable",
  indexing: {
    indexFile: indexSpiceFile,
    canIndex: canIndexSpiceFile,
  },
  lsp: {
    fileExtensions: [".cir", ".sp", ".net", ".lib"],
    icons: {
      light: "./assets/spice/icon-light.png",
      dark: "./assets/spice/icon-dark.png",
    },
    folding: ["SubcktDef", { rule: "CommentLine", kind: "comment", defaultCollapsed: true }],
    outline: ["SubcktDef", "Component", "Directive"],
  },
  rules: spiceNetlistGrammar.rules,

  ui: {
    panels: [
      {
        id: "spiceEditor",
        viewType: "modelscript.spiceEditor",
        title: "SPICE Analog Circuit Inspector",
        shortTitle: "SPICE",
        selector: ["*.sp", "*.spi", "*.cir", "*.spice"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/SpicePanel.tsx",
        artifactViewTypes: ["spice", "cir"],
      },
    ],
    stencils: [
      { label: "Resistor", snippet: "R_new n1 n2 1k\n" },
      { label: "Capacitor", snippet: "C_new n2 0 10n\n" },
      { label: "Inductor", snippet: "L_new n1 n2 1m\n" },
      { label: "Voltage Source", snippet: "V_new in 0 DC 5.0\n" },
    ],
    toolbarButtons: [
      {
        id: "spiceRunOp",
        label: "Run DC Operating Point (.op)",
        shortLabel: "DC Op",
        tooltip: "Solve steady-state DC node voltages and branch currents",
        icon: "pulse",
        views: ["diagram", "code"],
        targets: ["ansatz", "vscode"],
        placement: "primary",
        order: 10,
        actionId: "spice_run_op",
      },
      {
        id: "spiceRunAc",
        label: "Run AC Frequency Sweep (.ac)",
        shortLabel: "AC Sweep",
        tooltip: "Compute small-signal Bode magnitude and phase response",
        icon: "graph",
        views: ["diagram", "code"],
        targets: ["ansatz", "vscode"],
        placement: "primary",
        order: 20,
        actionId: "spice_run_ac",
      },
      {
        id: "spiceRunTran",
        label: "Run Transient Analysis (.tran)",
        tooltip: "Simulate time-domain circuit waveforms",
        icon: "play",
        views: ["*"],
        targets: ["ansatz", "vscode"],
        placement: "overflow",
        order: 30,
        actionId: "spice_run_tran",
      },
      {
        id: "spiceVerifyLint",
        label: "Verify Circuit Topology",
        tooltip: "Check for floating nodes, voltage loops, and missing ground",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz", "vscode"],
        placement: "overflow",
        order: 40,
        actionId: "spice_verify_lint",
      },
      {
        id: "exportModelica",
        label: "Export Circuit to Modelica 3.x",
        shortLabel: "Modelica",
        tooltip: "Export Circuit to Modelica 3.x",
        icon: "export",
        views: ["diagram", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "export_spice_to_modelica",
      },
      {
        id: "exportEcad",
        label: "Export Circuit to ECAD NetlistGraph",
        shortLabel: "ECAD",
        tooltip: "Export Circuit to ECAD NetlistGraph",
        icon: "circuit-board",
        views: ["diagram", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 55,
        actionId: "export_spice_to_ecad",
      },
      {
        id: "syncModelica",
        label: "Synchronize Netlist from Modelica 3.x",
        shortLabel: "Sync",
        tooltip: "Synchronize Netlist from Modelica 3.x",
        icon: "sync",
        views: ["code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "sync_spice_from_modelica",
      },
    ],
  },

  actions: [
    {
      id: "spice_run_op",
      title: "Calculate DC Operating Point (.OP)",
      description: "Computes DC node voltages and branch currents using non-linear Newton-Raphson iteration.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "spice_run_op",
          displayName: "Calculate DC Operating Point",
          modelDescription: "Calculates DC operating point node voltages and currents for a SPICE circuit.",
        },
      },
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const circuit = parseSpice(text);
        const op = solveOp(circuit);
        return {
          converged: op.converged,
          iterations: op.iterations,
          nodeVoltages: Object.fromEntries(op.nodeVoltages),
          branchCurrents: Object.fromEntries(op.branchCurrents),
        };
      },
    },
    {
      id: "spice_run_tran",
      title: "Run Transient Simulation (.TRAN)",
      description: "Simulates time-domain circuit dynamics using companion models and numerical integration.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "spice_run_tran",
          displayName: "Run Transient Simulation",
          modelDescription: "Simulates time-domain transient response of a SPICE netlist.",
        },
      },
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const circuit = parseSpice(text);
        const tran = solveTran(circuit);
        return {
          steps: tran.time.length,
          tstop: tran.time[tran.time.length - 1] ?? 0,
          signals: Array.from(tran.nodeVoltages.keys()),
        };
      },
    },
    {
      id: "spice_run_ac",
      title: "Run Small-Signal AC Frequency Sweep (.AC)",
      description: "Performs AC small-signal frequency response analysis with complex MNA admittance matrix.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(graph)",
          group: "modelscript_run@2",
        },
        languageModelTool: {
          name: "spice_run_ac",
          displayName: "Run AC Frequency Sweep",
          modelDescription: "Computes frequency response magnitude (dB) and phase for a SPICE netlist.",
        },
      },
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const circuit = parseSpice(text);
        const ac = solveAc(circuit);
        return {
          frequencies: ac.frequency.length,
          fstart: ac.frequency[0] ?? 0,
          fstop: ac.frequency[ac.frequency.length - 1] ?? 0,
          signals: Array.from(ac.nodeVoltages.keys()),
        };
      },
    },
    {
      id: "spice_verify_lint",
      title: "Run Electrical & Structural Linter",
      description: "Performs pre-flight electrical checks: floating nodes, voltage loops, and cutsets.",
      category: "verify",
      ui: {
        editorTitle: {
          icon: "$(verified)",
          group: "modelscript_run@3",
        },
      },
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const circuit = parseSpice(text);
        const diagnostics = lintSpiceCircuit(circuit);
        return {
          diagnosticsCount: diagnostics.length,
          diagnostics,
        };
      },
    },
    {
      id: "export_spice_to_modelica",
      title: "Export Circuit to Modelica 3.x",
      description: "Translates SPICE netlist into Modelica.Electrical.Analog physical model.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const circuit = parseSpice(text);
        return spiceToModelica(circuit);
      },
    },
    {
      id: "export_spice_to_ecad",
      title: "Export Circuit to ECAD NetlistGraph",
      description: "Generates a NetlistGraph for PCB layout and ratsnest rendering.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const circuit = parseSpice(text);
        return spiceToNetlistGraph(circuit);
      },
    },
    {
      id: "sync_spice_from_modelica",
      title: "Synchronize Netlist from Modelica 3.x",
      description: "Reconciles tuned component values from Modelica back into SPICE netlist.",
      category: "transform",
      execute: async (context: {
        documentText?: string | undefined;
        modelicaText?: string | undefined;
        options?: Record<string, unknown> | undefined;
      }) => {
        const { synchronizeModelicaToSpice } = await import("./tgg/spice-sync.js");
        const originalText = context.documentText || "";
        const modifiedModelica = context.modelicaText || "";
        const options = context.options || {};
        return synchronizeModelicaToSpice(originalText, modifiedModelica, options);
      },
    },
  ],

  polyglot: spicePolyglotConfig,
});

export default spiceLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInSpiceLibrarySync();
