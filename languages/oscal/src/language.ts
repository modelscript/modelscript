// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Language Definition.
 *
 * Registers NIST OSCAL 1.1.x (.oscal.json, .oscal.yaml, .oscal.yml, .oscal.xml, .oscal)
 * file extensions, constraint linting, profile resolution, continuous ATO CPS compliance
 * auditing, and SysML v2 / OMG ReqIF projections.
 */

import { language } from "@modelscript/dsl";
import { type CpsArchitectureComponent, auditCpsArchitectureCompliance } from "./cps-bridge/index.js";
import { indexOscalFile } from "./indexing.js";
import { lintOscalDocument } from "./lints/rules.js";
import { parseOscal, serializeOscal } from "./parser/index.js";
import { oscalToReqif, oscalToSysML2 } from "./projections/index.js";
import { resolveOscalProfile } from "./resolver/index.js";
import { oscalPolyglotConfig } from "./tgg/index.js";

export const oscalLanguage = language({
  polyglot: oscalPolyglotConfig,
  name: "oscal",
  fileExtensions: [
    ".oscal",
    ".oscal.json",
    ".oscal.yaml",
    ".oscal.yml",
    ".oscal.xml",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
  ],
  maturity: "experimental",
  indexing: {
    indexFile: indexOscalFile,
    canIndex: (uri, text) => {
      const lower = uri.toLowerCase();
      if (lower.endsWith(".oscal") || lower.includes(".oscal.")) return true;
      return Boolean(
        text &&
        (text.includes("system-security-plan") ||
          text.includes("component-definition") ||
          text.includes("assessment-results") ||
          text.includes("plan-of-action-and-milestones") ||
          (text.includes("catalog") && text.includes("controls"))),
      );
    },
  },
  lsp: {
    fileExtensions: [".oscal", ".oscal.json", ".oscal.yaml", ".oscal.yml", ".oscal.xml"],
  },
  ui: {
    panels: [
      {
        id: "oscalEditor",
        viewType: "modelscript.oscalEditor",
        title: "OSCAL Security Assessment & FedRAMP Studio",
        shortTitle: "OSCAL",
        selector: ["*.oscal.json", "*.oscal.yaml", "*.oscal.yml", "*.oscal.xml"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/OscalPanel.tsx",
        artifactViewTypes: ["oscal"],
      },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "oscalResolveProfile",
        label: "Resolve OSCAL Profile",
        shortLabel: "Resolve OSCAL",
        tooltip: "Resolve OSCAL Profile",
        icon: "stack",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "oscal_resolve_profile",
      },
      {
        id: "oscalConvert",
        label: "Convert OSCAL Format (JSON / YAML / XML)",
        shortLabel: "Convert OSCAL",
        tooltip: "Convert OSCAL Format (JSON / YAML / XML)",
        icon: "tools",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "oscal_convert",
      },
      {
        id: "oscalToSysml2",
        label: "Project OSCAL to SysML v2",
        shortLabel: "Project OSCAL",
        tooltip: "Project OSCAL to SysML v2",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "oscal_to_sysml2",
      },
      {
        id: "oscalToReqif",
        label: "Export OSCAL to OMG ReqIF",
        shortLabel: "Export OSCAL",
        tooltip: "Export OSCAL to OMG ReqIF",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "oscal_to_reqif",
      },
      {
        id: "oscalLint",
        label: "Lint OSCAL Document",
        shortLabel: "Lint OSCAL",
        tooltip: "Lint OSCAL Document",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "oscal_lint",
      },
      {
        id: "oscalAuditCps",
        label: "Audit CPS Architecture Compliance (cATO)",
        shortLabel: "Audit CPS",
        tooltip: "Audit CPS Architecture Compliance (cATO)",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 70,
        actionId: "oscal_audit_cps",
      },
    ],
  },
  rules: {
    Root: () => "oscal",
  },

  actions: [
    {
      id: "oscal_lint",
      title: "Lint OSCAL Document",
      description:
        "Runs NIST OSCAL 1.1.x constraint validation and NIST SP 800-82 CPS compliance checks (M8201–M8208).",
      category: "verify",
      execute: async (
        context: { documentText?: string | undefined },
        params?: { externalArchComponents?: string[] | undefined },
      ) => {
        const doc = parseOscal(context.documentText || "");
        return lintOscalDocument(doc, params);
      },
    },
    {
      id: "oscal_resolve_profile",
      title: "Resolve OSCAL Profile",
      description: "Executes the 3-phase NIST OSCAL Profile Resolution pipeline (Import, Merge, Modify).",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseOscal(context.documentText || "");
        return resolveOscalProfile(doc);
      },
    },
    {
      id: "oscal_audit_cps",
      title: "Audit CPS Architecture Compliance (cATO)",
      description: "Cross-verifies SysML v2 / AutomationML architecture blocks against the OSCAL SSP.",
      category: "verify",
      execute: async (
        context: { documentText?: string | undefined },
        params?: { archComponents?: CpsArchitectureComponent[] | undefined },
      ) => {
        const doc = parseOscal(context.documentText || "");
        return auditCpsArchitectureCompliance(doc, params?.archComponents ?? []);
      },
    },
    {
      id: "oscal_to_sysml2",
      title: "Project OSCAL to SysML v2",
      description: "Projects OSCAL security controls, components, and satisfaction links into SysML v2.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseOscal(context.documentText || "");
        return oscalToSysML2(doc);
      },
    },
    {
      id: "oscal_to_reqif",
      title: "Export OSCAL to OMG ReqIF",
      description: "Exports OSCAL security controls into OMG ReqIF 1.2 XML format.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseOscal(context.documentText || "");
        return oscalToReqif(doc);
      },
    },
    {
      id: "oscal_convert",
      title: "Convert OSCAL Format (JSON / YAML / XML)",
      description: "Losslessly converts OSCAL documents between JSON, YAML, and XML formats.",
      category: "transform",
      execute: async (
        context: { documentText?: string | undefined },
        params?: { format?: "json" | "yaml" | "xml" | undefined },
      ) => {
        const doc = parseOscal(context.documentText || "");
        return serializeOscal(doc, params?.format ?? "json");
      },
    },
  ],
});
