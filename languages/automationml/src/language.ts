// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — Language Definition.
 *
 * Registers IEC 62714 AutomationML (.aml, .caex) file extensions, pre-flight linting,
 * DAE lowering, closed-loop virtual commissioning, and SSP/SysML2/Modelica projections.
 */

import { language } from "@modelscript/dsl";
import { runAmlVirtualCommissioning } from "./cosim/index.js";
import { lowerAutomationMLToDae } from "./dae/index.js";
import { lintAutomationML } from "./lints/rules.js";
import { parseAutomationML } from "./parser/index.js";
import { amlToModelica, amlToSsp, amlToSysML2 } from "./projections/index.js";

export const automationMLLanguage = language({
  name: "automationml",
  fileExtensions: [".aml", ".caex"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".aml", ".caex"],
  },
  rules: {
    Root: () => "automationml",
  },

  actions: [
    {
      id: "aml_lint",
      title: "Lint AutomationML Topology",
      description: "Runs IEC 62714 CAEX static semantic, port direction, role requirement, and 6-DOF frame checks.",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseAutomationML(context.documentText || "");
        return lintAutomationML(doc);
      },
    },
    {
      id: "aml_virtual_commissioning",
      title: "Run Virtual Commissioning Co-Simulation",
      description:
        "Executes closed-loop virtual commissioning coupling IEC 61131-3 VirtualPlc scan cycles with continuous mechatronic plant dynamics.",
      category: "simulate",
      execute: async (
        context: { documentText?: string | undefined },
        params?: {
          cycles?: number | undefined;
          dtMs?: number | undefined;
          plcSources?: Record<string, string> | undefined;
        },
      ) => {
        const doc = parseAutomationML(context.documentText || "");
        return runAmlVirtualCommissioning(doc, params);
      },
    },
    {
      id: "aml_to_dae",
      title: "Lower AutomationML Plant to DAE Arena",
      description:
        "Lowers continuous mechatronic plant elements and InternalLinks into ModelScript's DAEBuilder arena.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseAutomationML(context.documentText || "");
        const arena = lowerAutomationMLToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "aml_to_ssp",
      title: "Export to SSP (.ssd)",
      description:
        "Exports AutomationML mechatronic topology and InternalLinks to SSP 1.0 SystemStructureDescription XML.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseAutomationML(context.documentText || "");
        return amlToSsp(doc);
      },
    },
    {
      id: "aml_to_sysml2",
      title: "Export to SysML v2",
      description:
        "Projects CAEX hierarchy, PPR roles, ports, and links to SysML v2 part def, part, port, and connect.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseAutomationML(context.documentText || "");
        return amlToSysML2(doc);
      },
    },
    {
      id: "aml_to_modelica",
      title: "Export to Modelica 3.x",
      description: "Projects mechatronic plant topology to a Modelica 3.x system model with connect(...) equations.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseAutomationML(context.documentText || "");
        return amlToModelica(doc);
      },
    },
  ],
});
