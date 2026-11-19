// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Language Definition.
 *
 * Registers IEC 61131-3 PLCopen (.xml, .plcopen, .st) file extensions, pre-flight linting,
 * DAE lowering, Virtual PLC scan execution, and Modelica/SysML projections.
 */

import { language, xmlRules } from "@modelscript/dsl";
import { lowerPlcopenToDae } from "./dae/plcopen-to-dae.js";
import { indexPlcopenFile } from "./indexing.js";
import { lintPlcProject } from "./lints/rules.js";
import { parsePlcopen } from "./parser/index.js";
import { plcopenToModelica } from "./projections/plcopen-to-modelica.js";
import { plcopenToSysML } from "./projections/plcopen-to-sysml.js";
import { VirtualPlc } from "./solver/virtual-plc.js";
import { plcopenPolyglotConfig } from "./tgg/index.js";

export const plcopenLanguage = language({
  polyglot: plcopenPolyglotConfig,
  name: "plcopen",
  fileExtensions: [".xml", ".plcopen", ".plcopen.xml", ".st"],
  maturity: "experimental",
  indexing: {
    indexFile: indexPlcopenFile,
    canIndex: (uri, text) => {
      const lower = uri.toLowerCase();
      if (lower.endsWith(".plcopen") || lower.endsWith(".plcopen.xml") || lower.endsWith(".st")) {
        return true;
      }
      return Boolean(
        text &&
        (text.includes("plcopen") ||
          text.includes("<pous") ||
          text.includes("PROGRAM ") ||
          text.includes("FUNCTION_BLOCK ")),
      );
    },
  },
  lsp: {
    fileExtensions: [".xml", ".plcopen", ".plcopen.xml", ".st"],
  },
  ui: {
    panels: [
      {
        id: "plcopenEditor",
        viewType: "modelscript.plcopenEditor",
        title: "IEC 61131-3 PLCopen Studio",
        shortTitle: "PLCopen",
        selector: ["*.plcopen", "*.plcopen.xml", "*.st"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/PlcopenPanel.tsx",
        artifactViewTypes: ["plcopen", "iec61131"],
      },
    ],
    stencils: [
      { label: "Contact / Coil", snippet: "IF Start_Cmd AND NOT Fault_Bit THEN\n  Drive_Enable := TRUE;\nEND_IF;\n" },
      { label: "TON Timer", snippet: "TON_Delay(IN := Start_Cmd, PT := T#500ms, Q => Delay_Done);\n" },
      { label: "CTU Counter", snippet: "CTU_Parts(CU := Part_Sensor, R := Reset_Cmd, PV := 25, Q => Batch_Full);\n" },
    ],
  },
  extras: () => [/[ \t\r\n]+/],
  rules: xmlRules,

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
