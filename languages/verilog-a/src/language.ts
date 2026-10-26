// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/verilog-a — Language Definition.
 *
 * Registers Verilog-A / Verilog-AMS (.va, .vams) file extensions, pre-flight linting,
 * DAE lowering, Modelica projection, and SPICE export actions.
 */

import { language } from "@modelscript/dsl";
import { lowerVerilogAToDae } from "./dae/verilog-a-to-dae.js";
import { lintVerilogA } from "./lints/rules.js";
import { parseVerilogA } from "./parser/verilog-a-parser.js";
import { verilogAToModelica } from "./projections/verilog-a-to-modelica.js";
import { verilogAToSpice } from "./projections/verilog-a-to-spice.js";

export const verilogALanguage = language({
  name: "verilog-a",
  fileExtensions: [".va", ".vams"],
  lsp: {
    fileExtensions: [".va", ".vams"],
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
        const text = context.documentText || "";
        const doc = parseVerilogA(text);
        const mod = doc.modules[0];
        if (!mod) return "";
        return verilogAToSpice(mod);
      },
    },
  ],
});
