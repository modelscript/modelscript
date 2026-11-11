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

export const oscalLanguage = language({
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
