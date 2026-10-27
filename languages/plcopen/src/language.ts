// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Language Definition.
 *
 * Registers IEC 61131-3 PLCopen (.xml, .plcopen, .st) file extensions, pre-flight linting,
 * DAE lowering, Virtual PLC scan execution, and Modelica/SysML projections.
 */

import { language } from "@modelscript/dsl";
import { lowerPlcopenToDae } from "./dae/plcopen-to-dae.js";
import { lintPlcProject } from "./lints/rules.js";
import { parsePlcopen } from "./parser/index.js";
import { plcopenToModelica } from "./projections/plcopen-to-modelica.js";
import { plcopenToSysML } from "./projections/plcopen-to-sysml.js";
import { VirtualPlc } from "./solver/virtual-plc.js";

export const plcopenLanguage = language({
  name: "plcopen",
  fileExtensions: [".xml", ".plcopen", ".st"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".xml", ".plcopen", ".st"],
  },
  rules: {
    Root: () => "plcopen",
  },

  actions: [
    {
      id: "plcopen_lint",
      title: "Lint PLCopen Project",
      description: "Runs pre-flight IEC 61131-3 static semantics and safety checks.",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const project = parsePlcopen(text);
        return lintPlcProject(project);
      },
    },
    {
      id: "plcopen_run_scan",
      title: "Run Virtual PLC Scan Cycle",
      description: "Executes discrete scan cycles using the deterministic VirtualPlc engine.",
      category: "simulate",
      execute: async (
        context: { documentText?: string | undefined },
        params?: { cycles?: number | undefined; dtMs?: number | undefined },
      ) => {
        const text = context.documentText || "";
        const project = parsePlcopen(text);
        const plc = new VirtualPlc(project);
        const cycles = params?.cycles ?? 10;
        const dtMs = params?.dtMs ?? 10;
        const history = plc.runCycles(cycles, dtMs);
        return { cycles, dtMs, finalVariables: plc.getAllVariables(), history };
      },
    },
    {
      id: "plcopen_to_dae",
      title: "Lower PLCopen to DAE Arena",
      description: "Lowers discrete/continuous variables and equations into ModelScript's DAEBuilder arena.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const project = parsePlcopen(text);
        const arena = lowerPlcopenToDae(project);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "plcopen_to_modelica",
      title: "Export to Modelica 3.x",
      description: "Translates PLCopen POUs to Modelica 3.x blocks.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const project = parsePlcopen(text);
        return plcopenToModelica(project);
      },
    },
    {
      id: "plcopen_to_sysml",
      title: "Export to SysML v2",
      description: "Translates PLCopen POUs to SysML v2 Action and State definitions.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const text = context.documentText || "";
        const project = parsePlcopen(text);
        return plcopenToSysML(project);
      },
    },
  ],
});
