// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Language Definition & Polyglot TGG Rules.
 *
 * Registers SPICE (.cir, .sp, .net, .lib) file extensions, simulation actions
 * (.OP, .TRAN, .AC), Modelica and ECAD export actions, and Triple Graph
 * Grammar (TGG) rules linking SPICE electrical components with Modelica physical models.
 */

import { language, tggComplement, tggDefaultVal, tggEq, tggRule } from "@modelscript/dsl";
import { lintSpiceCircuit } from "./lints/rules.js";
import { parseSpice } from "./parser/spice-parser.js";
import { spiceToNetlistGraph } from "./projections/ecad.js";
import { spiceToModelica } from "./projections/modelica.js";
import { solveAc } from "./solvers/ac.js";
import { solveOp } from "./solvers/op.js";
import { solveTran } from "./solvers/tran.js";

export const spiceLanguage = language({
  name: "spice",
  fileExtensions: [".cir", ".sp", ".net", ".lib"],
  lsp: {
    fileExtensions: [".cir", ".sp", ".net", ".lib"],
    icons: {
      light: "./assets/spice/icon-light.png",
      dark: "./assets/spice/icon-dark.png",
    },
  },
  rules: {
    Root: () => "spice",
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
        const { synchronizeModelicaToSpice } = await import("./tgg/spice-sync.js");
        const originalText = context.documentText || "";
        const modifiedModelica = context.modelicaText || "";
        const options = context.options || {};
        return synchronizeModelicaToSpice(originalText, modifiedModelica, options);
      },
    },
  ],

  polyglot: {
    typeMaps: {
      spice: {
        Real: "Real",
        Integer: "Integer",
        Voltage: "Real",
        Current: "Real",
      },
    },
    rules: [
      // SPICE Resistor <-> Modelica Resistor
      tggRule({
        name: "SpiceResistorToModelicaResistor",
        sourceLang: "spice",
        targetLang: "modelica",
        source: ($, v) => $.Component({ name: v("name"), kind: "R", value: v("rVal") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("name"),
            typeSpecifier: "Modelica.Electrical.Analog.Basic.Resistor",
            modification: v("rVal"),
          }),
        where: (v) => [tggEq(v("name"), v("name")), tggEq(v("rVal"), v("rVal")), tggComplement(["nodes", "span"])],
      }),

      // SPICE Capacitor <-> Modelica Capacitor
      tggRule({
        name: "SpiceCapacitorToModelicaCapacitor",
        sourceLang: "spice",
        targetLang: "modelica",
        source: ($, v) => $.Component({ name: v("name"), kind: "C", value: v("cVal") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("name"),
            typeSpecifier: "Modelica.Electrical.Analog.Basic.Capacitor",
            modification: v("cVal"),
          }),
        where: (v) => [tggEq(v("name"), v("name")), tggEq(v("cVal"), v("cVal")), tggComplement(["nodes", "span"])],
      }),

      // SPICE Inductor <-> Modelica Inductor
      tggRule({
        name: "SpiceInductorToModelicaInductor",
        sourceLang: "spice",
        targetLang: "modelica",
        source: ($, v) => $.Component({ name: v("name"), kind: "L", value: v("lVal") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("name"),
            typeSpecifier: "Modelica.Electrical.Analog.Basic.Inductor",
            modification: v("lVal"),
          }),
        where: (v) => [tggEq(v("name"), v("name")), tggEq(v("lVal"), v("lVal")), tggComplement(["nodes", "span"])],
      }),

      // SPICE Circuit <-> Modelica Model
      tggRule({
        name: "SpiceCircuitToModelicaModel",
        sourceLang: "spice",
        targetLang: "modelica",
        source: ($, v) => $.Circuit({ title: v("title") }),
        target: ($, v) => $.ClassDefinition({ name: v("title"), classKind: "model" }),
        where: (v) => [
          tggEq(v("title"), v("title")),
          tggDefaultVal(v("isAbstract"), false),
          tggComplement(["components", "subcircuits", "models", "directives"]),
        ],
      }),

      // SPICE Voltage Source <-> Modelica Constant Voltage
      tggRule({
        name: "SpiceVoltageSourceToModelicaConstantVoltage",
        sourceLang: "spice",
        targetLang: "modelica",
        source: ($, v) => $.Component({ name: v("name"), kind: "V", value: v("vVal") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("name"),
            typeSpecifier: "Modelica.Electrical.Analog.Sources.ConstantVoltage",
            modification: v("vVal"),
          }),
        where: (v) => [
          tggEq(v("name"), v("name")),
          tggEq(v("vVal"), v("vVal")),
          tggComplement(["nodes", "sourceSpec"]),
        ],
      }),

      // SPICE Current Source <-> Modelica Constant Current
      tggRule({
        name: "SpiceCurrentSourceToModelicaConstantCurrent",
        sourceLang: "spice",
        targetLang: "modelica",
        source: ($, v) => $.Component({ name: v("name"), kind: "I", value: v("iVal") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("name"),
            typeSpecifier: "Modelica.Electrical.Analog.Sources.ConstantCurrent",
            modification: v("iVal"),
          }),
        where: (v) => [
          tggEq(v("name"), v("name")),
          tggEq(v("iVal"), v("iVal")),
          tggComplement(["nodes", "sourceSpec"]),
        ],
      }),

      // SPICE Component <-> SysML v2 Part Definition
      tggRule({
        name: "SpiceComponentToSysmlPart",
        sourceLang: "spice",
        targetLang: "sysml2",
        source: ($, v) => $.Component({ name: v("name"), kind: v("kind") }),
        target: ($, v) => $.PartDefinition({ name: v("name"), declaredType: v("kind") }),
        where: (v) => [tggEq(v("name"), v("name")), tggDefaultVal(v("isAbstract"), false)],
      }),
    ],
  },
});

export default spiceLanguage;
