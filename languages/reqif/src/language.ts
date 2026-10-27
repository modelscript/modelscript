// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Language Definition & Polyglot TGG Rules.
 *
 * Registers OMG ReqIF (.reqif, .reqifz) file extensions, IDE actions,
 * and Triple Graph Grammar (TGG) rules linking requirements with
 * SysML v2 and Modelica physical models.
 */

import { language, tggComplement, tggDefaultVal, tggEq, tggRule } from "@modelscript/dsl";
import { parseReqIf } from "./parser/reqif-parser.js";
import { reqifToModelicaVerifier } from "./projections/modelica.js";
import { reqifToSysml2 } from "./projections/sysml2.js";
import { verifyReqIfEntailment } from "./verification/entailment.js";

export const reqifLanguage = language({
  name: "reqif",
  fileExtensions: [".reqif", ".reqifz"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".reqif", ".reqifz"],
    icons: {
      light: "./assets/reqif/icon-light.png",
      dark: "./assets/reqif/icon-dark.png",
    },
  },
  rules: {
    Root: () => "reqif",
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
        const text = context.documentText || "";
        const doc = parseReqIf(text);
        return reqifToModelicaVerifier(doc);
      },
    },
  ],

  polyglot: {
    typeMaps: {
      reqif: {
        String: "String",
        Real: "Real",
        Integer: "Integer",
        Boolean: "Boolean",
      },
    },
    rules: [
      // ReqIF <-> SysML v2
      tggRule({
        name: "ReqIfSpecificationToSysmlPackage",
        sourceLang: "reqif",
        targetLang: "sysml2",
        source: ($, v) => $.Specification({ identifier: v("specId"), longName: v("title") }),
        target: ($, v) => $.PackageDefinition({ declaredName: v("title") }),
        where: (v) => [tggEq(v("title"), v("title")), tggComplement(["identifier", "children"])],
      }),
      tggRule({
        name: "ReqIfSpecObjectToSysmlRequirement",
        sourceLang: "reqif",
        targetLang: "sysml2",
        source: ($, v) => $.SpecObject({ identifier: v("reqId"), text: v("docText") }),
        target: ($, v) => $.RequirementUsage({ declaredName: v("reqId") }),
        where: (v) => [tggEq(v("reqId"), v("reqId")), tggComplement(["attributes", "contract", "span"])],
      }),
      tggRule({
        name: "ReqIfRelationToSysmlSatisfy",
        sourceLang: "reqif",
        targetLang: "sysml2",
        source: ($, v) => $.SpecRelation({ relationType: "satisfies", sourceId: v("src"), targetId: v("tgt") }),
        target: ($, v) => $.SatisfyRequirementUsage({ declaredName: v("src") }),
        where: (v) => [tggEq(v("src"), v("src")), tggComplement(["targetId", "typeRef"])],
      }),
      tggRule({
        name: "ReqIfRelationToSysmlVerify",
        sourceLang: "reqif",
        targetLang: "sysml2",
        source: ($, v) => $.SpecRelation({ relationType: "verifies", sourceId: v("src"), targetId: v("tgt") }),
        target: ($, v) => $.VerificationCaseUsage({ declaredName: v("src") }),
        where: (v) => [tggEq(v("src"), v("src")), tggComplement(["targetId", "typeRef"])],
      }),

      // ReqIF <-> Modelica
      tggRule({
        name: "ReqIfSpecificationToModelicaVerifier",
        sourceLang: "reqif",
        targetLang: "modelica",
        source: ($, v) => $.Specification({ identifier: v("specId"), longName: v("title") }),
        target: ($, v) => $.ClassDefinition({ name: v("title"), classKind: "block" }),
        where: (v) => [
          tggEq(v("title"), v("title")),
          tggDefaultVal(v("isAbstract"), false),
          tggComplement(["identifier", "children"]),
        ],
      }),
      tggRule({
        name: "ReqIfSpecObjectToModelicaAssert",
        sourceLang: "reqif",
        targetLang: "modelica",
        source: ($, v) => $.SpecObject({ identifier: v("reqId"), text: v("reqText") }),
        target: ($, v) =>
          $.ComponentClause({ name: v("reqId"), typeSpecifier: "Modelica.Blocks.Interfaces.BooleanOutput" }),
        where: (v) => [tggEq(v("reqId"), v("reqId")), tggComplement(["attributes", "contract"])],
      }),
    ],
  },
});

export default reqifLanguage;
