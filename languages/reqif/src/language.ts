// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Language Definition & Polyglot TGG Rules.
 *
 * Registers OMG ReqIF (.reqif, .reqifz) file extensions, IDE actions,
 * and Triple Graph Grammar (TGG) rules linking requirements with
 * SysML v2 and Modelica physical models.
 */

import { language, xmlRules, type TabularMutationRequest } from "@modelscript/dsl";
import { buildReqIfDiagram, renderReqIfDiagramSvg, reqifDiagramConfig } from "./diagram.js";
import { reqifIndexing } from "./indexing.js";
import { parseReqIf } from "./parser/reqif-parser.js";
import { reqifToModelicaVerifier } from "./projections/modelica.js";
import { reqifToSysml2 } from "./projections/sysml2.js";
import {
  applyReqIfTabularMutation,
  completeReqIfTabularCell,
  executeReqIfTabular,
  reqifTabularConfig,
  updateReqIfRequirementCell,
  validateReqIfTabularCell,
} from "./tabular.js";
import { reqifPolyglotConfig } from "./tgg/index.js";
import { verifyReqIfEntailment } from "./verification/entailment.js";

export const reqifLanguage = language({
  name: "reqif",
  displayName: "OMG ReqIF 1.2",
  fileExtensions: [".reqif", ".reqifz"],
  maturity: "stable",
  indexing: reqifIndexing,
  ui: {
    panels: [
      {
        id: "reqifEditor",
        viewType: "modelscript.reqifEditor",
        title: "ReqIF Requirements Specification Studio",
        shortTitle: "ReqIF",
        selector: ["*.reqif", "*.reqifz"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/ReqifPanel.tsx",
        artifactViewTypes: ["reqif"],
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
        id: "openReqifEditor",
        label: "Inspect Requirements Traceability (.reqif)",
        shortLabel: "Inspect",
        tooltip: "Inspect Requirements Traceability (.reqif)",
        icon: "checklist",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "open_reqif_editor",
      },
      {
        id: "verifyReqifEntailment",
        label: "Verify Requirement Entailment (Nelson-Oppen)",
        shortLabel: "Verify",
        tooltip: "Verify Requirement Entailment (Nelson-Oppen)",
        icon: "shield-check",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "verify_reqif_entailment",
      },
      {
        id: "exportReqifToSysml2",
        label: "Export Requirements to SysML v2",
        shortLabel: "Export",
        tooltip: "Export Requirements to SysML v2",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "export_reqif_to_sysml2",
      },
      {
        id: "exportReqifToModelica",
        label: "Export Requirements to Modelica Verifier",
        shortLabel: "Export",
        tooltip: "Export Requirements to Modelica Verifier",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "export_reqif_to_modelica",
      },
    ],
  },
  lsp: {
    fileExtensions: [".reqif", ".reqifz"],
    icons: {
      light: "./assets/reqif/icon-light.png",
      dark: "./assets/reqif/icon-dark.png",
    },
    handlers: {
      "reqif/getTabularSheet": async (ctx, params: { sheetId?: string }) => {
        const docText = String((ctx as Record<string, unknown>)["documentText"] ?? "");
        return executeReqIfTabular(docText, params?.sheetId ?? "requirements");
      },
      "reqif/mutateTabularSheet": async (ctx, params: { mutation: TabularMutationRequest }) => {
        const docText = String((ctx as Record<string, unknown>)["documentText"] ?? "");
        return applyReqIfTabularMutation(docText, params.mutation);
      },
      "reqif/validateTabularCell": async (
        ctx,
        params: { sheetId: string; rowId: string; columnId: string; value: unknown },
      ) => {
        const docText = String((ctx as Record<string, unknown>)["documentText"] ?? "");
        return validateReqIfTabularCell(docText, params.sheetId, params.rowId, params.columnId, params.value);
      },
      "reqif/completeTabularCell": async (
        ctx,
        params: { sheetId: string; rowId: string; columnId: string; prefix: string },
      ) => {
        const docText = String((ctx as Record<string, unknown>)["documentText"] ?? "");
        return completeReqIfTabularCell(docText, params.sheetId, params.rowId, params.columnId, params.prefix);
      },
      "reqif/getDiagram": async (ctx, params?: { isDark?: boolean }) => {
        const docText = String((ctx as Record<string, unknown>)["documentText"] ?? "");
        const model = buildReqIfDiagram(docText);
        return {
          model,
          svg: renderReqIfDiagramSvg(model, { isDark: params?.isDark ?? true }),
        };
      },
    },
  },
  extras: ($) => {
    const comment = $["COMMENT"];
    const pi = $["PROCESSING_INSTRUCTION"];
    return comment && pi ? [/[ \t\r\n]+/, comment, pi] : [/[ \t\r\n]+/];
  },
  rules: xmlRules,
  diagram: reqifDiagramConfig,
  tabular: reqifTabularConfig,
  requirements: {
    requirementRules: ["SPEC-OBJECT"],
    matrixRules: ["SPEC-RELATION"],
  },
  writeback: (ctx) => {
    const r = ctx as unknown as Record<string, unknown>;
    const sourceText = ctx.fullText ?? String(r["source"] ?? r["sourceText"] ?? "");
    const targetId = String(r["targetId"] ?? r["symbolPath"] ?? ctx.entry?.name ?? "");
    const field = String(r["field"] ?? r["property"] ?? "text");
    const nextVal = ctx.newValue ?? r["value"];
    const res = updateReqIfRequirementCell(sourceText, targetId, field, nextVal);
    return res.success && Array.isArray(res.edits) ? res.edits : null;
  },

  actions: [
    {
      id: "open_reqif_editor",
      title: "Inspect Requirements Traceability (.reqif)",
      description: "Opens the visual requirements matrix and verification coverage panel.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(checklist)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "reqif_open_editor",
          displayName: "Inspect Requirements Matrix",
          modelDescription: "Inspects ReqIF specifications, requirements, and satisfaction links.",
        },
      },
    },
    {
      id: "verify_reqif_entailment",
      title: "Verify Requirement Entailment (Nelson-Oppen)",
      description: "Mathematically verifies V-Model requirements decomposition completeness.",
      category: "verify",
      ui: {
        editorTitle: {
          icon: "$(verified)",
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "reqif_verify_entailment",
          displayName: "Verify Requirements Entailment",
          modelDescription: "Proves mathematical completeness of requirements decomposition.",
        },
      },
      execute: async (context) => {
        const text = context.documentText || "";
        const doc = parseReqIf(text);
        const report = verifyReqIfEntailment(doc);
        return {
          total: report.totalQueries,
          certified: report.certifiedCount,
          gaps: report.gapCount,
          results: report.results,
        };
      },
    },
    {
      id: "export_reqif_to_sysml2",
      title: "Export Requirements to SysML v2",
      description: "Generates SysML v2 requirement definitions and satisfaction links.",
      category: "export",
      execute: async (context) => {
        const text = context.documentText || "";
        const doc = parseReqIf(text);
        return reqifToSysml2(doc);
      },
    },
    {
      id: "export_reqif_to_modelica",
      title: "Export Requirements to Modelica Verifier",
      description: "Generates a Modelica verification block with assertions for plant monitoring.",
      category: "export",
      execute: async (context) => {
        const text = context.documentText || "";
        const doc = parseReqIf(text);
        return reqifToModelicaVerifier(doc);
      },
    },
  ],

  // ZIP container handler for `.reqifz` ReqIF bundle archives
  container: {
    extensions: [".reqifz"],
    extract: (data, { zip }) => {
      const allEntries = zip.entries(data);
      const reqifEntry =
        allEntries.find((e) => e.name.toLowerCase().endsWith(".reqif")) ??
        allEntries.find((e) => e.name.toLowerCase().endsWith(".xml"));
      if (!reqifEntry) return null;

      const reqifContent = zip.readText(data, reqifEntry.name);
      if (!reqifContent) return null;

      const doc = parseReqIf(reqifContent);

      return {
        manifest: {
          path: reqifEntry.name,
          content: reqifContent,
          language: "reqif",
        },
        entries: allEntries.map((entry) => ({
          path: entry.name,
          size: entry.size,
          read: () => zip.read(data, entry.name),
          readText: () => zip.readText(data, entry.name),
          action: entry.name.toLowerCase().endsWith(".reqif") ? ("parse_as_language" as const) : ("mount_vfs" as const),
          targetLanguage: entry.name.toLowerCase().endsWith(".reqif") ? "reqif" : undefined,
        })),
        metadata: {
          title: doc.header.title,
          reqIfVersion: doc.header.reqIfVersion,
          specObjectCount: doc.specObjects.size,
          specRelationCount: doc.specRelations.length,
          specificationCount: doc.specifications.length,
        },
        project: (targetLanguage: string) => {
          const lang = targetLanguage.toLowerCase();
          if (lang === "sysml2" || lang === "sysml") {
            return reqifToSysml2(doc);
          }
          if (lang === "modelica") {
            return reqifToModelicaVerifier(doc);
          }
          return null;
        },
      };
    },
  },

  polyglot: reqifPolyglotConfig,
});

export default reqifLanguage;
