// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — Language Definition.
 *
 * Registers Verilog-A / Verilog-AMS (.va, .vams) file extensions, pre-flight linting,
 * DAE lowering, Modelica projection, and SPICE export actions.
 */

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerVerilogAToDae } from "./dae/verilog-a-to-dae.js";
import { indexVerilogAFile } from "./indexing.js";
import { lintVerilogA } from "./lints/rules.js";
import { parseVerilogA } from "./parser/verilog-a-parser.js";
import { verilogAToModelica } from "./projections/verilog-a-to-modelica.js";
import { verilogAToSpice } from "./projections/verilog-a-to-spice.js";
import { verilogAPolyglotConfig } from "./tgg/index.js";

export const verilogALanguage = language({
  polyglot: verilogAPolyglotConfig,
  name: "verilog-a",
  fileExtensions: [".va", ".vams"],
  maturity: "experimental",
  indexing: {
    indexFile: indexVerilogAFile,
  },
  lsp: {
    fileExtensions: [".va", ".vams"],
  },
  ui: {
    stencils: [
      { label: "Resistor", snippet: "R_new n1 n2 1k\n" },
      { label: "Capacitor", snippet: "C_new n2 0 10n\n" },
      { label: "Inductor", snippet: "L_new n1 n2 1m\n" },
      { label: "Voltage Source", snippet: "V_new in 0 DC 5.0\n" },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        command: "morsel:autoLayout",
      },
      {
        id: "verilogAToDae",
        label: "Lower Verilog-A to DAE Arena",
        shortLabel: "Lower Verilog-A",
        tooltip: "Lower Verilog-A to DAE Arena",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "overflow",
        order: 20,
        actionId: "verilog_a_to_dae",
      },
      {
        id: "verilogAToModelica",
        label: "Export to Modelica 3.x",
        shortLabel: "Export to",
        tooltip: "Export to Modelica 3.x",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "primary",
        order: 30,
        actionId: "verilog_a_to_modelica",
      },
      {
        id: "verilogAToSpice",
        label: "Export to SPICE Subcircuit",
        shortLabel: "Export to",
        tooltip: "Export to SPICE Subcircuit",
        icon: "tools",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "verilog_a_to_spice",
      },
      {
        id: "verilogALint",
        label: "Lint Verilog-A Model",
        shortLabel: "Lint Verilog-A",
        tooltip: "Lint Verilog-A Model",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "verilog_a_lint",
      },
    ],
  },
  rules: {
    Root: () => "verilog-a",
  },

  actions: [
    {
      id: "verilog_a_lint",
      title: "Lint Verilog-A Model",
      description: "Runs pre-flight analog device modeling and numerical convergence checks.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseVerilogA(text);
        return lintVerilogA(doc);
      },
    },
    {
      id: "verilog_a_to_dae",
      title: "Lower Verilog-A to DAE Arena",
      description: "Lowers continuous analog equations into ModelScript's linear-memory DAEBuilder.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseVerilogA(text);
        const mod = doc.modules[0];
        if (!mod) return { error: "No modules found." };
        const arena = lowerVerilogAToDae(mod);
        return {
          title: mod.name,
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "verilog_a_to_modelica",
      title: "Export to Modelica 3.x",
      description: "Translates Verilog-A compact model into acausal Modelica electrical component.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseVerilogA(text);
        const mod = doc.modules[0];
        if (!mod) return "";
        return verilogAToModelica(mod);
      },
    },
    {
      id: "verilog_a_to_spice",
      title: "Export to SPICE Subcircuit",
      description: "Translates Verilog-A compact model into SPICE .SUBCKT with non-linear B-sources.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseVerilogA(text);
        const mod = doc.modules[0];
        if (!mod) return "";
        return verilogAToSpice(mod);
      },
    },
  ],
});
